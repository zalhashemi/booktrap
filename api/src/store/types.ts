import type { Book, BookStatus, Evidence, JobItemStatus } from '@booktrap/shared';
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
}

export const TERMINAL_STATUSES: readonly JobItemStatus[] = ['done', 'failed'];

export function deriveJobStatus(items: Pick<JobItemRecord, 'status'>[]): JobStatus {
  if (items.length === 0) return 'done';
  if (items.every((item) => item.status === 'queued')) return 'queued';
  if (items.some((item) => !TERMINAL_STATUSES.includes(item.status))) return 'running';
  return items.some((item) => item.status === 'done') ? 'done' : 'failed';
}

export type { BookStatus };
