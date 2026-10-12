import type { AdminStats, BlockedKind, Book, BookStatus, Evidence, JobItemStatus, PostReach, ReportReason, SourcePlatform, StatsRange, Tag } from '@booktrap/shared';
import type { ExtractedBook } from '../pipeline/extract';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type ItemKind = 'video' | 'carousel' | 'collection' | 'collection_child';

export interface JobRecord {
  id: string;
  userId: string;
  status: JobStatus;
  clearedNew: boolean;
  createdAt: string;
}

export interface JobItemRecord {
  id: string;
  jobId: string;
  userId: string;
  inputUrl: string;
  platform: SourcePlatform;
  postId: string | null;
  kind: ItemKind | null;
  status: JobItemStatus;
  error: string | null;
  booksFound: number;
  attempts: number;
  /** The collection item this video was expanded from. */
  parentItemId: string | null;
  note: string | null;
  /** Why nothing from the post was added (moderation or a takedown); null for an ordinary item. */
  blocked: BlockedKind | null;
  /** Served from the post cache (free) rather than read new. Written when the item finishes; only the stats read it. */
  fromCache?: boolean;
  createdAt: string;
}

export interface NewItem {
  inputUrl: string;
  platform: SourcePlatform;
  postId: string | null;
  kind: ItemKind | null;
}

export type JobWithItems = JobRecord & { items: JobItemRecord[] };

export interface CachedPostMeta {
  platform: SourcePlatform;
  postId: string;
  url: string;
  kind: 'video' | 'carousel';
  creatorHandle: string | null;
  thumbnailUrl: string | null;
}

/**
 * The extraction's verdict on a post. Explicit and graphic posts (that aren't about books) are skipped,
 * as is a post Claude declined to read (refused). Rows cached before moderation are treated as books.
 */
export type PostContent = 'books' | 'not_books' | 'explicit_non_book' | 'graphic_violence' | 'refused';

/** The verdicts that skip a post, as job items and the admin page name them. The one place this lives. */
export const BLOCKED_BY_CONTENT: Partial<Record<PostContent, BlockedKind>> = {
  explicit_non_book: 'explicit',
  graphic_violence: 'graphic',
  refused: 'refused',
};
export const BLOCKING_CONTENT = Object.keys(BLOCKED_BY_CONTENT) as PostContent[];

export interface CachedPost {
  post: CachedPostMeta;
  /** Kept even for a skipped post, so an operator's unblock can shelve them without paying again. */
  books: ExtractedBook[];
  model: string;
  content: PostContent;
}

/** A skipped post as the admin page lists it (from the post cache). */
export interface BlockedPostRecord {
  post: CachedPostMeta;
  content: PostContent;
  fetchedAt: string;
}

export interface NewReport {
  platform: SourcePlatform;
  postId: string;
  url: string;
  creatorHandle: string | null;
  reason: ReportReason;
  note: string | null;
}

export interface ReportRecord extends NewReport {
  id: string;
  status: 'open' | 'taken_down' | 'dismissed';
  createdAt: string;
}

export interface RemovedPostRecord {
  platform: SourcePlatform;
  postId: string;
  url: string | null;
  creatorHandle: string | null;
  reason: 'report' | 'request' | 'admin';
  removedAt: string;
}

export interface TakedownResult {
  sourcesRemoved: number;
  booksDeleted: number;
  booksKept: number;
}

export interface NewBook {
  title: string;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  coverUrl: string | null;
  publishedYear: number | null;
  /** A catalogue match enriched it. Internal only: the reader never sees an "unverified" state. */
  verified: boolean;
  normalizedKey: string;
}

export interface NewSource {
  platform: SourcePlatform;
  postId: string;
  url: string;
  creatorHandle: string | null;
  thumbnailUrl: string | null;
  evidence: Evidence | null;
  confidence: number | null;
}

export interface DedupCandidate {
  id: string;
  title: string;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  coverUrl: string | null;
  publishedYear: number | null;
}

export interface SpendEvent {
  userId: string | null;
  jobItemId: string | null;
  provider: 'apify' | 'anthropic';
  usd: number;
  detail?: Record<string, unknown>;
}

/** Today's per-user and per-network post caps. A collection link itself isn't a post; its videos are. */
export interface DailyCaps {
  perUser: number;
  perIp: number;
  /** Start of the day being counted (midnight UTC). */
  since: Date;
}

/** A job refused because it would pass a daily cap. `used` is that scope's count so far today. */
export class DailyCapError extends Error {
  constructor(
    readonly scope: 'user' | 'ip',
    readonly used: number,
  ) {
    super(`Daily ${scope} cap reached`);
    this.name = 'DailyCapError';
  }
}

