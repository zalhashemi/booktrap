import { randomUUID } from 'node:crypto';
import type { Book, BookSource, Tag } from '@booktrap/shared';
import {
  TERMINAL_STATUSES,
  TagNameTakenError,
  deriveJobStatus,
  type CachedPost,
  type JobItemRecord,
  type JobRecord,
  type JobWithItems,
  type LibraryStore,
} from './types';

type BookRow = Omit<Book, 'sources' | 'tags'> & { deviceId: string; normalizedKey: string; deletedAt: string | null };

/** Development and test storage. Data is lost when the process exits. */
export function createMemoryLibraryStore(): LibraryStore {
  const jobs = new Map<string, JobRecord & { ipHash: string | null }>();
  const items = new Map<string, JobItemRecord>();
  const cache = new Map<string, CachedPost>();
  const spend: { usd: number; at: Date }[] = [];
  const books = new Map<string, BookRow>();
  const sources = new Map<string, (BookSource & { bookId: string })[]>();
  const tags = new Map<string, Tag & { deviceId: string }>();
  const bookTags = new Map<string, Set<string>>();

  const now = () => new Date().toISOString();
  const withItems = (job: JobRecord): JobWithItems => ({
    ...job,
    items: [...items.values()].filter((item) => item.jobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
  const strip = ({ ipHash: _ipHash, ...job }: JobRecord & { ipHash: string | null }): JobRecord => job;
  const liveBook = (deviceId: string, bookId: string) => {
    const book = books.get(bookId);
    return book && book.deviceId === deviceId && !book.deletedAt ? book : null;
  };
  const toBook = ({ deviceId: _device, normalizedKey: _key, deletedAt: _deleted, ...book }: BookRow): Book => ({
    ...book,
    sources: (sources.get(book.id) ?? []).map(({ bookId: _bookId, ...source }) => source),
    tags: [...(bookTags.get(book.id) ?? [])]
      .map((tagId) => tags.get(tagId))
      .filter((tag): tag is Tag & { deviceId: string } => Boolean(tag))
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const store: LibraryStore = {
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
        .filter((book) => book.deviceId === deviceId && !book.deletedAt)
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
        deletedAt: null,
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
        .filter((book) => book.deviceId === deviceId && !book.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toBook);
    },

    async getBook(deviceId, bookId) {
      const book = liveBook(deviceId, bookId);
      return book ? toBook(book) : null;
    },
    async updateBook(deviceId, bookId, patch) {
      const book = liveBook(deviceId, bookId);
      if (!book) return null;
      Object.assign(book, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), { updatedAt: now() });
      return toBook(book);
    },
    async deleteBooks(deviceId, bookIds) {
      let count = 0;
      for (const id of bookIds) {
        const book = liveBook(deviceId, id);
        if (book) {
          book.deletedAt = now();
          count++;
        }
      }
      return count;
    },
    async restoreBooks(deviceId, bookIds) {
      let count = 0;
      for (const id of bookIds) {
        const book = books.get(id);
        if (book && book.deviceId === deviceId && book.deletedAt) {
          book.deletedAt = null;
          count++;
        }
      }
      return count;
    },
    async markAllSeen(deviceId) {
      let count = 0;
      for (const book of books.values()) {
        if (book.deviceId === deviceId && book.isNew && !book.deletedAt) {
          book.isNew = false;
          count++;
        }
      }
      return count;
    },
    async mergeBooks(deviceId, keepId, mergeIds) {
      const keep = liveBook(deviceId, keepId);
      if (!keep) return null;
      for (const id of mergeIds) {
        if (id === keepId) continue;
        const other = liveBook(deviceId, id);
        if (!other) continue;
        for (const source of sources.get(id) ?? []) {
          const { bookId: _bookId, id: _id, createdAt: _createdAt, ...rest } = source;
          await store.addSource(keepId, rest);
        }
        const keepTags = bookTags.get(keepId) ?? new Set<string>();
        for (const tagId of bookTags.get(id) ?? []) keepTags.add(tagId);
        bookTags.set(keepId, keepTags);
        await store.fillBookGaps(keepId, { isbn10: other.isbn10, isbn13: other.isbn13, coverUrl: other.coverUrl, publishedYear: other.publishedYear });
        if (!keep.notes && other.notes) keep.notes = other.notes;
        books.delete(id);
        sources.delete(id);
        bookTags.delete(id);
      }
      return toBook(keep);
    },

    async listTags(deviceId) {
      return [...tags.values()]
        .filter((tag) => tag.deviceId === deviceId)
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async createTag(deviceId, name) {
      const existing = [...tags.values()].find((tag) => tag.deviceId === deviceId && sameName(tag.name, name));
      if (existing) return { id: existing.id, name: existing.name };
      const tag = { id: randomUUID(), deviceId, name };
      tags.set(tag.id, tag);
      return { id: tag.id, name };
    },
    async renameTag(deviceId, tagId, name) {
      const tag = tags.get(tagId);
      if (!tag || tag.deviceId !== deviceId) return null;
      if ([...tags.values()].some((other) => other.deviceId === deviceId && other.id !== tagId && sameName(other.name, name))) {
        throw new TagNameTakenError();
      }
      tag.name = name;
      return { id: tag.id, name };
    },
    async deleteTag(deviceId, tagId) {
      const tag = tags.get(tagId);
      if (!tag || tag.deviceId !== deviceId) return false;
      tags.delete(tagId);
      for (const set of bookTags.values()) set.delete(tagId);
      return true;
    },
    async purgeDeletedBooks() {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let count = 0;
      for (const [id, book] of books) {
        if (book.deletedAt && new Date(book.deletedAt).getTime() < cutoff) {
          books.delete(id);
          sources.delete(id);
          bookTags.delete(id);
          count++;
        }
      }
      return count;
    },
    async setBookTags(deviceId, bookId, tagIds) {
      if (!liveBook(deviceId, bookId)) return;
      const owned = tagIds.filter((id) => tags.get(id)?.deviceId === deviceId);
      bookTags.set(bookId, new Set(owned));
    },
  };
  return store;
}
