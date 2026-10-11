import { describe, expect, it, vi } from 'vitest';
import { createMemoryLibraryStore } from '../store/memory';
import type { LibraryStore } from '../store/types';
import type { PostData } from './fetchers';
import { PipelineError } from './errors';
import type { ExtractedBook } from './extract';
import { processItem, type PipelineDeps } from './process';
import { JobQueue } from './queue';
import type { Verification } from './verify';

const USER = '11111111-1111-4111-8111-111111111111';
const quietLog = { info: () => {}, warn: () => {}, error: () => {} };

function post(id: string, overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'tiktok',
    postId: id,
    url: `https://www.tiktok.com/@reader/video/${id}`,
    kind: 'video',
    caption: 'books with yearning',
    hashtags: ['booktok'],
    creatorHandle: 'reader',
    thumbnailUrl: 'https://p16.tiktokcdn.com/thumb.jpg',
    imageUrls: [],
    videoUrl: 'https://api.apify.com/v2/key-value-stores/x/records/video.mp4',
    subtitleUrl: null,
    durationSec: 30,
    ...overrides,
  };
}

const book = (title: string, author: string | null, extra: Partial<ExtractedBook> = {}): ExtractedBook => ({
  title,
  author,
  confidence: 0.95,
  evidence: 'caption',
  prominence: 'featured',
  notes: null,
  ...extra,
});

function verified(title: string, author: string | null, isbn13: string | null = null): Verification {
  return { verified: true, title, author, isbn10: null, isbn13, coverUrl: null, publishedYear: 2020, score: 2 };
}

function makeDeps(store: LibraryStore, booksByPost: Record<string, ExtractedBook[]>, overrides: Partial<PipelineDeps> = {}) {
  const fetchPost = vi.fn(async (platform: PostData['platform'], _url: string, postId: string) => ({
    post: post(postId, platform === 'instagram' ? { platform, url: `https://www.instagram.com/p/${postId}/`, kind: 'carousel' } : {}),
    costUsd: 0.005,
  }));
  const extractBooks = vi.fn(async (input: { caption: string }) => {
    const id = Object.keys(booksByPost).find((key) => input.caption.includes(key)) ?? Object.keys(booksByPost)[0]!;
    return { books: booksByPost[id]!, content: 'books', model: 'claude-opus-5-5', costUsd: 0.08, usage: { inputTokens: 1, outputTokens: 1 } };
  });
  const verifyBook = vi.fn(async (title: string, author: string | null) => verified(title, author));
  const deps: PipelineDeps = {
    store,
    log: quietLog,
    settings: {
      apifyToken: 'apify',
      anthropic: {} as never,
      model: 'claude-opus-5-5',
      effort: 'medium',
      includeBackgroundBooks: false,
      monthlyBudgetUsd: 20,
      killSwitch: false,
      videosPerCollection: 25,
      dailyCapPerUser: 40,
      dailyCapPerIp: 120,
    },
    fetchPost,
    extractBooks: extractBooks as never,
    verifyBook,
    loadMedia: async () => ({ images: [], transcript: null }),
    ...overrides,
  };
  return { deps, fetchPost, extractBooks, verifyBook };
}

async function runJob(store: LibraryStore, deps: PipelineDeps, urls: string[]) {
  const job = await store.createJob(
    USER,
    null,
    urls.map((url) => {
      const instagram = /instagram\.com\/(?:p|reel)\/([\w-]+)/.exec(url);
      return instagram
        ? { inputUrl: url, platform: 'instagram' as const, postId: instagram[1]!, kind: null }
        : { inputUrl: url, platform: 'tiktok' as const, postId: /(\d+)$/.exec(url)?.[1] ?? null, kind: 'video' as const };
    }),
  );
  for (const item of job.items) await processItem(item.id, deps);
  return (await store.getJob(USER, job.id))!;
}

const URL_A = 'https://www.tiktok.com/@reader/video/7672440936101727519';
const URL_B = 'https://www.tiktok.com/@reader/video/7674670540518395169';

