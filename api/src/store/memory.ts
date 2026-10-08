import { randomUUID } from 'node:crypto';
import type { Book, BookSource } from '@booktrap/shared';
import {
  TERMINAL_STATUSES,
  deriveJobStatus,
  type CachedPost,
  type JobItemRecord,
  type JobRecord,
  type JobWithItems,
  type LibraryStore,
} from './types';

/** Development and test storage. Data is lost when the process exits. */
export function createMemoryLibraryStore(): LibraryStore {
  const jobs = new Map<string, JobRecord & { ipHash: string | null }>();
  const items = new Map<string, JobItemRecord>();
  const cache = new Map<string, CachedPost>();
  const spend: { usd: number; at: Date }[] = [];
  const books = new Map<string, Omit<Book, 'sources'> & { deviceId: string; normalizedKey: string }>();
  const sources = new Map<string, (BookSource & { bookId: string })[]>();

  const now = () => new Date().toISOString();
  const withItems = (job: JobRecord): JobWithItems => ({
    ...job,
    items: [...items.values()].filter((item) => item.jobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
  const strip = ({ ipHash: _ipHash, ...job }: JobRecord & { ipHash: string | null }): JobRecord => job;

  return {
    async createJob(deviceId, ipHash, newItems) {
      const job = { id: randomUUID(), deviceId, status: 'queued' as const, clearedNew: false, createdAt: now(), ipHash };
      jobs.set(job.id, job);
      newItems.forEach((item, index) => {
        const id = randomUUID();
        items.set(id, {
          id,
          jobId: job.id,
          deviceId,
          inputUrl: item.inputUrl,
          postId: item.postId,
          kind: item.kind,
          status: 'queued',
          error: null,
          booksFound: 0,
          attempts: 0,
          // Keep insertion order stable for equal timestamps.
          createdAt: new Date(Date.now() + index).toISOString(),
        });
      });
      return withItems(strip(job));
    },
    async getJob(deviceId, jobId) {
      const job = jobs.get(jobId);
      return job && job.deviceId === deviceId ? withItems(strip(job)) : null;
    },
    async listJobs(deviceId, limit) {
      return [...jobs.values()]
        .filter((job) => job.deviceId === deviceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((job) => withItems(strip(job)));
    },
    async getItem(itemId) {
      return items.get(itemId) ?? null;
    },
    async updateItem(itemId, patch) {
      const item = items.get(itemId);
      if (item) items.set(itemId, { ...item, ...patch });
    },
    async unfinishedItems() {
      return [...items.values()].filter((item) => !TERMINAL_STATUSES.includes(item.status));
    },
    async refreshJobStatus(jobId) {
      const job = jobs.get(jobId);
      if (job) job.status = deriveJobStatus(withItems(job).items);
    },
    async countItemsSince(filter, since) {
      return [...items.values()].filter((item) => {
        if (new Date(item.createdAt) < since) return false;
        if ('deviceId' in filter) return item.deviceId === filter.deviceId;
        return jobs.get(item.jobId)?.ipHash === filter.ipHash;
      }).length;
    },
    async getCachedPost(postId) {
      return cache.get(postId) ?? null;
    },
    async putCachedPost(postId, value) {
      cache.set(postId, value);
    },
    async recordSpend(event) {
      spend.push({ usd: event.usd, at: new Date() });
    },
    async spendSince(since) {
      return spend.filter((entry) => entry.at >= since).reduce((sum, entry) => sum + entry.usd, 0);
    },
    async clearNewForJob(jobId, deviceId) {
      const job = jobs.get(jobId);
      if (!job || job.clearedNew) return;
      for (const book of books.values()) if (book.deviceId === deviceId) book.isNew = false;
      job.clearedNew = true;
    },
    async dedupCandidates(deviceId) {
      return [...books.values()]
        .filter((book) => book.deviceId === deviceId)
        .map(({ id, title, author, isbn10, isbn13, coverUrl, publishedYear }) => ({ id, title, author, isbn10, isbn13, coverUrl, publishedYear }));
    },
    async insertBook(deviceId, book) {
      const id = randomUUID();
      const stamp = now();
      books.set(id, {
        id,
        deviceId,
        title: book.title,
        author: book.author,
        isbn10: book.isbn10,
        isbn13: book.isbn13,
        coverUrl: book.coverUrl,
        publishedYear: book.publishedYear,
        status: 'want_to_read',
        verified: book.verified,
        unsure: book.unsure,
        isNew: true,
        notes: null,
        normalizedKey: book.normalizedKey,
        createdAt: stamp,
        updatedAt: stamp,
      });
      return id;
    },
    async fillBookGaps(bookId, fields) {
      const book = books.get(bookId);
      if (!book) return;
      for (const [key, value] of Object.entries(fields) as [keyof typeof fields, never][]) {
        if (book[key] == null && value != null) book[key] = value;
      }
    },
    async addSource(bookId, source) {
      const list = sources.get(bookId) ?? [];
      if (list.some((existing) => existing.postId === source.postId)) return false;
      list.push({ id: randomUUID(), bookId, createdAt: now(), ...source });
      sources.set(bookId, list);
      return true;
    },
    async listBooks(deviceId) {
      return [...books.values()]
        .filter((book) => book.deviceId === deviceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ deviceId: _device, normalizedKey: _key, ...book }) => ({
          ...book,
          sources: (sources.get(book.id) ?? []).map(({ bookId: _bookId, ...source }) => source),
        }));
    },
  };
}
