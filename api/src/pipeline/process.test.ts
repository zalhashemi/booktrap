import { describe, expect, it, vi } from 'vitest';
import { createMemoryLibraryStore } from '../store/memory';
import type { LibraryStore } from '../store/types';
import type { PostData } from './apify';
import { PipelineError } from './errors';
import type { ExtractedBook } from './extract';
import { processItem, type PipelineDeps } from './process';
import { JobQueue } from './queue';
import type { Verification } from './verify';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const quietLog = { info: () => {}, warn: () => {}, error: () => {} };

function post(id: string, overrides: Partial<PostData> = {}): PostData {
  return {
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
  const fetchPost = vi.fn(async (_url: string, postId: string) => ({ post: post(postId), costUsd: 0.005 }));
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
      unsureBelowConfidence: 0.6,
      monthlyBudgetUsd: 20,
      killSwitch: false,
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
    urls.map((url) => ({ inputUrl: url, postId: /(\d+)$/.exec(url)?.[1] ?? null, kind: 'video' })),
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
    expect(shelved).toMatchObject({ title: 'Giovanni’s Room', verified: true, unsure: false, isNew: true });
    expect(shelved!.sources[0]).toMatchObject({ postId: '7672440936101727519', creatorHandle: 'reader', evidence: 'caption' });
    expect(await store.spendSince(new Date(0))).toBeCloseTo(0.085);
  });

  it('flags low-confidence and unverified books as unsure, but still adds them', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, { x: [book('Secret Hist', 'Donna T', { confidence: 0.4 }), book('Zine', null)] });
    deps.verifyBook = vi.fn(async (title: string, author: string | null) =>
      title === 'Zine' ? { ...verified(title, author), verified: false } : verified('The Secret History', 'Donna Tartt'),
    );
    await runJob(store, deps, [URL_A]);
    const books = await store.listBooks(DEVICE);
    expect(books.map((b) => [b.title, b.unsure])).toEqual(
      expect.arrayContaining([
        ['The Secret History', true],
        ['Zine', true],
      ]),
    );
  });

  it('never creates a second row for the same book; it adds the new TikTok as a source', async () => {
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

  it('explains that collections are not supported yet', async () => {
    const store = createMemoryLibraryStore();
    const { deps } = makeDeps(store, {});
    const job = await store.createJob(DEVICE, null, [
      { inputUrl: 'https://www.tiktok.com/@reader/collection/Dark%20academia-7301234567890123456', postId: null, kind: 'collection' },
    ]);
    await processItem(job.items[0]!.id, deps);
    expect((await store.getJob(DEVICE, job.id))!.items[0]!.error).toMatch(/Collections arrive/);
  });
});

describe('processItem review fixes', () => {
  it('refuses a short link that resolves to a collection before spending anything', async () => {
    const store = createMemoryLibraryStore();
    const { deps, fetchPost } = makeDeps(store, {});
    deps.resolveLink = vi.fn(async () => ({
      url: 'https://www.tiktok.com/@u/collection/books-7301234567890123456',
      kind: 'collection' as const,
      postId: null,
      handle: 'u',
    }));
    const job = await store.createJob(DEVICE, null, [{ inputUrl: 'https://vm.tiktok.com/ZMabc123/', postId: null, kind: null }]);
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await store.getJob(DEVICE, job.id))!.items[0]!.error).toMatch(/Collections arrive/);
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
    const job = await store.createJob(DEVICE, null, [{ inputUrl: URL_A, postId: '7672440936101727519', kind: 'video' }]);
    await store.updateItem(job.items[0]!.id, { attempts: 3 });
    await processItem(job.items[0]!.id, deps);
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await store.getJob(DEVICE, job.id))!.items[0]!.error).toMatch(/tried this link 3 times/);
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