describe('processItem', () => {
  it('shelves verified books with their source and marks them new', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Giovanni’s Room', 'James Baldwin')] });
    const job = await runJob(store, deps, [URL_A]);

    expect(job.status).toBe('done');
    expect(job.items[0]).toMatchObject({ status: 'done', booksFound: 1, error: null });
    const [shelved] = await store.listBooks(USER);
    expect(shelved).toMatchObject({ title: 'Giovanni’s Room', isNew: true });
    expect(shelved).not.toHaveProperty('unsure');
    expect(shelved!.sources[0]).toMatchObject({ platform: 'tiktok', postId: '7672440936101727519', creatorHandle: 'reader', evidence: 'caption' });
    expect(await store.spendSince(new Date(0))).toBeCloseTo(0.085);
  });

  it('adds low-confidence and unmatched books as read, without flagging them', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Secret Hist', 'Donna T', { confidence: 0.4 }), book('Zine', 'Sam Lee')] });
    deps.verifyBook = vi.fn(async (title: string, author: string | null) =>
      title === 'Zine'
        ? { verified: false, title, author, isbn10: null, isbn13: null, coverUrl: null, publishedYear: null, score: 0 }
        : verified('The Secret History', 'Donna Tartt'),
    );
    await runJob(store, deps, [URL_A]);
    const books = await store.listBooks(USER);
    expect(books.map((b) => [b.title, b.author, b.coverUrl])).toEqual(
      expect.arrayContaining([
        ['The Secret History', 'Donna Tartt', null],
        ['Zine', 'Sam Lee', null],
      ]),
    );
    for (const shelved of books) expect(shelved).not.toHaveProperty('unsure');
  });

  it('never creates a second row for the same book; it adds the new post as a source', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('The Song of Achilles', 'Madeline Miller')] });
    await runJob(store, deps, [URL_A]);
    deps.extractBooks = vi.fn(async () => ({
      books: [book('Song of Achilles', 'Miller, Madeline')],
      model: 'm',
      costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    })) as never;
    await runJob(store, deps, [URL_B]);

    const books = await store.listBooks(USER);
    expect(books).toHaveLength(1);
    expect(books[0]!.sources.map((s) => s.postId)).toEqual(['7672440936101727519', '7674670540518395169']);
  });

  it('keeps no caption in the shared post cache, only what a later paste needs', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    const job = await store.createJob(USER, null, [{ inputUrl: URL_A, platform: 'tiktok', postId: '7672440936101727519', kind: 'video' }]);
    await processItem(job.items[0]!.id, deps);
    const cached = await store.getCachedPost('tiktok', '7672440936101727519');
    expect(cached?.books).toHaveLength(1);
    expect(cached?.post).not.toHaveProperty('caption');
  });

  it('pays for a post only once: a second paste of the same post uses the cache', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost, extractBooks } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    await runJob(store, deps, [URL_A]);
    await runJob(store, deps, [URL_A]);
    expect(fetchPost).toHaveBeenCalledTimes(1);
    expect(extractBooks).toHaveBeenCalledTimes(1);
    expect(await store.listBooks(USER)).toHaveLength(1);
  });

  it('leaves background-only books off the shelf unless enabled', async () => {
    const store = createMemoryLibraryStore();
    const books = [book('In Memoriam', 'Alice Winn'), book('Wild Dark Shore', 'Charlotte McConaghy', { prominence: 'background', evidence: 'spine' })];
    const { deps } = makeDeps(store, { x: books });
    await runJob(store, deps, [URL_A]);
    expect((await store.listBooks(USER)).map((b) => b.title)).toEqual(['In Memoriam']);

    const all = createMemoryLibraryStore();
    const withBackground = makeDeps(all, { x: books }).deps;
    withBackground.settings = { ...withBackground.settings, includeBackgroundBooks: true };
    await runJob(all, withBackground, [URL_A]);
    expect(await all.listBooks(USER)).toHaveLength(2);
  });

  it('clears the previous batch’s "new" highlight when a later import adds books', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    await runJob(store, deps, [URL_A]);
    deps.extractBooks = vi.fn(async () => ({ books: [book('Piranesi', 'Susanna Clarke')], model: 'm', costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 } })) as never;
    await runJob(store, deps, [URL_B]);
    const books = await store.listBooks(USER);
    expect(Object.fromEntries(books.map((b) => [b.title, b.isNew]))).toEqual({ Babel: false, Piranesi: true });
  });

  it('stores a readable reason when a post fails', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {});
    deps.fetchPost = vi.fn(async () => {
      throw new PipelineError('unavailable', 'This account is private, so BookTrap can’t see the post.');
    });
    const job = await runJob(store, deps, [URL_A]);
    expect(job.status).toBe('failed');
    expect(job.items[0]).toMatchObject({ status: 'failed', error: 'This account is private, so BookTrap can’t see the post.' });
  });

  it('refuses to spend once the monthly budget is used up', async () => {
    const store = createMemoryLibraryStore();
    await store.recordSpend({ userId: null, jobItemId: null, provider: 'anthropic', usd: 25 });
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', null)] });
    const job = await runJob(store, deps, [URL_A]);
    expect(fetchPost).not.toHaveBeenCalled();
    expect(job.items[0]!.error).toMatch(/budget/);
  });

});