/** Everything the jobs pipeline and the library routes need from storage. Always scoped by user. */
export interface LibraryStore {
  /**
   * With `caps`, counting today's posts and inserting the job happen atomically (parallel submissions
   * can't each slip under a cap): throws DailyCapError when `caps.posts` more would pass one.
   */
  createJob(
    userId: string,
    ipHash: string | null,
    items: NewItem[],
    caps?: DailyCaps & { posts: number },
  ): Promise<JobWithItems>;
  /**
   * Adds the videos a collection expanded into, as children of that item, to the same job: with `caps`,
   * only as many as today's caps still allow, counted atomically. Idempotent: when the item already has
   * children (a retry after a lost response), those are returned and nothing is added.
   */
  addChildItems(parent: JobItemRecord, items: NewItem[], caps?: DailyCaps): Promise<JobItemRecord[]>;
  childItems(parentItemId: string): Promise<JobItemRecord[]>;
  /** The keyed IP hash the job was created from, for the per-IP cap on collection expansion. */
  jobIpHash(jobId: string): Promise<string | null>;
  getJob(userId: string, jobId: string): Promise<JobWithItems | null>;
  listJobs(userId: string, limit: number): Promise<JobWithItems[]>;
  getItem(itemId: string): Promise<JobItemRecord | null>;
  updateItem(
    itemId: string,
    patch: Partial<Pick<JobItemRecord, 'status' | 'error' | 'booksFound' | 'platform' | 'postId' | 'kind' | 'attempts' | 'note' | 'blocked' | 'fromCache'>>,
  ): Promise<void>;
  /** Items that were queued or mid-flight when the process stopped (free hosting sleeps). */
  unfinishedItems(): Promise<JobItemRecord[]>;
  refreshJobStatus(jobId: string): Promise<void>;
  /** Posts submitted since `since`. A collection link itself isn't counted; its videos are. */
  countItemsSince(filter: { userId: string } | { ipHash: string }, since: Date): Promise<number>;

  /** Keyed by platform + post id: the same id on two platforms is two different posts. */
  getCachedPost(platform: SourcePlatform, postId: string): Promise<CachedPost | null>;
  putCachedPost(platform: SourcePlatform, postId: string, value: CachedPost): Promise<void>;

  recordSpend(event: SpendEvent): Promise<void>;
  spendSince(since: Date): Promise<number>;

  /** The first book a job adds clears the previous batch's "new" highlight (brief §7). Idempotent per job. */
  clearNewForJob(jobId: string, userId: string): Promise<void>;
  dedupCandidates(userId: string): Promise<DedupCandidate[]>;
  insertBook(userId: string, book: NewBook): Promise<string>;
  /** Fills only fields that are currently empty, so user edits are never overwritten. */
  fillBookGaps(bookId: string, fields: Partial<Pick<NewBook, 'isbn10' | 'isbn13' | 'coverUrl' | 'publishedYear'>>): Promise<void>;
  /** False when this post (platform + id) is already a source of the book. */
  addSource(bookId: string, source: NewSource): Promise<boolean>;
  listBooks(userId: string): Promise<Book[]>;
  /** Live books on the shelf (the Undo bin doesn't count), for the per-account book limit. */
  countBooks(userId: string): Promise<number>;

  // Phase 3: the reader's own edits. Every method is scoped to the user; unknown ids are ignored.
  getBook(userId: string, bookId: string): Promise<Book | null>;
  updateBook(userId: string, bookId: string, patch: BookPatch): Promise<Book | null>;
  /** Permanent delete of one just-inserted book (the pipeline's rollback). Not for reader actions. */
  removeBook(userId: string, bookId: string): Promise<void>;
  /** Soft delete (undo-able). Returns how many were deleted. */
  deleteBooks(userId: string, bookIds: string[]): Promise<number>;
  restoreBooks(userId: string, bookIds: string[]): Promise<number>;
  markAllSeen(userId: string): Promise<number>;
  /** Moves sources and tags onto `keepId`, fills its empty fields, then removes the others. */
  mergeBooks(userId: string, keepId: string, mergeIds: string[]): Promise<Book | null>;

  listTags(userId: string): Promise<Tag[]>;
  /** Returns the existing tag when the name already exists (case-insensitive). */
  createTag(userId: string, name: string): Promise<Tag>;
  /** Null when the tag doesn't exist; throws TagNameTakenError when another tag has the name. */
  renameTag(userId: string, tagId: string, name: string): Promise<Tag | null>;
  deleteTag(userId: string, tagId: string): Promise<boolean>;
  countTags(userId: string): Promise<number>;
  /** Replaces a book's tags. Tag ids that aren't this user's are ignored. */
  setBookTags(userId: string, bookId: string, tagIds: string[]): Promise<void>;
  /**
   * Deleting an account (or an idle guest): removes everything the user owns. The posts their networks
   * read in the last 2 days keep counting against those networks' daily caps. Safe to run twice.
   */
  eraseUser(userId: string): Promise<void>;
  /**
   * A guest logged in to an existing account: moves the guest's shelves (tags), jobs and spend to that
   * account. A shelf name both have becomes one shelf. Books move separately (moveBooks), one at a time,
   * so duplicates can be folded as they arrive. Safe to run again.
   */
  transferShelf(fromUserId: string, toUserId: string): Promise<void>;
  /** Moves the given books (or every book left, the Undo bin included) from one user to another. */
  moveBooks(fromUserId: string, toUserId: string, bookIds: string[] | 'all'): Promise<void>;
  /** Permanently removes books deleted more than 30 days ago. Returns how many. */
  purgeDeletedBooks(): Promise<number>;
  /**
   * Data we stop keeping (privacy policy): cached posts fetched before `postCacheBefore`, and the hashed
   * network of jobs created before `ipHashBefore` (only today's caps need it). Returns how many of each.
   */
  expireRetention(cutoffs: { postCacheBefore: Date; ipHashBefore: Date }): Promise<{ posts: number; ipHashes: number }>;
  /** Deletes finished jobs created before `before` (with their items). Returns how many. */
  purgeOldJobs(before: Date): Promise<number>;
  /** The admin Stats view's counts for a range in the operator's time zone (`admin_stats`, 0012). */
  adminStats(range: StatsRange, timeZone: string): Promise<AdminStatsRaw>;

