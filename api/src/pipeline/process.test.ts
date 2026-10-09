import { describe, expect, it, vi } from 'vitest';
import { createMemoryLibraryStore } from '../store/memory';
import type { LibraryStore } from '../store/types';
import type { PostData } from './fetchers';
import { PipelineError } from './errors';
import type { ExtractedBook } from './extract';
import { processItem, type PipelineDeps } from './process';
import { JobQueue } from './queue';
import type { Verification } from './verify';

const DEVICE = '11111111-1111-4111-8111-111111111111';
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
    return { books: booksByPost[id]!, model: 'claude-opus-5-5', costUsd: 0.08, usage: { inputTokens: 1, outputTokens: 1 } };
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
      dailyCapPerDevice: 40,
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
    DEVICE,
    null,
    urls.map((url) => {
      const instagram = /instagram\.com\/(?:p|reel)\/([\w-]+)/.exec(url);
      return instagram
        ? { inputUrl: url, platform: 'instagram' as const, postId: instagram[1]!, kind: null }
        : { inputUrl: url, platform: 'tiktok' as const, postId: /(\d+)$/.exec(url)?.[1] ?? null, kind: 'video' as const };
    }),
  );
  for (const item of job.items) await processItem(item.id, deps);
  return (await store.getJob(DEVICE, job.id))!;
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
    const [shelved] = await store.listBooks(DEVICE);
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
    const books = await store.listBooks(DEVICE);
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

    const books = await store.listBooks(DEVICE);
    expect(books).toHaveLength(1);
    expect(books[0]!.sources.map((s) => s.postId)).toEqual(['7672440936101727519', '7674670540518395169']);
  });

  it('pays for a post only once: a second paste of the same post uses the cache', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost, extractBooks } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    await runJob(store, deps, [URL_A]);
    await runJob(store, deps, [URL_A]);
    expect(fetchPost).toHaveBeenCalledTimes(1);
    expect(extractBooks).toHaveBeenCalledTimes(1);
    expect(await store.listBooks(DEVICE)).toHaveLength(1);
  });

  it('leaves background-only books off the shelf unless enabled', async () => {
    const store = createMemoryLibraryStore();
    const books = [book('In Memoriam', 'Alice Winn'), book('Wild Dark Shore', 'Charlotte McConaghy', { prominence: 'background', evidence: 'spine' })];
    const { deps } = makeDeps(store, { x: books });
    await runJob(store, deps, [URL_A]);
    expect((await store.listBooks(DEVICE)).map((b) => b.title)).toEqual(['In Memoriam']);

    const all = createMemoryLibraryStore();
    const withBackground = makeDeps(all, { x: books }).deps;
    withBackground.settings = { ...withBackground.settings, includeBackgroundBooks: true };
    await runJob(all, withBackground, [URL_A]);
    expect(await all.listBooks(DEVICE)).toHaveLength(2);
  });

  it('clears the previous batch’s "new" highlight when a later import adds books', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Babel', 'R. F. Kuang')] });
    await runJob(store, deps, [URL_A]);
    deps.extractBooks = vi.fn(async () => ({ books: [book('Piranesi', 'Susanna Clarke')], model: 'm', costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 } })) as never;
    await runJob(store, deps, [URL_B]);
    const books = await store.listBooks(DEVICE);
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
    await store.recordSpend({ deviceId: null, jobItemId: null, provider: 'anthropic', usd: 25 });
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
    const job = await store.createJob(DEVICE, ipHash, [{ inputUrl: url, platform: 'tiktok', postId: null, kind: 'collection' }]);
    await processItem(job.items[0]!.id, deps);
    for (const id of queued.splice(0)) await processItem(id, deps);
    return (await store.getJob(DEVICE, job.id))!;
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
    deps.settings = { ...deps.settings, dailyCapPerDevice: 4 };
    await store.createJob(DEVICE, null, [{ inputUrl: URL_A, platform: 'tiktok', postId: '7672440936101727519', kind: 'video' }]);
    deps.listCollection = vi.fn(async (_id: string, limit: number) => listing(ids(limit), true));
    const job = await runCollection(store, deps);
    // 4 a day, 1 already used; the collection link itself doesn't count.
    expect(deps.listCollection).toHaveBeenCalledWith(expect.any(String), 3, expect.anything());
    expect(job.items[0]!.note).toMatch(/today’s limit/);

    const full = await runCollection(store, deps);
    expect(full.items[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/today’s limit/) });
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
    const job = await store.createJob(DEVICE, null, [{ inputUrl: COLLECTION, platform: 'tiktok', postId: null, kind: 'collection' }]);
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
    const job = await store.createJob(DEVICE, null, [{ inputUrl: 'https://vm.tiktok.com/ZMabc123/', platform: 'tiktok', postId: null, kind: null }]);
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect(deps.listCollection).toHaveBeenCalledWith('7301234567890123456', 25, expect.anything());
    expect((await store.getJob(DEVICE, job.id))!.items[0]).toMatchObject({ kind: 'collection', status: 'done' });
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
    const job = await store.createJob(DEVICE, null, [{ inputUrl: URL_A, platform: 'tiktok', postId: '7672440936101727519', kind: 'video' }]);
    await store.updateItem(job.items[0]!.id, { attempts: 3 });
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await store.getJob(DEVICE, job.id))!.items[0]!.error).toMatch(/tried this link 3 times/);
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
    const [shelved] = await store.listBooks(DEVICE);
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
    const books = await store.listBooks(DEVICE);
    expect(books).toHaveLength(1);
    expect(books[0]!.sources.map((s) => s.platform)).toEqual(['tiktok', 'instagram']);
  });

  it('caches by platform and post id, so the same id on two platforms is two posts', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, { x: [book('Babel', null)] });
    await store.putCachedPost('tiktok', 'DeJvdqUjLd1', {
      post: { platform: 'tiktok', postId: 'DeJvdqUjLd1', url: 'u', kind: 'video', caption: '', creatorHandle: null, thumbnailUrl: null },
      books: [],
      model: 'm',
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
    await store.putCachedPost('tiktok', '7672440936101727519', { post: legacy as never, books: [book('Babel', 'R. F. Kuang')], model: 'm' });
    const job = await runJob(store, deps, [URL_A]);
    expect(fetchPost).not.toHaveBeenCalled();
    expect(job.items[0]).toMatchObject({ status: 'done', booksFound: 1 });
    const [shelved] = await store.listBooks(DEVICE);
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
    expect(await store.listBooks(DEVICE)).toHaveLength(0);
    expect(await store.dedupCandidates(DEVICE)).toHaveLength(0);
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
    const job = await store.createJob(DEVICE, null, [
      { inputUrl: 'https://www.instagram.com/reader/saved/books/17912345678901234/', platform: 'instagram', postId: null, kind: null },
    ]);
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await store.getJob(DEVICE, job.id))!.items[0]!.error).toMatch(/saved collections private/);
  });
});

describe('JobQueue', () => {
  it('re-runs an item that was re-enqueued while it was still running (fast Retry)', async () => {
    let runs = 0;
    const queue: JobQueue = new JobQueue(async () => {
      runs++;
      if (runs === 1) queue.enqueue('item', 'device');
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    queue.enqueue('item', 'device');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await queue.idle();
    expect(runs).toBe(2);
  });

  it('runs different devices in parallel but one item at a time per device', async () => {
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
    queue.enqueue('a1', 'device-a');
    queue.enqueue('a2', 'device-a');
    queue.enqueue('b1', 'device-b');
    await queue.idle();

    expect(maxActive).toBe(2);
    expect(order.indexOf('end a1')).toBeLessThan(order.indexOf('start a2'));
  });
});