describe('collections', () => {
  const COLLECTION = 'https://www.tiktok.com/@reader/collection/Dark%20academia-7301234567890123456';
  const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => String(7600000000000000000n + BigInt(from + i)));
  const listing = (postIds: string[], more = false) => ({
    videos: postIds.map((postId) => ({ postId, url: `https://www.tiktok.com/@reader/video/${postId}`, kind: 'video' as const })),
    more,
    costUsd: 0.2,
  });

  /** Runs the collection item, then every child it queued, like the job queue would. */
  async function runCollection(store: LibraryStore, deps: PipelineDeps, url = COLLECTION, ipHash: string | null = null) {
    const queued: string[] = [];
    deps.enqueue = (id) => queued.push(id);
    const job = await store.createJob(USER, ipHash, [{ inputUrl: url, platform: 'tiktok', postId: null, kind: 'collection' }]);
    await processItem(job.items[0]!.id, deps);
    for (const id of queued.splice(0)) await processItem(id, deps);
    return (await store.getJob(USER, job.id))!;
  }

  it('expands into one item per video, reads each, and shelves their books', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    deps.listCollection = vi.fn(async () => listing(ids(3)));
    const job = await runCollection(store, deps);

    expect(deps.listCollection).toHaveBeenCalledWith('7301234567890123456', 25, expect.anything());
    const [parent, ...children] = job.items;
    expect(parent).toMatchObject({ kind: 'collection', status: 'done', note: null, parentItemId: null });
    expect(children).toHaveLength(3);
    expect(children.every((child) => child.parentItemId === parent!.id && child.status === 'done')).toBe(true);
    expect(fetchPost).toHaveBeenCalledTimes(3);
    expect(job.status).toBe('done');
    // The listing is billed to the budget too.
    expect(await store.spendSince(new Date(0))).toBeCloseTo(0.2 + 3 * 0.085);
  });

  it('reads the first 25 of a bigger collection and says so', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.listCollection = vi.fn(async () => listing(ids(25), true));
    const job = await runCollection(store, deps);
    expect(job.items).toHaveLength(26);
    expect(job.items[0]!.note).toMatch(/more than 25 videos.*first 25.*paid option/);
  });

  it('reads only what is left of today’s cap, and refuses when nothing is left', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.settings = { ...deps.settings, dailyCapPerUser: 4 };
    await store.createJob(USER, null, [{ inputUrl: URL_A, platform: 'tiktok', postId: '7672440936101727519', kind: 'video' }]);
    deps.listCollection = vi.fn(async (_id: string, limit: number) => listing(ids(limit), true));
    const job = await runCollection(store, deps);
    // 4 a day, 1 already used; the collection link itself doesn't count.
    expect(deps.listCollection).toHaveBeenCalledWith(expect.any(String), 3, expect.anything());
    expect(job.items[0]!.note).toMatch(/today’s limit/);

    const full = await runCollection(store, deps);
    expect(full.items[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/today’s limit/) });
  });

  it('reads only a guest’s smaller cap for a guest’s collection', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.settings = { ...deps.settings, dailyCapPerUser: 40, dailyCapGuest: 5 };
    deps.isGuest = vi.fn(async () => true);
    deps.listCollection = vi.fn(async (_id: string, limit: number) => listing(ids(limit), true));
    await runCollection(store, deps);
    expect(deps.isGuest).toHaveBeenCalledWith(USER);
    expect(deps.listCollection).toHaveBeenCalledWith(expect.any(String), 5, expect.anything());
  });

  it('respects the per-IP cap as well', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.settings = { ...deps.settings, dailyCapPerIp: 2 };
    deps.listCollection = vi.fn(async (_id: string, limit: number) => listing(ids(limit)));
    await runCollection(store, deps, COLLECTION, 'ip-hash');
    expect(deps.listCollection).toHaveBeenCalledWith(expect.any(String), 2, expect.anything());
  });

  it('never lists twice: a resumed collection carries on with the videos it already has', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.listCollection = vi.fn(async () => listing(ids(2)));
    const job = await store.createJob(USER, null, [{ inputUrl: COLLECTION, platform: 'tiktok', postId: null, kind: 'collection' }]);
    const parent = job.items[0]!;
    await store.addChildItems(parent, ids(2).map((postId) => ({ inputUrl: `https://www.tiktok.com/@r/video/${postId}`, platform: 'tiktok', postId, kind: 'video' })));
    const queued: string[] = [];
    deps.enqueue = (id) => queued.push(id);
    await processItem(parent.id, deps);
    expect(deps.listCollection).not.toHaveBeenCalled();
    expect(queued).toHaveLength(2);
  });

  it('does not pay for a listing when the book reader isn’t configured', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {});
    deps.settings = { ...deps.settings, anthropic: undefined };
    deps.listCollection = vi.fn(async () => listing(ids(3)));
    const job = await runCollection(store, deps);
    expect(deps.listCollection).not.toHaveBeenCalled();
    expect(job.items[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/paused/) });
  });

  it('retries saving the videos instead of paying to list again', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.listCollection = vi.fn(async () => listing(ids(2)));
    const real = store.addChildItems.bind(store);
    let calls = 0;
    store.addChildItems = vi.fn(async (...args: Parameters<typeof real>) => {
      if (calls++ === 0) throw new Error('job_items.insert_children failed: connection reset');
      return real(...args);
    });
    const job = await runCollection(store, deps);
    expect(deps.listCollection).toHaveBeenCalledTimes(1);
    expect(job.items).toHaveLength(3);
  });

  it('counts the caps again as the videos are saved, so room used meanwhile is not spent twice', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [] });
    deps.settings = { ...deps.settings, dailyCapPerUser: 4 };
    deps.listCollection = vi.fn(async (_id: string, limit: number) => {
      // While the listing runs, another paste from the same reader uses 3 of the 4.
      await store.createJob(USER, null, ids(3, 100).map((postId) => ({ inputUrl: `https://www.tiktok.com/@r/video/${postId}`, platform: 'tiktok' as const, postId, kind: 'video' as const })));
      // The whole collection fits the listing (no "more"), yet only 1 can be saved.
      return listing(ids(limit), false);
    });
    const job = await runCollection(store, deps);
    expect(deps.listCollection).toHaveBeenCalledWith(expect.any(String), 4, expect.anything());
    expect(job.items.filter((item) => item.parentItemId)).toHaveLength(1);
    expect(job.items[0]!.note).toMatch(/Reading 1 videos: that’s all today’s limit allows/);
    expect(await store.countItemsSince({ userId: USER }, new Date(0))).toBe(4);
  });

  it('adds a collection’s videos only once, even when saving is retried after it went through', async () => {
    const store = createMemoryLibraryStore();
    const job = await store.createJob(USER, null, [{ inputUrl: COLLECTION, platform: 'tiktok', postId: null, kind: 'collection' }]);
    const videos = ids(2).map((postId) => ({ inputUrl: `https://www.tiktok.com/@r/video/${postId}`, platform: 'tiktok' as const, postId, kind: 'video' as const }));
    const first = await store.addChildItems(job.items[0]!, videos);
    const again = await store.addChildItems(job.items[0]!, videos);
    expect(again.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(await store.childItems(job.items[0]!.id)).toHaveLength(2);
  });

  it('records the listing cost when a collection turns out empty or private', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {});
    deps.listCollection = vi.fn(async () => {
      throw new PipelineError('private_collection', 'BookTrap couldn’t see any videos in this collection.', false, { costUsd: 0.09 });
    });
    const job = await runCollection(store, deps);
    expect(job.items[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/couldn’t see any videos/) });
    expect(await store.spendSince(new Date(0))).toBeCloseTo(0.09);
  });
});

