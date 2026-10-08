import { parseTikTokUrl } from '@booktrap/shared';
import type Anthropic from '@anthropic-ai/sdk';
import type { CachedPost, LibraryStore } from '../store/types';
import { TERMINAL_STATUSES } from '../store/types';
import { fetchPost } from './apify';
import { PipelineError } from './errors';
import { extractBooks, type ExtractedBook } from './extract';
import { downloadSlides, extractFrames, fetchSubtitles } from './media';
import { isSameBook, normalizedKey } from './normalize';
import { resolveLink } from './resolve';
import { verifyBook, type Verification } from './verify';

export interface PipelineSettings {
  apifyToken?: string;
  anthropic?: Anthropic;
  googleBooksApiKey?: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Add books only seen in the background (e.g. a shelf behind the creator). */
  includeBackgroundBooks: boolean;
  /** Below this model confidence a book is flagged "unsure" even when verified (brief §6.5). */
  unsureBelowConfidence: number;
  monthlyBudgetUsd: number;
  killSwitch: boolean;
}

export interface PipelineDeps {
  store: LibraryStore;
  settings: PipelineSettings;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
  /** Test seams. */
  fetchPost?: typeof fetchPost;
  extractBooks?: typeof extractBooks;
  verifyBook?: typeof verifyBook;
  resolveLink?: typeof resolveLink;
  loadMedia?: (post: Awaited<ReturnType<typeof fetchPost>>['post']) => Promise<{ images: Parameters<typeof extractBooks>[0]['images']; transcript: string | null }>;
}

/** An item is tried at most this many times (first run, retries and resumes after restarts). */
export const MAX_ATTEMPTS = 3;

export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Checks the kill switch and the monthly budget before money is spent. */
export async function assertSpendAllowed(deps: PipelineDeps): Promise<void> {
  const { settings, store } = deps;
  if (settings.killSwitch) {
    throw new PipelineError('paused', 'BookTrap has paused reading for now. Your link is saved, try it again later.', true);
  }
  const spent = await store.spendSince(monthStart((deps.now ?? (() => new Date()))()));
  if (spent >= settings.monthlyBudgetUsd) {
    throw new PipelineError(
      'budget_exhausted',
      'BookTrap has reached its reading budget for this month. Your link is saved, try it again next month.',
      true,
    );
  }
}

async function loadMediaDefault(post: Awaited<ReturnType<typeof fetchPost>>['post'], apifyToken: string) {
  const [images, transcript] = await Promise.all([
    post.kind === 'carousel'
      ? downloadSlides(post.imageUrls, { apifyToken })
      : extractFrames(post.videoUrl!, post.durationSec, { apifyToken }),
    fetchSubtitles(post.subtitleUrl, { apifyToken }),
  ]);
  return { images, transcript };
}

/** Fetch + extract, or reuse the cache so the same post is never paid for twice (brief §4). */
async function readPost(itemId: string, deviceId: string, postUrl: string, postId: string, deps: PipelineDeps): Promise<CachedPost> {
  const { store, settings } = deps;
  const cached = await store.getCachedPost(postId);
  if (cached) return cached;

  if (!settings.apifyToken || !settings.anthropic) {
    throw new PipelineError('paused', 'BookTrap has paused reading for now. Your link is saved, try it again later.', true);
  }
  await assertSpendAllowed(deps);

  // Failed calls can still cost money: record it so the monthly budget stays honest.
  const recordFailedSpend = async (provider: 'apify' | 'anthropic', error: unknown) => {
    if (error instanceof PipelineError && error.costUsd > 0) {
      await store.recordSpend({ deviceId, jobItemId: itemId, provider, usd: error.costUsd, detail: { postId, failed: error.code } });
    }
  };

  let fetched;
  try {
    fetched = await (deps.fetchPost ?? fetchPost)(postUrl, postId, { token: settings.apifyToken });
  } catch (error) {
    await recordFailedSpend('apify', error);
    throw error;
  }
  const { post, costUsd } = fetched;
  await store.recordSpend({ deviceId, jobItemId: itemId, provider: 'apify', usd: costUsd, detail: { postId } });
  await store.updateItem(itemId, { status: 'extracting', kind: post.kind });

  const { images, transcript } = deps.loadMedia
    ? await deps.loadMedia(post)
    : await loadMediaDefault(post, settings.apifyToken);
  let extraction;
  try {
    extraction = await (deps.extractBooks ?? extractBooks)(
      { kind: post.kind, caption: post.caption, hashtags: post.hashtags, transcript, images },
      { client: settings.anthropic, model: settings.model, effort: settings.effort },
    );
  } catch (error) {
    await recordFailedSpend('anthropic', error);
    throw error;
  }
  await store.recordSpend({
    deviceId,
    jobItemId: itemId,
    provider: 'anthropic',
    usd: extraction.costUsd,
    detail: { postId, model: extraction.model, images: images.length, ...extraction.usage },
  });

  const value: CachedPost = {
    post: {
      postId: post.postId,
      url: post.url || postUrl,
      kind: post.kind,
      caption: post.caption,
      creatorHandle: post.creatorHandle,
      thumbnailUrl: post.thumbnailUrl,
    },
    books: extraction.books,
    model: extraction.model,
  };
  await store.putCachedPost(postId, value);
  return value;
}

