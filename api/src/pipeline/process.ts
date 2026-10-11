import {
  LIMITS,
  PLATFORM_LABELS,
  PRIVATE_COLLECTION_MESSAGE,
  bookLimitFor,
  parseSourceUrl,
  tiktokCollectionId,
  type BlockedKind,
  type SourceLink,
  type SourcePlatform,
} from '@booktrap/shared';
import type Anthropic from '@anthropic-ai/sdk';
import type { CachedPost, JobItemRecord, LibraryStore, PostContent } from '../store/types';
import { TERMINAL_STATUSES } from '../store/types';
import { fetchPost, type PostData } from './fetchers';
import { listTikTokCollection } from './fetchers/tiktok-collection';
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
  monthlyBudgetUsd: number;
  killSwitch: boolean;
  /** Videos read from one collection (the free limit; a paid tier may raise it later). */
  videosPerCollection: number;
  dailyCapPerUser: number;
  /** A guest's daily cap (an anonymous user who hasn't added an email). */
  dailyCapGuest?: number;
  dailyCapPerIp: number;
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
  listCollection?: typeof listTikTokCollection;
  /** Whether the job's owner is a guest: their daily cap when a collection expands, and their book limit. */
  isGuest?: (userId: string) => Promise<boolean>;
  /** Queues the videos a collection expands into (the job queue in production). */
  enqueue?: (itemId: string, userId: string) => void;
  loadMedia?: (post: PostData) => Promise<{ images: Parameters<typeof extractBooks>[0]['images']; transcript: string | null }>;
}

/** An item is tried at most this many times (first run, retries and resumes after restarts). */
export const MAX_ATTEMPTS = 3;

export function utcDayStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

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

async function loadMediaDefault(post: PostData, apifyToken: string) {
  const [images, transcript] = await Promise.all([
    post.kind === 'carousel'
      ? downloadSlides(post.imageUrls, { apifyToken })
      : extractFrames(post.videoUrl!, post.durationSec, { apifyToken }),
    fetchSubtitles(post.subtitleUrl, { apifyToken }),
  ]);
  return { images, transcript };
}

/** Failed calls can still cost money: record it so the monthly budget stays honest. */
async function recordFailedSpend(
  deps: PipelineDeps,
  where: { userId: string; itemId: string },
  provider: 'apify' | 'anthropic',
  error: unknown,
  detail: Record<string, unknown>,
): Promise<void> {
  if (error instanceof PipelineError && error.costUsd > 0) {
    await deps.store.recordSpend({
      userId: where.userId,
      jobItemId: where.itemId,
      provider,
      usd: error.costUsd,
      detail: { ...detail, failed: error.code },
    });
  }
}

/** Fetch + extract, or reuse the cache so the same post is never paid for twice (brief §4). */
async function readPost(
  itemId: string,
  userId: string,
  platform: SourcePlatform,
  postUrl: string,
  postId: string,
  deps: PipelineDeps,
): Promise<CachedPost> {
  const { store, settings } = deps;
  const cached = await store.getCachedPost(platform, postId);
  // Rows cached before Instagram support carry no platform in their post JSON: the key is the truth.
  if (cached) return { ...cached, post: { ...cached.post, platform } };

  if (!settings.apifyToken || !settings.anthropic) {
    throw new PipelineError('paused', 'BookTrap has paused reading for now. Your link is saved, try it again later.', true);
  }
  await assertSpendAllowed(deps);


  let fetched;
  try {
    fetched = await (deps.fetchPost ?? fetchPost)(platform, postUrl, postId, { token: settings.apifyToken });
  } catch (error) {
    await recordFailedSpend(deps, { userId, itemId }, 'apify', error, { platform, postId });
    throw error;
  }
  const { post, costUsd } = fetched;
  await store.recordSpend({ userId, jobItemId: itemId, provider: 'apify', usd: costUsd, detail: { platform, postId } });
  await store.updateItem(itemId, { status: 'extracting', kind: post.kind });

  const { images, transcript } = deps.loadMedia
    ? await deps.loadMedia(post)
    : await loadMediaDefault(post, settings.apifyToken);
  let extraction;
  try {
    extraction = await (deps.extractBooks ?? extractBooks)(
      { platform, kind: post.kind, slideCount: post.imageUrls.length, caption: post.caption, hashtags: post.hashtags, transcript, images },
      { client: settings.anthropic, model: settings.model, effort: settings.effort },
    );
  } catch (error) {
    await recordFailedSpend(deps, { userId, itemId }, 'anthropic', error, { platform, postId });
    throw error;
  }
  await store.recordSpend({
    userId,
    jobItemId: itemId,
    provider: 'anthropic',
    usd: extraction.costUsd,
    detail: { platform, postId, model: extraction.model, images: images.length, ...extraction.usage },
  });

  const value: CachedPost = {
    post: {
      platform,
      postId: post.postId,
      url: post.url || postUrl,
      kind: post.kind,
      creatorHandle: post.creatorHandle,
      thumbnailUrl: post.thumbnailUrl,
    },
    books: extraction.books,
    model: extraction.model,
    content: extraction.content,
  };
  await store.putCachedPost(platform, postId, value);
  return value;
}