describe('processItem review fixes', () => {
  it('expands a short link that resolves to a collection instead of reading it as a post', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, {});
    deps.listCollection = vi.fn(async () => ({ videos: [], more: false, costUsd: 0 }));
    deps.resolveLink = vi.fn(async () => ({
      platform: 'tiktok' as const,
      url: 'https://www.tiktok.com/@u/collection/books-7301234567890123456',
      kind: 'collection' as const,
      postId: null,
      handle: 'u',
    }));
    const job = await store.createJob(USER, null, [{ inputUrl: 'https://vm.tiktok.com/ZMabc123/', platform: 'tiktok', postId: null, kind: null }]);
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect(deps.listCollection).toHaveBeenCalledWith('7301234567890123456', 25, expect.anything());
    expect((await store.getJob(USER, job.id))!.items[0]).toMatchObject({ kind: 'collection', status: 'done' });
  });

  it('records money spent by a failed extraction against the budget', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {});
    deps.extractBooks = vi.fn(async () => {
      throw new PipelineError('extraction_failed', 'BookTrap couldn’t finish reading this post.', true, { costUsd: 0.07 });
    }) as never;
    await runJob(store, deps, [URL_A]);
    // Apify (0.005) succeeded and the failed Claude call (0.07) still cost money.
    expect(await store.spendSince(new Date(0))).toBeCloseTo(0.075);
  });

  it('stops after the attempt limit so a crash loop cannot keep paying', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', null)] });
    const job = await store.createJob(USER, null, [{ inputUrl: URL_A, platform: 'tiktok', postId: '7672440936101727519', kind: 'video' }]);
    await store.updateItem(job.items[0]!.id, { attempts: 3 });
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await store.getJob(USER, job.id))!.items[0]!.error).toMatch(/tried this link 3 times/);
  });
});

