/**
 * Runs the extraction pipeline on saved Apify results with several Claude models and prints
 * books, verification and cost side by side. Spends real money: a few cents per post per model.
 *
 *   npx tsx --env-file=.env scripts/compare-models.ts <apify-items.json> [model...]
 */
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { toTikTokPost } from '../src/pipeline/fetchers/tiktok';
import { extractBooks } from '../src/pipeline/extract';
import { downloadSlides, extractFrames, fetchSubtitles } from '../src/pipeline/media';
import { verifyBook } from '../src/pipeline/verify';

const [itemsPath, ...requestedModels] = process.argv.slice(2);
if (!itemsPath) throw new Error('usage: compare-models.ts <apify-items.json> [model...]');
const models = requestedModels.length ? requestedModels : ['claude-opus-5-5', 'claude-sonnet-5-5'];
const apifyToken = process.env.APIFY_TOKEN!;
const client = new Anthropic();

const items = JSON.parse(readFileSync(itemsPath, 'utf8')) as Parameters<typeof toTikTokPost>[0][];
for (const item of items) {
  const post = toTikTokPost(item, item.id ?? '');
  const images =
    post.kind === 'carousel'
      ? await downloadSlides(post.imageUrls, { apifyToken })
      : await extractFrames(post.videoUrl!, post.durationSec, { apifyToken });
  const transcript = await fetchSubtitles(post.subtitleUrl, { apifyToken });
  console.log(`\n=== ${post.kind} ${post.url} (${images.length} images, transcript ${transcript ? 'yes' : 'no'})`);

  for (const model of models) {
    const started = Date.now();
    const result = await extractBooks(
      { platform: post.platform, kind: post.kind, caption: post.caption, hashtags: post.hashtags, transcript, images },
      { client, model, effort: 'medium' },
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `\n--- ${model} (served by ${result.model}) ${seconds}s  in ${result.usage.inputTokens} / out ${result.usage.outputTokens} tokens  $${result.costUsd.toFixed(4)}`,
    );
    for (const book of result.books) {
      const check = await verifyBook(book.title, book.author, { googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY });
      console.log(
        `  [${book.prominence.padEnd(10)}] ${book.title} / ${book.author ?? '?'}  conf ${book.confidence.toFixed(2)} ${book.evidence}` +
          `  -> ${check.verified ? `verified "${check.title}" by ${check.author} isbn ${check.isbn13 ?? '-'}` : 'UNVERIFIED'}` +
          (book.notes ? `  (${book.notes})` : ''),
      );
    }
  }
}