  // Phase 8: moderation, reports and takedown.
  /** A post taken down: never read or shelved again, whoever pastes it. */
  isPostRemoved(platform: SourcePlatform, postId: string): Promise<boolean>;
  /** The post as a source on one of the user's live books, or null when it isn't on their shelf. */
  findOwnSource(userId: string, platform: SourcePlatform, postId: string): Promise<{ url: string; creatorHandle: string | null } | null>;
  /** False when this reader already has an open report on the post (reporting again changes nothing). */
  createReport(userId: string, report: NewReport): Promise<boolean>;
  /**
   * What is known about a post for a takedown: its link and creator from any report, the cache or a
   * shelf, and whether anyone reported it. Nulls when nothing is known (a link from an email).
   */
  describePost(platform: SourcePlatform, postId: string): Promise<{ url: string | null; creatorHandle: string | null; reported: boolean }>;
  countReportsSince(userId: string, since: Date): Promise<number>;
  listReports(status: 'open' | 'dismissed', limit: number): Promise<ReportRecord[]>;
  countReports(status: 'open' | 'dismissed'): Promise<number>;
  /** Closes the post's open reports without taking it down. Returns how many. */
  dismissReports(platform: SourcePlatform, postId: string): Promise<number>;
  listRemovedPosts(limit: number): Promise<RemovedPostRecord[]>;
  countRemovedPosts(): Promise<number>;
  /** Cached posts the content check skipped (explicit, graphic or refused). */
  listBlockedPosts(limit: number): Promise<BlockedPostRecord[]>;
  countBlockedPosts(): Promise<number>;
  postReach(platform: SourcePlatform, postId: string): Promise<PostReach>;
  /**
   * Takes a post down everywhere: removed for good, its cached reading deleted, gone as a source from
   * every shelf; books seen only in it are deleted unless the reader changed them (status, notes or
   * shelves). Closes its open reports. Safe to run twice.
   */
  takeDownPost(
    post: { platform: SourcePlatform; postId: string; url: string | null; creatorHandle: string | null },
    reason: RemovedPostRecord['reason'],
  ): Promise<TakedownResult>;
  /**
   * Undoes a block: a taken-down post can be read again (its books aren't restored), and a post the
   * content check skipped is marked as books in the cache, so the next paste shelves it for free.
   * False when the post was neither.
   */
  unblockPost(platform: SourcePlatform, postId: string): Promise<boolean>;
}

export interface BookPatch {
  title?: string;
  author?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  coverUrl?: string | null;
  publishedYear?: number | null;
  status?: BookStatus;
  notes?: string | null;
  verified?: boolean;
  isNew?: boolean;
  normalizedKey?: string;
}

export class TagNameTakenError extends Error {
  constructor() {
    super('A shelf with that name already exists.');
    this.name = 'TagNameTakenError';
  }
}

export const TERMINAL_STATUSES: readonly JobItemStatus[] = ['done', 'failed'];

export function deriveJobStatus(items: Pick<JobItemRecord, 'status'>[]): JobStatus {
  if (items.length === 0) return 'done';
  if (items.every((item) => item.status === 'queued')) return 'queued';
  if (items.some((item) => !TERMINAL_STATUSES.includes(item.status))) return 'running';
  return items.some((item) => item.status === 'done') ? 'done' : 'failed';
}

export type { BookStatus };

/** What `admin_stats` returns; `buildAdminStats` fills the days without posts and works out the forecast. */
export interface AdminStatsRaw
  extends Pick<AdminStats, 'timeZone' | 'from' | 'today' | 'clipped' | 'readers' | 'active7d' | 'posts' | 'perDay' | 'topFailures' | 'topBooks' | 'databaseBytes'> {
  monthStart: string;
  monthEnd: string;
  now: string;
  /** The spend rows of the posts read new in the range. */
  paidPostsSpend: number;
  spendMonth: { anthropic: number; apify: number };
}