describe('processItem with Instagram', () => {
  const IG_CAROUSEL = 'https://www.instagram.com/p/DeJvdqUjLd1/';
  const IG_REEL = 'https://www.instagram.com/reel/DeMTMjJjmqF/';

  it('reads an Instagram post through the same pipeline and records the platform', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    const job = await runJob(store, deps, [IG_CAROUSEL]);
    expect(fetchPost).toHaveBeenCalledWith('instagram', IG_CAROUSEL, 'DeJvdqUjLd1', expect.anything());
    expect(job.items[0]).toMatchObject({ status: 'done', platform: 'instagram', postId: 'DeJvdqUjLd1', kind: 'carousel' });
    const [shelved] = await store.listBooks(USER);
    expect(shelved!.sources[0]).toMatchObject({ platform: 'instagram', postId: 'DeJvdqUjLd1', url: IG_CAROUSEL });
  });

  it('mixes TikTok and Instagram in one job and merges the same book found on both', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('The Song of Achilles', 'Madeline Miller')] });
    const job = await runJob(store, deps, [URL_A, IG_REEL]);
    expect(job.items.map((item) => [item.platform, item.status])).toEqual([
      ['tiktok', 'done'],
      ['instagram', 'done'],
    ]);
    const books = await store.listBooks(USER);
    expect(books).toHaveLength(1);
    expect(books[0]!.sources.map((s) => s.platform)).toEqual(['tiktok', 'instagram']);
  });

  it('caches by platform and post id, so the same id on two platforms is two posts', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', null)] });
    await store.putCachedPost('tiktok', 'DeJvdqUjLd1', {
      post: { platform: 'tiktok', postId: 'DeJvdqUjLd1', url: 'u', kind: 'video', creatorHandle: null, thumbnailUrl: null },
      books: [],
      model: 'm',
      content: 'books',
    });
    await runJob(store, deps, [IG_CAROUSEL]);
    expect(fetchPost).toHaveBeenCalledTimes(1);
    await runJob(store, deps, [IG_CAROUSEL]);
    expect(fetchPost).toHaveBeenCalledTimes(1);
  });

  it('reuses a post cached before platforms existed (no platform in its JSON) without failing', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, {});
    const legacy = { postId: '7672440936101727519', url: URL_A, kind: 'video', caption: '', creatorHandle: 'reader', thumbnailUrl: null };
    await store.putCachedPost('tiktok', '7672440936101727519', { post: legacy as never, books: [book('Babel', 'R. F. Kuang')], model: 'm', content: 'books' });
    const job = await runJob(store, deps, [URL_A]);
    expect(fetchPost).not.toHaveBeenCalled();
    expect(job.items[0]).toMatchObject({ status: 'done', booksFound: 1 });
    const [shelved] = await store.listBooks(USER);
    expect(shelved!.sources[0]).toMatchObject({ platform: 'tiktok', postId: '7672440936101727519' });
  });

  it('removes a new book for good when its source can’t be saved', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    store.addSource = vi.fn(async () => {
      throw new Error('book_sources.insert failed');
    });
    const job = await runJob(store, deps, [URL_A]);
    expect(job.items[0]!.status).toBe('failed');
    expect(await store.listBooks(USER)).toHaveLength(0);
    expect(await store.dedupCandidates(USER)).toHaveLength(0);
  });

  it('tells the model a carousel is a carousel even when only one slide downloaded', async () => {
    const store = createMemoryLibraryStore();
    const { deps, extractBooks } = makeDeps(store, { x: [book('Babel', null)] });
    deps.fetchPost = vi.fn(async (_platform, _url, postId: string) => ({
      post: post(postId, { kind: 'carousel', videoUrl: null, imageUrls: ['a', 'b', 'c'] }),
      costUsd: 0.005,
    }));
    deps.loadMedia = async () => ({ images: [{ label: 'Slide 1 of 3', mediaType: 'image/jpeg', base64: 'x' }], transcript: null });
    await runJob(store, deps, [URL_A]);
    expect(extractBooks.mock.calls[0]![0]).toMatchObject({ slideCount: 3 });
  });

  it('explains that saved Instagram collections are private, without spending anything', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, {});
    const job = await store.createJob(USER, null, [
      { inputUrl: 'https://www.instagram.com/reader/saved/books/17912345678901234/', platform: 'instagram', postId: null, kind: null },
    ]);
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await store.getJob(USER, job.id))!.items[0]!.error).toMatch(/saved collections private/);
  });
});