/**
 * Adds one book to the shelf, or attaches the post as another source (brief §7). A book is always
 * added with what was read, whether or not a catalogue match was found; a match only enriches it.
 */
async function shelve(
  userId: string,
  jobId: string,
  book: ExtractedBook,
  verification: Verification,
  post: CachedPost['post'],
  deps: PipelineDeps,
  /** Room left under the reader's book limit; a new book is refused at 0 (a repeat sighting still merges). */
  room: { left: number },
): Promise<'added' | 'merged' | 'already' | 'full'> {
  const { store } = deps;
  const candidate = {
    title: verification.title,
    author: verification.author,
    isbn13: verification.isbn13,
  };
  const existing = (await store.dedupCandidates(userId)).find(
    (shelved) => isSameBook(shelved, candidate) || isSameBook(shelved, { title: book.title, author: book.author, isbn13: null }),
  );
  const source = {
    platform: post.platform,
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
  if (room.left <= 0) return 'full';

  await store.clearNewForJob(jobId, userId);
  const bookId = await store.insertBook(userId, {
    title: verification.title,
    author: verification.author,
    isbn10: verification.isbn10,
    isbn13: verification.isbn13,
    coverUrl: verification.coverUrl,
    publishedYear: verification.publishedYear,
    verified: verification.verified,
    normalizedKey: normalizedKey(verification.title, verification.author),
  });
  try {
    await store.addSource(bookId, source);
  } catch (error) {
    // Never leave a book without the post it came from, not even in the Undo bin.
    await store.removeBook(userId, bookId).catch((cleanup: unknown) =>
      deps.log.error({ err: cleanup, bookId }, 'could not remove a book whose source failed to save'),
    );
    throw error;
  }
  room.left--;
  return 'added';
}

/** The verdicts that skip a post, as the job item reports them. */
const SKIPPED: Partial<Record<PostContent, BlockedKind>> = {
  explicit_non_book: 'explicit',
  graphic_violence: 'graphic',
  refused: 'refused',
};

/**
 * How many more books the reader's shelf takes (5,000, or 500 for a guest). Whether they're a guest is
 * only asked when `incoming` books could cross the guest limit; if that can't be checked, the account
 * limit applies: the limit is about storage, and never losing a book matters more than a few hundred rows.
 */
async function bookRoom(userId: string, incoming: number, { store, isGuest, log }: PipelineDeps): Promise<{ left: number; limit: number; guest: boolean }> {
  const count = await store.countBooks(userId);
  let guest = false;
  if (incoming > 0 && count + incoming > LIMITS.booksPerGuest && isGuest) {
    guest = await isGuest(userId).catch((error: unknown) => {
      log.warn({ err: error }, 'could not check whether a reader is a guest');
      return false;
    });
  }
  const limit = bookLimitFor(guest);
  return { left: Math.max(0, limit - count), limit, guest };
}

/** Said on an item when the shelf filled up part-way (or was already full). */
export function shelfFullNote(skipped: number, limit: number, guest: boolean): string {
  const books = `${skipped} ${skipped === 1 ? 'book' : 'books'}`;
  const more = guest ? ` Save your shelf to keep up to ${LIMITS.booksPerAccount.toLocaleString('en-US')}.` : ' Delete some to make room.';
  return `Your shelf is full (${limit.toLocaleString('en-US')} books), so ${books} from this post weren’t added.${more}`;
}

/**
 * The owner's daily cap, as the jobs route gives it: guests get DAILY_LINK_CAP_GUEST. If Supabase can't
 * say whether they're a guest right now, the smaller of the two caps applies rather than failing the item.
 */
async function capFor(userId: string, { settings, isGuest, log }: PipelineDeps): Promise<number> {
  const guestCap = settings.dailyCapGuest;
  if (guestCap === undefined || !isGuest) return settings.dailyCapPerUser;
  try {
    return (await isGuest(userId)) ? guestCap : settings.dailyCapPerUser;
  } catch (error) {
    log.warn({ err: error }, 'could not check whether a collection’s owner is a guest');
    return Math.min(guestCap, settings.dailyCapPerUser);
  }
}

const collectionDailyLimit = () =>
  new PipelineError('budget_exhausted', 'You’ve reached today’s limit, so this collection can’t be read now. It resets at midnight UTC.', true);

/**
 * A collection link becomes one queued item per video (read like any pasted link, and cached), up to the
 * free per-collection limit and whatever is left of today's caps. The collection item itself only lists.
 */
async function expandCollection(item: JobItemRecord, link: SourceLink, deps: PipelineDeps): Promise<void> {
  const { store, settings, log } = deps;
  const queue = (child: JobItemRecord) => deps.enqueue?.(child.id, child.userId);

  // Resumed after a restart: the listing was already paid for, so just carry on with its videos.
  const existing = await store.childItems(item.id);
  if (existing.length) {
    existing.filter((child) => !TERMINAL_STATUSES.includes(child.status)).forEach(queue);
    await store.updateItem(item.id, { status: 'done', error: null });
    return;
  }

  const collectionId = tiktokCollectionId(link.url);
  if (!collectionId) throw new PipelineError('not_a_post', 'This collection link is missing its id. Copy the link again from TikTok.');
  // Both are needed to read the videos: never pay for a listing (or use up the reader's cap) otherwise.
  if (!settings.apifyToken || !settings.anthropic) {
    throw new PipelineError('paused', 'BookTrap has paused reading for now. Your link is saved, try it again later.', true);
  }

  const since = utcDayStart((deps.now ?? (() => new Date()))());
  const ipHash = await store.jobIpHash(item.jobId);
  const [byUser, byIp] = await Promise.all([
    store.countItemsSince({ userId: item.userId }, since),
    ipHash ? store.countItemsSince({ ipHash }, since) : Promise.resolve(0),
  ]);
  const userCap = await capFor(item.userId, deps);
  const room = Math.min(userCap - byUser, ipHash ? settings.dailyCapPerIp - byIp : Infinity);
  const limit = Math.min(settings.videosPerCollection, room);
  if (limit <= 0) {
    throw collectionDailyLimit();
  }
  await assertSpendAllowed(deps);

  let listing;
  try {
    listing = await (deps.listCollection ?? listTikTokCollection)(collectionId, limit, { token: settings.apifyToken });
  } catch (error) {
    await recordFailedSpend(deps, { userId: item.userId, itemId: item.id }, 'apify', error, { platform: 'tiktok', collectionId });
    throw error;
  }
  await store.recordSpend({
    userId: item.userId,
    jobItemId: item.id,
    provider: 'apify',
    usd: listing.costUsd,
    detail: { platform: 'tiktok', collectionId, videos: listing.videos.length },
  });

  // The listing is paid for: a brief database hiccup here must not send the next attempt to pay again
  // (adding children is idempotent, so a retry after a lost response doesn't add them twice).
  // The caps are counted again as the videos are saved: other links may have used today's room meanwhile.
  const newItems = listing.videos.map((video) => ({ inputUrl: video.url, platform: 'tiktok' as const, postId: video.postId, kind: video.kind }));
  const caps = { perUser: userCap, perIp: settings.dailyCapPerIp, since };
  let children: JobItemRecord[];
  for (let attempt = 0; ; attempt++) {
    try {
      children = await store.addChildItems(item, newItems, caps);
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  if (children.length === 0 && newItems.length > 0) {
    throw collectionDailyLimit();
  }
  // Cut short by today's caps: when listing (more videos than the room), or when saving (room used meanwhile).
  const cappedByDay = children.length < newItems.length || (listing.more && limit < settings.videosPerCollection);
  const note = cappedByDay
    ? `Reading ${children.length} videos: that’s all today’s limit allows. Paste the collection again tomorrow for more.`
    : listing.more
      ? `This collection has more than ${settings.videosPerCollection} videos. BookTrap reads the first ${settings.videosPerCollection}; bigger collections are coming as a paid option.`
      : null;
  await store.updateItem(item.id, { status: 'done', error: null, note, booksFound: 0 });
  children.forEach(queue);
  log.info({ itemId: item.id, collectionId, videos: children.length, more: listing.more }, 'collection expanded');
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

    const link = parseSourceUrl(item.inputUrl);
    if (!link) throw new PipelineError('not_a_post', 'This isn’t a TikTok or Instagram post link.');
    // Checked after resolving too: a short link can lead to a collection.
    const resolved = await (deps.resolveLink ?? resolveLink)(link);
    if (resolved.kind === 'private_collection') throw new PipelineError('private_collection', PRIVATE_COLLECTION_MESSAGE);
    if (resolved.kind === 'collection') {
      await store.updateItem(itemId, { kind: 'collection' });
      await expandCollection(item, resolved, deps);
      return;
    }
    const label = PLATFORM_LABELS[resolved.platform];
    if (!resolved.postId) throw new PipelineError('not_a_post', `This link doesn’t lead to a ${label} post.`);
    await store.updateItem(itemId, { platform: resolved.platform, postId: resolved.postId });

    // Taken down: never read or shelved again, and it costs nothing.
    if (await store.isPostRemoved(resolved.platform, resolved.postId)) {
      await store.updateItem(itemId, { status: 'done', booksFound: 0, error: null, blocked: 'removed' });
      log.info({ itemId, platform: resolved.platform, postId: resolved.postId }, 'item skipped: post removed');
      return;
    }

    const { post, books, content } = await readPost(itemId, item.userId, resolved.platform, resolved.url, resolved.postId, deps);
    const skipped = SKIPPED[content];
    if (skipped) {
      // Nothing from it is added, even books it found (an operator can unblock a wrong verdict).
      await store.updateItem(itemId, { status: 'done', kind: post.kind, booksFound: 0, error: null, blocked: skipped });
      log.info({ itemId, platform: post.platform, postId: post.postId, content }, 'item skipped by the content check');
      return;
    }
    await store.updateItem(itemId, { status: 'verifying', kind: post.kind });

    const wanted = books.filter((book) => deps.settings.includeBackgroundBooks || book.prominence === 'featured');
    const verify = deps.verifyBook ?? verifyBook;
    const room = await bookRoom(item.userId, wanted.length, deps);
    let added = 0;
    let full = 0;
    for (const book of wanted) {
      const verification = await verify(book.title, book.author, {
        googleBooksApiKey: deps.settings.googleBooksApiKey,
        log: (message, detail) => log.warn({ detail }, message),
      });
      const outcome = await shelve(item.userId, item.jobId, book, verification, post, deps, room);
      if (outcome === 'added') added++;
      if (outcome === 'full') full++;
    }

    const note = full ? shelfFullNote(full, room.limit, room.guest) : undefined;
    await store.updateItem(itemId, { status: 'done', booksFound: wanted.length, error: null, ...(note && { note }) });
    log.info({ itemId, platform: post.platform, postId: post.postId, found: wanted.length, added, full, skippedBackground: books.length - wanted.length }, 'item done');
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
