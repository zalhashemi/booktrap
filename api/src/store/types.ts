import type { Book, BookStatus, Evidence, JobItemStatus, SourcePlatform, Tag } from '@booktrap/shared';
import type { ExtractedBook } from '../pipeline/extract';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type ItemKind = 'video' | 'carousel' | 'collection' | 'collection_child';

export interface JobRecord {
  id: string;
  deviceId: string;
  status: JobStatus;
  clearedNew: boolean;
  createdAt: string;
}

export interface JobItemRecord {
  id: string;
  jobId: string;
  deviceId: string;
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
  caption: string;
  creatorHandle: string | null;
  thumbnailUrl: string | null;
}

export interface CachedPost {
  post: CachedPostMeta;
  books: ExtractedBook[];
  model: string;
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
  deviceId: string | null;
  jobItemId: string | null;
  provider: 'apify' | 'anthropic';
  usd: number;
  detail?: Record<string, unknown>;
}

/** Everything the jobs pipeline and the library routes need from storage. Always scoped by device. */
export interface LibraryStore {
  createJob(
    deviceId: string,
    ipHash: string | null,
    items: NewItem[],
  ): Promise<JobWithItems>;
  /** Adds the videos a collection expanded into, as children of that item, to the same job. */
  addChildItems(parent: JobItemRecord, items: NewItem[]): Promise<JobItemRecord[]>;
  childItems(parentItemId: string): Promise<JobItemRecord[]>;
  /** The keyed IP hash the job was created from, for the per-IP cap on collection expansion. */
  jobIpHash(jobId: string): Promise<string | null>;
  getJob(deviceId: string, jobId: string): Promise<JobWithItems | null>;
  listJobs(deviceId: string, limit: number): Promise<JobWithItems[]>;
  getItem(itemId: string): Promise<JobItemRecord | null>;
  updateItem(
    itemId: string,
    patch: Partial<Pick<JobItemRecord, 'status' | 'error' | 'booksFound' | 'platform' | 'postId' | 'kind' | 'attempts' | 'note'>>,
  ): Promise<void>;
  /** Items that were queued or mid-flight when the process stopped (free hosting sleeps). */
  unfinishedItems(): Promise<JobItemRecord[]>;
  refreshJobStatus(jobId: string): Promise<void>;
  /** Posts submitted since `since`. A collection link itself isn't counted; its videos are. */
  countItemsSince(filter: { deviceId: string } | { ipHash: string }, since: Date): Promise<number>;

  /** Keyed by platform + post id: the same id on two platforms is two different posts. */
  getCachedPost(platform: SourcePlatform, postId: string): Promise<CachedPost | null>;
  putCachedPost(platform: SourcePlatform, postId: string, value: CachedPost): Promise<void>;

  recordSpend(event: SpendEvent): Promise<void>;
  spendSince(since: Date): Promise<number>;

  /** The first book a job adds clears the previous batch's "new" highlight (brief §7). Idempotent per job. */
  clearNewForJob(jobId: string, deviceId: string): Promise<void>;
  dedupCandidates(deviceId: string): Promise<DedupCandidate[]>;
  insertBook(deviceId: string, book: NewBook): Promise<string>;
  /** Fills only fields that are currently empty, so user edits are never overwritten. */
  fillBookGaps(bookId: string, fields: Partial<Pick<NewBook, 'isbn10' | 'isbn13' | 'coverUrl' | 'publishedYear'>>): Promise<void>;
  /** False when this post (platform + id) is already a source of the book. */
  addSource(bookId: string, source: NewSource): Promise<boolean>;
  listBooks(deviceId: string): Promise<Book[]>;

  // Phase 3: the reader's own edits. Every method is scoped to the device; unknown ids are ignored.
  getBook(deviceId: string, bookId: string): Promise<Book | null>;
  updateBook(deviceId: string, bookId: string, patch: BookPatch): Promise<Book | null>;
  /** Permanent delete of one just-inserted book (the pipeline's rollback). Not for reader actions. */
  removeBook(deviceId: string, bookId: string): Promise<void>;
  /** Soft delete (undo-able). Returns how many were deleted. */
  deleteBooks(deviceId: string, bookIds: string[]): Promise<number>;
  restoreBooks(deviceId: string, bookIds: string[]): Promise<number>;
  markAllSeen(deviceId: string): Promise<number>;
  /** Moves sources and tags onto `keepId`, fills its empty fields, then removes the others. */
  mergeBooks(deviceId: string, keepId: string, mergeIds: string[]): Promise<Book | null>;

  listTags(deviceId: string): Promise<Tag[]>;
  /** Returns the existing tag when the name already exists (case-insensitive). */
  createTag(deviceId: string, name: string): Promise<Tag>;
  /** Null when the tag doesn't exist; throws TagNameTakenError when another tag has the name. */
  renameTag(deviceId: string, tagId: string, name: string): Promise<Tag | null>;
  deleteTag(deviceId: string, tagId: string): Promise<boolean>;
  /** Replaces a book's tags. Tag ids that aren't this device's are ignored. */
  setBookTags(deviceId: string, bookId: string, tagIds: string[]): Promise<void>;
  /** Permanently removes books deleted more than 30 days ago. Returns how many. */
  purgeDeletedBooks(): Promise<number>;
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
