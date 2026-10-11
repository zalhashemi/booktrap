import { randomUUID } from 'node:crypto';
import { postKey, type Book, type BookSource, type Tag } from '@booktrap/shared';
import {
  DailyCapError,
  TERMINAL_STATUSES,
  TagNameTakenError,
  deriveJobStatus,
  type CachedPost,
  type JobItemRecord,
  type JobRecord,
  type JobWithItems,
  type LibraryStore,
  type NewItem,
} from './types';

type BookRow = Omit<Book, 'sources' | 'tags'> & { userId: string; normalizedKey: string; verified: boolean; deletedAt: string | null };

/** Development and test storage. Data is lost when the process exits. */
export function createMemoryLibraryStore(): LibraryStore {
  const jobs = new Map<string, JobRecord & { ipHash: string | null }>();
  const items = new Map<string, JobItemRecord>();
  const cache = new Map<string, CachedPost & { fetchedAt: Date }>();
  const spend: { usd: number; at: Date }[] = [];
  const books = new Map<string, BookRow>();
  const sources = new Map<string, (BookSource & { bookId: string })[]>();
  const tags = new Map<string, Tag & { userId: string }>();
  const bookTags = new Map<string, Set<string>>();
  /** Recent posts of erased users, still counted against their networks' daily caps. */
  const networkUsage: { ipHash: string; usedAt: Date }[] = [];

  const now = () => new Date().toISOString();
  const withItems = (job: JobRecord): JobWithItems => ({
    ...job,
    items: [...items.values()].filter((item) => item.jobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
  const strip = ({ ipHash: _ipHash, ...job }: JobRecord & { ipHash: string | null }): JobRecord => job;
  const liveBook = (userId: string, bookId: string) => {
    const book = books.get(bookId);
    return book && book.userId === userId && !book.deletedAt ? book : null;
  };
  const toBook = ({ userId: _user, normalizedKey: _key, verified: _verified, deletedAt: _deleted, ...book }: BookRow): Book => ({
    ...book,
    sources: (sources.get(book.id) ?? []).map(({ bookId: _bookId, ...source }) => source),
    tags: [...(bookTags.get(book.id) ?? [])]
      .map((tagId) => tags.get(tagId))
      .filter((tag): tag is Tag & { userId: string } => Boolean(tag))
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const childrenOf = (parentItemId: string) =>
    [...items.values()].filter((item) => item.parentItemId === parentItemId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  /** Posts counted against the daily caps: every item except a collection link itself. */
  const countPosts = (since: Date, match: (item: JobItemRecord) => boolean) =>
    [...items.values()].filter((item) => new Date(item.createdAt) >= since && item.kind !== 'collection' && match(item)).length;
  const carriedOver = (ipHash: string, since: Date) => networkUsage.filter((use) => use.ipHash === ipHash && use.usedAt >= since).length;
  const postsSince = (userId: string, ipHash: string | null, since: Date) => ({
    byUser: countPosts(since, (item) => item.userId === userId),
    byIp: ipHash ? countPosts(since, (item) => jobs.get(item.jobId)?.ipHash === ipHash) + carriedOver(ipHash, since) : 0,
  });
  const addItem = (jobId: string, userId: string, parentItemId: string | null, item: NewItem, at: number): JobItemRecord => {
    const record: JobItemRecord = {
      id: randomUUID(),
      jobId,
      userId,
      inputUrl: item.inputUrl,
      platform: item.platform,
      postId: item.postId,
      kind: item.kind,
      status: 'queued',
      error: null,
      booksFound: 0,
      attempts: 0,
      parentItemId,
      note: null,
      // Distinct timestamps keep the pasted (or listed) order.
      createdAt: new Date(at).toISOString(),
    };
    items.set(record.id, record);
    return record;
  };

  const store: LibraryStore = {
    // No awaits between counting and inserting: in one process that makes the caps atomic, as in Postgres.
    async createJob(userId, ipHash, newItems, caps) {
      if (caps) {
        const used = postsSince(userId, ipHash, caps.since);
        if (used.byUser + caps.posts > caps.perUser) throw new DailyCapError('user', used.byUser);
        if (ipHash && used.byIp + caps.posts > caps.perIp) throw new DailyCapError('ip', used.byIp);
      }
      const job = { id: randomUUID(), userId, status: 'queued' as const, clearedNew: false, createdAt: now(), ipHash };
      jobs.set(job.id, job);
      const base = Date.now();
      newItems.forEach((item, index) => addItem(job.id, userId, null, item, base + index));
      return withItems(strip(job));
    },
    async addChildItems(parent, children, caps) {
      if (children.length === 0) return [];
      const existing = childrenOf(parent.id);
      if (existing.length) return existing;
      let room = children.length;
      if (caps) {
        const ipHash = jobs.get(parent.jobId)?.ipHash ?? null;
        const used = postsSince(parent.userId, ipHash, caps.since);
        room = Math.min(room, caps.perUser - used.byUser, ipHash ? caps.perIp - used.byIp : Infinity);
      }
      const base = Date.now() + 1000;
      return children.slice(0, Math.max(0, room)).map((child, index) => addItem(parent.jobId, parent.userId, parent.id, child, base + index));
    },
    async childItems(parentItemId) {
      return childrenOf(parentItemId);
    },
    async jobIpHash(jobId) {
      return jobs.get(jobId)?.ipHash ?? null;
    },
    async getJob(userId, jobId) {
      const job = jobs.get(jobId);
      return job && job.userId === userId ? withItems(strip(job)) : null;
    },
    async listJobs(userId, limit) {
      return [...jobs.values()]
        .filter((job) => job.userId === userId)
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
      if ('userId' in filter) return countPosts(since, (item) => item.userId === filter.userId);
      return countPosts(since, (item) => jobs.get(item.jobId)?.ipHash === filter.ipHash) + carriedOver(filter.ipHash, since);
    },
    async getCachedPost(platform, postId) {
      const hit = cache.get(postKey(platform, postId));
      if (!hit) return null;
      const { fetchedAt: _fetchedAt, ...value } = hit;
      return value;
    },
    async putCachedPost(platform, postId, value) {
      cache.set(postKey(platform, postId), { ...value, fetchedAt: new Date() });
    },
    async recordSpend(event) {
      spend.push({ usd: event.usd, at: new Date() });
    },
    async spendSince(since) {
      return spend.filter((entry) => entry.at >= since).reduce((sum, entry) => sum + entry.usd, 0);
    },
    async clearNewForJob(jobId, userId) {
      const job = jobs.get(jobId);
      if (!job || job.clearedNew) return;
      for (const book of books.values()) if (book.userId === userId) book.isNew = false;
      job.clearedNew = true;
    },
    async dedupCandidates(userId) {
      return [...books.values()]
        .filter((book) => book.userId === userId && !book.deletedAt)
        .map(({ id, title, author, isbn10, isbn13, coverUrl, publishedYear }) => ({ id, title, author, isbn10, isbn13, coverUrl, publishedYear }));
    },
    async insertBook(userId, book) {
      const id = randomUUID();
      const stamp = now();
      books.set(id, {
        id,
        userId,
        title: book.title,
        author: book.author,
        isbn10: book.isbn10,
        isbn13: book.isbn13,
        coverUrl: book.coverUrl,
        publishedYear: book.publishedYear,
        status: 'want_to_read',
        verified: book.verified,
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
      if (list.some((existing) => existing.platform === source.platform && existing.postId === source.postId)) return false;
      list.push({ id: randomUUID(), bookId, createdAt: now(), ...source });
      sources.set(bookId, list);
      return true;
    },
    async listBooks(userId) {
      return [...books.values()]
        .filter((book) => book.userId === userId && !book.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toBook);
    },

    async getBook(userId, bookId) {
      const book = liveBook(userId, bookId);
      return book ? toBook(book) : null;
    },
    async updateBook(userId, bookId, patch) {
      const book = liveBook(userId, bookId);
      if (!book) return null;
      Object.assign(book, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), { updatedAt: now() });
      return toBook(book);
    },
    async removeBook(userId, bookId) {
      if (books.get(bookId)?.userId !== userId) return;
      books.delete(bookId);
      sources.delete(bookId);
      bookTags.delete(bookId);
    },
    async deleteBooks(userId, bookIds) {
      let count = 0;
      for (const id of bookIds) {
        const book = liveBook(userId, id);
        if (book) {
          book.deletedAt = now();
          count++;
        }
      }
      return count;
    },
    async restoreBooks(userId, bookIds) {
      let count = 0;
      for (const id of bookIds) {
        const book = books.get(id);
        if (book && book.userId === userId && book.deletedAt) {
          book.deletedAt = null;
          count++;
        }
      }
      return count;
    },
    async markAllSeen(userId) {
      let count = 0;
      for (const book of books.values()) {
        if (book.userId === userId && book.isNew && !book.deletedAt) {
          book.isNew = false;
          count++;
        }
      }
      return count;
    },
    async mergeBooks(userId, keepId, mergeIds) {
      const keep = liveBook(userId, keepId);
      if (!keep) return null;
      for (const id of mergeIds) {
        if (id === keepId) continue;
        const other = liveBook(userId, id);
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

    async listTags(userId) {
      return [...tags.values()]
        .filter((tag) => tag.userId === userId)
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async createTag(userId, name) {
      const existing = [...tags.values()].find((tag) => tag.userId === userId && sameName(tag.name, name));
      if (existing) return { id: existing.id, name: existing.name };
      const tag = { id: randomUUID(), userId, name };
      tags.set(tag.id, tag);
      return { id: tag.id, name };
    },
    async renameTag(userId, tagId, name) {
      const tag = tags.get(tagId);
      if (!tag || tag.userId !== userId) return null;
      if ([...tags.values()].some((other) => other.userId === userId && other.id !== tagId && sameName(other.name, name))) {
        throw new TagNameTakenError();
      }
      tag.name = name;
      return { id: tag.id, name };
    },
    async deleteTag(userId, tagId) {
      const tag = tags.get(tagId);
      if (!tag || tag.userId !== userId) return false;
      tags.delete(tagId);
      for (const set of bookTags.values()) set.delete(tagId);
      return true;
    },
    async eraseUser(userId) {
      const recent = Date.now() - 2 * 24 * 60 * 60 * 1000;
      for (const [id, item] of items) {
        if (item.userId !== userId) continue;
        const ipHash = jobs.get(item.jobId)?.ipHash;
        const usedAt = new Date(item.createdAt);
        if (ipHash && item.kind !== 'collection' && usedAt.getTime() >= recent) networkUsage.push({ ipHash, usedAt });
        items.delete(id);
      }
      for (const [id, job] of jobs) if (job.userId === userId) jobs.delete(id);
      for (const [id, book] of books) {
        if (book.userId !== userId) continue;
        books.delete(id);
        sources.delete(id);
        bookTags.delete(id);
      }
      for (const [id, tag] of tags) if (tag.userId === userId) tags.delete(id);
    },
    async transferShelf(fromUserId, toUserId) {
      for (const [id, tag] of tags) {
        if (tag.userId !== fromUserId) continue;
        const same = [...tags.values()].find((other) => other.userId === toUserId && sameName(other.name, tag.name));
        if (!same) {
          tag.userId = toUserId;
          continue;
        }
        for (const set of bookTags.values()) {
          if (set.delete(id)) set.add(same.id);
        }
        tags.delete(id);
      }
      for (const job of jobs.values()) if (job.userId === fromUserId) job.userId = toUserId;
      for (const item of items.values()) if (item.userId === fromUserId) item.userId = toUserId;
    },
    async moveBooks(fromUserId, toUserId, bookIds) {
      for (const book of books.values()) {
        if (book.userId === fromUserId && (bookIds === 'all' || bookIds.includes(book.id))) book.userId = toUserId;
      }
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
    async expireRetention({ postCacheBefore, ipHashBefore }) {
      let posts = 0;
      for (const [key, value] of cache) {
        if (value.fetchedAt < postCacheBefore) {
          cache.delete(key);
          posts++;
        }
      }
      let ipHashes = 0;
      for (let index = networkUsage.length - 1; index >= 0; index--) {
        if (networkUsage[index]!.usedAt < ipHashBefore) {
          networkUsage.splice(index, 1);
          ipHashes++;
        }
      }
      for (const job of jobs.values()) {
        if (job.ipHash && new Date(job.createdAt) < ipHashBefore) {
          job.ipHash = null;
          ipHashes++;
        }
      }
      return { posts, ipHashes };
    },
    async setBookTags(userId, bookId, tagIds) {
      if (!liveBook(userId, bookId)) return;
      const owned = tagIds.filter((id) => tags.get(id)?.userId === userId);
      bookTags.set(bookId, new Set(owned));
    },
  };
  return store;
}