describe('JobQueue', () => {
  it('re-runs an item that was re-enqueued while it was still running (fast Retry)', async () => {
    let runs = 0;
    const queue: JobQueue = new JobQueue(async () => {
      runs++;
      if (runs === 1) queue.enqueue('item', 'user');
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    queue.enqueue('item', 'user');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await queue.idle();
    expect(runs).toBe(2);
  });

  it('drops a deleted account’s waiting items, leaving other users’ alone', async () => {
    const ran: string[] = [];
    let release!: () => void;
    const queue = new JobQueue(async (id) => {
      ran.push(id);
      if (id === 'a1') await new Promise<void>((resolve) => (release = resolve));
    }, 1);
    queue.enqueue('a1', 'user-a');
    queue.enqueue('a2', 'user-a');
    queue.enqueue('b1', 'user-b');
    queue.forgetUser('user-a');
    release();
    await queue.idle();
    expect(ran).toEqual(['a1', 'b1']);
  });

  it('hands a guest’s waiting items to the account, and waits for the one running', async () => {
    const owners: string[] = [];
    let release!: () => void;
    const queue = new JobQueue(async (id) => {
      owners.push(id);
      if (id === 'g1') await new Promise<void>((resolve) => (release = resolve));
    }, 2);
    queue.enqueue('g1', 'guest');
    queue.enqueue('g2', 'guest');
    expect(await queue.handOver('guest', 'account', 50)).toBe(false);
    const done = queue.handOver('guest', 'account', 5000);
    release();
    expect(await done).toBe(true);
    await queue.idle();
    // g2 ran after g1 finished, as the account's.
    expect(owners).toEqual(['g1', 'g2']);
  });

  it('runs different users in parallel but one item at a time per user', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const queue = new JobQueue(async (id) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`start ${id}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end ${id}`);
      active--;
    }, 2);
    queue.enqueue('a1', 'user-a');
    queue.enqueue('a2', 'user-a');
    queue.enqueue('b1', 'user-b');
    await queue.idle();

    expect(maxActive).toBe(2);
    expect(order.indexOf('end a1')).toBeLessThan(order.indexOf('start a2'));
  });
  it('lets readers take turns, so a long paste doesn’t hold a slot while others wait', async () => {
    const started: string[] = [];
    const queue = new JobQueue(async (id) => {
      started.push(id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }, 1);
    for (let i = 1; i <= 4; i++) queue.enqueue(`a${i}`, 'user-a');
    queue.enqueue('b1', 'user-b');
    queue.enqueue('c1', 'user-c');
    await queue.idle();
    // Before: a1 a2 a3 a4 b1 c1. Now b and c each get a turn after a's first.
    expect(started).toEqual(['a1', 'b1', 'c1', 'a2', 'a3', 'a4']);
  });

  it('estimates each waiting item’s place and wait', async () => {
    const releases: (() => void)[] = [];
    const queue = new JobQueue(async () => new Promise<void>((resolve) => releases.push(resolve)), 2);
    queue.enqueue('a1', 'user-a');
    queue.enqueue('b1', 'user-b');
    queue.enqueue('a2', 'user-a');
    queue.enqueue('c1', 'user-c');
    queue.enqueue('c2', 'user-c');
    const estimates = queue.estimates();
    // Running: a1, b1. Waiting, in turn order: c1 (never started), a2, c2.
    expect(estimates.has('a1')).toBe(false);
    expect([...estimates].map(([id, e]) => [id, e.ahead])).toEqual([['c1', 2], ['a2', 3], ['c2', 4]]);
    // Waves of 2 at the default 40s, minus half the running wave.
    expect(estimates.get('c1')!.etaSeconds).toBe(20);
    expect(estimates.get('c2')!.etaSeconds).toBe(60);
    while (releases.length) releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    while (releases.length) releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    while (releases.length) releases.shift()!();
    await queue.idle();
  });
});

