import type { Book, BookStatus, Evidence, JobItemStatus, Tag } from '@booktrap/shared';
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
  postId: string | null;
  kind: ItemKind | null;
  status: JobItemStatus;
  error: string | null;
  booksFound: number;
  attempts: number;
  createdAt: string;
}

export type JobWithItems = JobRecord & { items: JobItemRecord[] };

export interface CachedPostMeta {
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
  verified: boolean;
  unsure: boolean;
  normalizedKey: string;
}

export interface NewSource {
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
    items: { inputUrl: string; postId: string | null; kind: ItemKind | null }[],
  ): Promise<JobWithItems>;
  getJob(deviceId: string, jobId: string): Promise<JobWithItems | null>;
  listJobs(deviceId: string, limit: number): Promise<JobWithItems[]>;
  getItem(itemId: string): Promise<JobItemRecord | null>;
  updateItem(itemId: string, patch: Partial<Pick<JobItemRecord, 'status' | 'error' | 'booksFound' | 'postId' | 'kind' | 'attempts'>>): Promise<void>;
  /** Items that were queued or mid-flight when the process stopped (free hosting sleeps). */
  unfinishedItems(): Promise<JobItemRecord[]>;
  refreshJobStatus(jobId: string): Promise<void>;
  countItemsSince(filter: { deviceId: string } | { ipHash: string }, since: Date): Promise<number>;

  getCachedPost(postId: string): Promise<CachedPost | null>;
  putCachedPost(postId: string, value: CachedPost): Promise<void>;

  recordSpend(event: SpendEvent): Promise<void>;
  spendSince(since: Date): Promise<number>;

  /** The first book a job adds clears the previous batch's "new" highlight (brief §7). Idempotent per job. */
  clearNewForJob(jobId: string, deviceId: string): Promise<void>;
  dedupCandidates(deviceId: string): Promise<DedupCandidate[]>;
  insertBook(deviceId: string, book: NewBook): Promise<string>;
  /** Fills only fields that are currently empty, so user edits are never overwritten. */
  fillBookGaps(bookId: string, fields: Partial<Pick<NewBook, 'isbn10' | 'isbn13' | 'coverUrl' | 'publishedYear'>>): Promise<void>;
  /** False when this post is already a source of the book. */
  addSource(bookId: string, source: NewSource): Promise<boolean>;
  listBooks(deviceId: string): Promise<Book[]>;

  // Phase 3: the reader's own edits. Every method is scoped to the device; unknown ids are ignored.
  getBook(deviceId: string, bookId: string): Promise<Book | null>;
  updateBook(deviceId: string, bookId: string, patch: BookPatch): Promise<Book | null>;
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
  unsure?: boolean;
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