/** Adds one verified/unverified book to the shelf, or attaches the post as another source (brief §7). */
async function shelve(
  deviceId: string,
  jobId: string,
  book: ExtractedBook,
  verification: Verification,
  post: CachedPost['post'],
  deps: PipelineDeps,
): Promise<'added' | 'merged' | 'already'> {
  const { store, settings } = deps;
  const candidate = {
    title: verification.title,
    author: verification.author,
    isbn13: verification.isbn13,
  };
  const existing = (await store.dedupCandidates(deviceId)).find(
    (shelved) => isSameBook(shelved, candidate) || isSameBook(shelved, { title: book.title, author: book.author, isbn13: null }),
  );
  const source = {
    postId: post.postId,
    url: post.url,
    creatorHandle: post.creatorHandle,
    thumbnailUrl: post.thumbnailUrl,
    evidence: book.evidence,
    confidence: book.confidence,
  };

  if (existing) {
    if (verification.verified) {
      await store.fillBookGaps(existing.id, {
        isbn10: verification.isbn10,
        isbn13: verification.isbn13,
        coverUrl: verification.coverUrl,
        publishedYear: verification.publishedYear,
      });
    }
    return (await store.addSource(existing.id, source)) ? 'merged' : 'already';
  }

  await store.clearNewForJob(jobId, deviceId);
  const bookId = await store.insertBook(deviceId, {
    title: verification.title,
    author: verification.author,
    isbn10: verification.isbn10,
    isbn13: verification.isbn13,
    coverUrl: verification.coverUrl,
    publishedYear: verification.publishedYear,
    verified: verification.verified,
    unsure: !verification.verified || book.confidence < settings.unsureBelowConfidence,
    normalizedKey: normalizedKey(verification.title, verification.author),
  });
  await store.addSource(bookId, source);
  return 'added';
}

/** Runs one job item end to end. Never throws: failures land on the item as a readable message. */
export async function processItem(itemId: string, deps: PipelineDeps): Promise<void> {
  const { store, log } = deps;
  const item = await store.getItem(itemId);
  if (!item || TERMINAL_STATUSES.includes(item.status)) return;

  try {
    // Bounds paid work per link across retries and restart resumes (a crash loop can't keep paying).
    if (item.attempts >= MAX_ATTEMPTS) {
      throw new PipelineError('scraper_failed', `BookTrap tried this link ${MAX_ATTEMPTS} times without success. Try pasting it again later.`);
    }
    await store.updateItem(itemId, { status: 'fetching', attempts: item.attempts + 1, error: null });

    const link = parseTikTokUrl(item.inputUrl);
    if (!link) throw new PipelineError('not_a_post', 'This isn’t a TikTok video or photo link.');
    // Checked after resolving too: a short link can lead to a collection.
    const resolved = await (deps.resolveLink ?? resolveLink)(link);
    if (resolved.kind === 'collection') {
      throw new PipelineError('collection_unsupported', 'Collections arrive in the next update. Paste the individual video links for now.');
    }
    if (!resolved.postId) throw new PipelineError('not_a_post', 'This link doesn’t lead to a TikTok video or photo post.');
    await store.updateItem(itemId, { postId: resolved.postId });

    const { post, books } = await readPost(itemId, item.deviceId, resolved.url, resolved.postId, deps);
    await store.updateItem(itemId, { status: 'verifying', kind: post.kind });

    const wanted = books.filter((book) => deps.settings.includeBackgroundBooks || book.prominence === 'featured');
    const verify = deps.verifyBook ?? verifyBook;
    let added = 0;
    for (const book of wanted) {
      const verification = await verify(book.title, book.author, {
        googleBooksApiKey: deps.settings.googleBooksApiKey,
        log: (message, detail) => log.warn({ detail }, message),
      });
      if ((await shelve(item.deviceId, item.jobId, book, verification, post, deps)) === 'added') added++;
    }

    await store.updateItem(itemId, { status: 'done', booksFound: wanted.length, error: null });
    log.info({ itemId, postId: post.postId, found: wanted.length, added, skippedBackground: books.length - wanted.length }, 'item done');
  } catch (error) {
    const message =
      error instanceof PipelineError ? error.userMessage : 'Something went wrong reading this post. Try it again.';
    const level = error instanceof PipelineError && error.code !== 'paused' ? 'warn' : 'error';
    log[level]({ itemId, err: error instanceof PipelineError ? (error.cause ?? error) : error, code: (error as PipelineError).code }, 'item failed');
    await store.updateItem(itemId, { status: 'failed', error: message });
  } finally {
    await store.refreshJobStatus(item.jobId);
  }
}