describe('moderation and limits in the pipeline', () => {
  const extractAs = (content: string, books: ExtractedBook[] = []) =>
    vi.fn(async () => ({ books, content, model: 'm', costUsd: 0.06, usage: { inputTokens: 1, outputTokens: 1 } })) as never;

  it('skips an explicit post: nothing added, cached as skipped, so a re-paste is free', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, {}, { extractBooks: extractAs('explicit_non_book', [book('Babel', 'R. F. Kuang')]) });
    const job = await runJob(store, deps, [URL_A]);
    expect(job.items[0]).toMatchObject({ status: 'done', booksFound: 0, blocked: 'explicit', error: null });
    expect(await store.listBooks(USER)).toEqual([]);
    // The verdict is cached with the books it found, so an unblock can shelve them without paying.
    expect(await store.getCachedPost('tiktok', '7672440936101727519')).toMatchObject({ content: 'explicit_non_book', books: [{ title: 'Babel' }] });

    const again = await runJob(store, deps, [URL_A]);
    expect(fetchPost).toHaveBeenCalledTimes(1);
    expect(again.items[0]).toMatchObject({ blocked: 'explicit' });
  });

  it('skips graphic posts and posts Claude declined, and records what they cost', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {}, { extractBooks: extractAs('graphic_violence') });
    expect((await runJob(store, deps, [URL_A])).items[0]).toMatchObject({ blocked: 'graphic' });
    deps.extractBooks = extractAs('refused');
    expect((await runJob(store, deps, [URL_B])).items[0]).toMatchObject({ status: 'done', blocked: 'refused', booksFound: 0 });
    expect(await store.spendSince(new Date(0))).toBeCloseTo(0.13);
  });

  it('treats ordinary posts with no books as "no books found", not skipped', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {}, { extractBooks: extractAs('not_books') });
    expect((await runJob(store, deps, [URL_A])).items[0]).toMatchObject({ status: 'done', booksFound: 0, blocked: null });
  });

  it('never reads a taken-down post, and it stops counting against the daily cap', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', null)] });
    await store.takeDownPost({ platform: 'tiktok', postId: '7672440936101727519', url: URL_A, creatorHandle: 'reader' }, 'request');
    const job = await runJob(store, deps, [URL_A]);
    expect(job.items[0]).toMatchObject({ status: 'done', blocked: 'removed', booksFound: 0 });
    expect(fetchPost).not.toHaveBeenCalled();
    expect(await store.countItemsSince({ userId: USER }, new Date(0))).toBe(0);
  });

  it('shelves an unblocked post from the cache without paying again', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, {}, { extractBooks: extractAs('explicit_non_book', [book('Babel', 'R. F. Kuang')]) });
    await runJob(store, deps, [URL_A]);
    expect(await store.unblockPost('tiktok', '7672440936101727519')).toBe(true);
    const job = await runJob(store, deps, [URL_A]);
    expect(job.items[0]).toMatchObject({ blocked: null, booksFound: 1 });
    expect((await store.listBooks(USER)).map((b) => b.title)).toEqual(['Babel']);
    expect(fetchPost).toHaveBeenCalledTimes(1);
    expect(await store.unblockPost('tiktok', 'never-seen')).toBe(false);
  });

  it('stops adding books at a guest’s limit, still merges repeats, and says so', async () => {
    const store = createMemoryLibraryStore();
    for (let i = 0; i < 499; i++) {
      await store.insertBook(USER, { title: `Filler ${i}`, author: null, isbn10: null, isbn13: null, coverUrl: null, publishedYear: null, verified: false, normalizedKey: `filler ${i}` });
    }
    const isGuest = vi.fn(async () => true);
    const { deps } = makeDeps(store, { x: [book('Filler 3', null), book('Babel', null), book('Circe', null), book('Piranesi', null)] }, { isGuest });
    const job = await runJob(store, deps, [URL_A]);
    expect(await store.countBooks(USER)).toBe(500);
    expect(job.items[0]!.note).toBe('Your shelf is full (500 books), so 2 books from this post weren’t added. Save your shelf to keep up to 5,000.');
    // The repeat sighting still became a source of the book already there.
    const filler = (await store.listBooks(USER)).find((b) => b.title === 'Filler 3')!;
    expect(filler.sources).toHaveLength(1);
    expect(isGuest).toHaveBeenCalledWith(USER);
  });

  it('cuts long captions and hashtag lists before they reach Claude', async () => {
    const { extractBooks: realExtract } = await import('./extract');
    const parse = vi.fn(async () => ({ stop_reason: 'end_turn', model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: { content: 'books', books: [] } }));
    await realExtract(
      { platform: 'tiktok', kind: 'video', caption: 'x'.repeat(9000), hashtags: Array.from({ length: 50 }, (_, i) => `tag${i}`), transcript: null, images: [] },
      { client: { beta: { messages: { parse } } } as never, model: 'm', effort: 'medium' },
    );
    const text = (parse.mock.calls[0] as unknown as [{ messages: { content: { text?: string }[] }[] }])[0].messages[0]!.content[0]!.text!;
    expect(text).toContain(`Caption: ${'x'.repeat(5000)}\n`);
    expect(text).toContain('#tag29');
    expect(text).not.toContain('#tag30');
  });

  it('holds a takedown that lands while the post is being read', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {});
    deps.extractBooks = vi.fn(async () => {
      // The operator takes the post down mid-read.
      await store.takeDownPost({ platform: 'tiktok', postId: '7672440936101727519', url: URL_A, creatorHandle: 'reader' }, 'request');
      return { books: [book('Babel', 'R. F. Kuang')], content: 'books', model: 'm', costUsd: 0.06, usage: { inputTokens: 1, outputTokens: 1 } };
    }) as never;
    const job = await runJob(store, deps, [URL_A]);
    expect(job.items[0]).toMatchObject({ status: 'done', blocked: 'removed', booksFound: 0 });
    expect(await store.listBooks(USER)).toEqual([]);
    expect(await store.getCachedPost('tiktok', '7672440936101727519')).toBeNull();
    expect((await store.listRemovedPosts(5))[0]).toMatchObject({ reason: 'request' });
  });
});
