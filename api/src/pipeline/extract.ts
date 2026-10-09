import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { EVIDENCE_KINDS, PLATFORM_LABELS, type SourcePlatform } from '@booktrap/shared';
import { PipelineError } from './errors';
import type { ImageInput } from './media';
import { claudeCostUsd } from './pricing';

/** Extraction prompt contract (brief §5), plus `prominence` so background shelves can be filtered. */
export const ExtractedBookSchema = z.object({
  title: z.string().describe('The book title as printed, with the series name only if it appears on the cover.'),
  author: z.string().nullable().describe('Author as printed or spoken, or null if not shown or said.'),
  confidence: z.number().describe('0 to 1: how sure you are that the title and author are read correctly.'),
  evidence: z.enum(EVIDENCE_KINDS).describe('The strongest source for this book.'),
  prominence: z
    .enum(['featured', 'background'])
    .describe(
      'featured: the post presents this book (held up, pointed at, discussed, listed in the caption or on-screen text, or the post is a shelf/haul tour). background: only visible incidentally behind or around the creator.',
    ),
  notes: z.string().nullable().describe('Short note when something is uncertain, e.g. "title partly hidden by hand".'),
});
export type ExtractedBook = z.infer<typeof ExtractedBookSchema>;

const ExtractionSchema = z.object({ books: z.array(ExtractedBookSchema) });

export const EXTRACTION_SYSTEM_PROMPT = `You catalogue the books in a single TikTok or Instagram post (a video, a reel, a photo or a photo carousel) so a reader can add them to their want-to-read list.

You get the post's caption and hashtags, any subtitles or speech transcript, and images: carousel slides in order, or frames sampled from the video with their timestamps.

Rules:
- Only return actual books. Ignore e-readers, bookshelves or stacks where no title is readable, and non-book products (candles, bookmarks, merch).
- Read covers, spines, on-screen text, the caption and the transcript. A book counts if it appears in any of them.
- Never invent a title or author. If a title is only partly readable, give your best reading with a low confidence and say what was unclear in notes.
- Put a series name in the title only when it is printed on the cover.
- Each book appears once, even if it shows up in many frames or is both shown and mentioned. Use the strongest evidence.
- Mark each book's prominence. A reader wants the books the creator is presenting, not the decor behind them, but keep background books you can read so the reader can choose.
- When the caption or speech names a book that also appears on screen, prefer the spelling from the cover or caption over the transcript, which often mishears names.
- Confidence: 0.9 or more only when title and author are clearly legible or explicitly stated. Use 0.5 to 0.8 for partial or inferred readings, and below 0.5 for guesses.`;

export interface ExtractionInput {
  platform: SourcePlatform;
  kind: 'video' | 'carousel';
  /** Slides in the post (some may have failed to download, so this can exceed images.length). */
  slideCount?: number;
  caption: string;
  hashtags: string[];
  transcript: string | null;
  images: ImageInput[];
}

export interface ExtractionResult {
  books: ExtractedBook[];
  model: string;
  costUsd: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ExtractDeps {
  client: Anthropic;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

function buildContent(input: ExtractionInput): Anthropic.Beta.BetaContentBlockParam[] {
  const context = [
    `Post: ${PLATFORM_LABELS[input.platform]} ${input.kind === 'carousel' ? ((input.slideCount ?? input.images.length) === 1 ? 'photo' : 'photo carousel') : 'video'}`,
    `Caption: ${input.caption || '(none)'}`,
    `Hashtags: ${input.hashtags.length ? input.hashtags.map((tag) => `#${tag}`).join(' ') : '(none)'}`,
    `Transcript: ${input.transcript ?? '(none available)'}`,
  ].join('\n\n');

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: context }];
  for (const image of input.images) {
    blocks.push({ type: 'text', text: image.label });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  blocks.push({ type: 'text', text: 'List every book in this post following the rules.' });
  return blocks;
}

/**
 * Deduplicates within one post in case the model repeats a book across frames anyway.
 * Keeps the most confident reading, and the book counts as featured if any copy was featured.
 */
export function dedupe(books: ExtractedBook[]): ExtractedBook[] {
  const byKey = new Map<string, ExtractedBook>();
  for (const book of books) {
    const title = book.title.trim();
    if (!title) continue;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const existing = byKey.get(key);
    const clamped = { ...book, title, confidence: Math.min(1, Math.max(0, book.confidence)) };
    const best = !existing || clamped.confidence > existing.confidence ? clamped : existing;
    const featured = clamped.prominence === 'featured' || existing?.prominence === 'featured';
    byKey.set(key, { ...best, prominence: featured ? 'featured' : 'background' });
  }
  return [...byKey.values()];
}

export async function extractBooks(input: ExtractionInput, deps: ExtractDeps): Promise<ExtractionResult> {
  let response;
  try {
    response = await deps.client.beta.messages.parse({
      model: deps.model,
      max_tokens: 16000,
      // Server-side refusal fallback: if a safety classifier declines, the API retries on a
      // suitable model inside the same call (claude-api skill default for this model tier).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: EXTRACTION_SYSTEM_PROMPT,
      output_config: { effort: deps.effort, format: betaZodOutputFormat(ExtractionSchema) },
      messages: [{ role: 'user', content: buildContent(input) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      throw new PipelineError('extraction_failed', 'The book reader is busy right now. Try this link again in a minute.', true, { cause: error });
    }
    if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
      // Operator problem, not the post's: retryable once the account is topped up.
      throw new PipelineError('paused', 'BookTrap has paused reading for now. Your link is saved, try it again later.', true, {
        cause: error,
      });
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new PipelineError('paused', 'BookTrap has paused reading for now. Your link is saved, try it again later.', true, {
        cause: error,
      });
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new PipelineError('extraction_failed', 'BookTrap couldn’t read this post’s images.', false, { cause: error });
    }
    throw error;
  }

  const costUsd = claudeCostUsd(response.model, response.usage);
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  // Failed-but-billed responses still carry their cost, so the budget ledger sees it.
  if (response.stop_reason === 'refusal') {
    throw new PipelineError('extraction_failed', 'BookTrap couldn’t read this post.', false, { costUsd });
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new PipelineError('extraction_failed', 'BookTrap couldn’t finish reading this post. Try it again.', true, { costUsd });
  }

  return { books: dedupe(response.parsed_output.books), model: response.model, costUsd, usage };
}
