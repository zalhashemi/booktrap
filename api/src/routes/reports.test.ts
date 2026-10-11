import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@booktrap/shared';
import { testSessions } from '../auth/test-sessions';
import { loadConfig } from '../config';
import { JobQueue } from '../pipeline/queue';
import { buildApp } from '../server';
import { createMemoryLibraryStore } from '../store/memory';
import type { LibraryStore } from '../store/types';
import { createMemoryUserDirectory } from '../users/memory';

type App = Awaited<ReturnType<typeof buildApp>>;
const ADMIN_TOKEN = 'a'.repeat(40);
const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };

describe('reports, admin and limits', () => {
  let app: App;
  let store: LibraryStore;
  let sessions: Awaited<ReturnType<typeof testSessions>> | undefined;
  let headers: Record<string, string>;
  let userId: string;

  const insert = (owner: string, title: string) =>
    store.insertBook(owner, { title, author: null, isbn10: null, isbn13: null, coverUrl: null, publishedYear: null, verified: false, normalizedKey: title.toLowerCase() });
  async function shelve(owner: string, title: string, postId: string) {
    const id = await insert(owner, title);
    await store.addSource(id, { platform: 'tiktok', postId, url: `https://www.tiktok.com/@maker/video/${postId}`, creatorHandle: 'maker', thumbnailUrl: null, evidence: 'cover', confidence: 0.9 });
    return id;
  }
  const report = (payload: object, as = headers) => app.inject({ method: 'POST', url: '/v1/reports', headers: as, payload });

  async function build(env: Record<string, string> = {}) {
    sessions ??= await testSessions();
    store = createMemoryLibraryStore();
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', ...env }),
      verifySession: sessions.verify,
      users: createMemoryUserDirectory(),
      store,
      queue: new JobQueue(async () => {}),
    });
    ({ userId, headers } = await sessions.signIn());
  }
  beforeEach(() => build({ ADMIN_TOKEN, APIFY_TOKEN: 'x', ANTHROPIC_API_KEY: 'y' }));
  afterEach(() => app.close());

  it('reports a post on the reader’s own shelf, once', async () => {
    await shelve(userId, 'Babel', '111');
    expect((await report({ platform: 'tiktok', postId: '111', reason: 'explicit' })).statusCode).toBe(201);
    const again = await report({ platform: 'tiktok', postId: '111', reason: 'graphic' });
    expect(again.statusCode).toBe(200);
    expect(await store.listReports('open', 10)).toEqual([
      expect.objectContaining({ platform: 'tiktok', postId: '111', reason: 'explicit', url: 'https://www.tiktok.com/@maker/video/111', creatorHandle: 'maker', note: null }),
    ]);
  });

  it('refuses posts that aren’t on the reader’s shelf, and Other without a note', async () => {
    const other = await sessions!.signIn();
    await shelve(other.userId, 'Babel', '222');
    const notMine = await report({ platform: 'tiktok', postId: '222', reason: 'explicit' });
    expect(notMine.statusCode).toBe(404);
    await shelve(userId, 'Circe', '333');
    const bare = await report({ platform: 'tiktok', postId: '333', reason: 'other', note: '   ' });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error.message).toBe('Tell us what’s wrong with it.');
    expect((await report({ platform: 'tiktok', postId: '333', reason: 'other', note: 'Spam account' })).statusCode).toBe(201);
    expect((await report({ platform: 'tiktok', postId: '333', reason: 'mine', note: 'x'.repeat(LIMITS.reportNoteChars + 1) })).statusCode).toBe(400);
  });

  it('lets a reader send up to the daily number of reports', async () => {
    for (let i = 0; i < LIMITS.reportsPerDay; i++) {
      await shelve(userId, `Book ${i}`, `p${i}`);
      await store.createReport(userId, { platform: 'tiktok', postId: `p${i}`, url: 'u', creatorHandle: null, reason: 'explicit', note: null });
    }
    await shelve(userId, 'One more', 'last');
    const res = await report({ platform: 'tiktok', postId: 'last', reason: 'explicit' });
    expect(res.statusCode).toBe(429);
  });

  it('keeps the admin API behind the admin key, and absent without one', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/posts' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/posts', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    // A reader's session is not the admin key.
    expect((await app.inject({ method: 'GET', url: '/admin/posts', headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/posts', headers: admin })).statusCode).toBe(200);
    await app.close();
    await build();
    expect((await app.inject({ method: 'GET', url: '/admin/posts', headers: admin })).statusCode).toBe(404);
    expect(() => loadConfig({ NODE_ENV: 'test', ADMIN_TOKEN: 'short' })).toThrow(/at least 32/);
  });

  it('lists reports by post with their reach, and takes a post down keeping edited books', async () => {
    const other = await sessions!.signIn();
    const untouched = await shelve(userId, 'Babel', '444');
    const edited = await shelve(other.userId, 'Circe', '444');
    await store.updateBook(other.userId, edited, { status: 'read' });
    await report({ platform: 'tiktok', postId: '444', reason: 'explicit' });
    await report({ platform: 'tiktok', postId: '444', reason: 'other', note: 'Spam' }, other.headers);

    const list = await app.inject({ method: 'GET', url: '/admin/posts?tab=open', headers: admin });
    expect(list.json()).toMatchObject({
      counts: { open: 2, blocked: 0, removed: 0, dismissed: 0 },
      posts: [{ platform: 'tiktok', postId: '444', creatorHandle: 'maker', reach: { shelves: 2, onlyHere: 2, edited: 1 } }],
    });
    expect(list.json().posts[0].reports).toHaveLength(2);

    const down = await app.inject({ method: 'POST', url: '/admin/takedown', headers: admin, payload: { platform: 'tiktok', postId: '444' } });
    expect(down.json()).toEqual({ platform: 'tiktok', postId: '444', sourcesRemoved: 2, booksDeleted: 1, booksKept: 1 });
    expect(await store.getBook(userId, untouched)).toBeNull();
    expect(await store.getBook(other.userId, edited)).toMatchObject({ title: 'Circe', sources: [] });
    expect((await store.listRemovedPosts(5))[0]).toMatchObject({ reason: 'report', url: 'https://www.tiktok.com/@maker/video/444' });

    const after = await app.inject({ method: 'GET', url: '/admin/posts?tab=removed', headers: admin });
    expect(after.json()).toMatchObject({ counts: { open: 0, removed: 1 }, posts: [{ postId: '444', blocked: 'removed' }] });
  });

  it('takes a post down by its link, dismisses reports and unblocks', async () => {
    const byLink = await app.inject({ method: 'POST', url: '/admin/takedown', headers: admin, payload: { url: 'https://www.tiktok.com/@maker/video/7672440936101727555?is_from_webapp=1' } });
    expect(byLink.json()).toMatchObject({ postId: '7672440936101727555', sourcesRemoved: 0 });
    expect((await store.listRemovedPosts(5))[0]).toMatchObject({ reason: 'request', creatorHandle: 'maker' });
    const bad = await app.inject({ method: 'POST', url: '/admin/takedown', headers: admin, payload: { url: 'https://example.com/x' } });
    expect(bad.statusCode).toBe(400);

    await shelve(userId, 'Babel', '666');
    await report({ platform: 'tiktok', postId: '666', reason: 'hateful' });
    const dismissed = await app.inject({ method: 'POST', url: '/admin/dismiss', headers: admin, payload: { platform: 'tiktok', postId: '666' } });
    expect(dismissed.json()).toEqual({ dismissed: 1 });
    expect((await store.getBook(userId, (await store.listBooks(userId))[0]!.id))?.sources).toHaveLength(1);

    const unblock = await app.inject({ method: 'POST', url: '/admin/unblock', headers: admin, payload: { platform: 'tiktok', postId: '7672440936101727555' } });
    expect(unblock.json()).toEqual({ unblocked: true });
    expect(await store.isPostRemoved('tiktok', '7672440936101727555')).toBe(false);
  });

  it('refuses more links than a paste allows, with the limit in words', async () => {
    const urls = Array.from({ length: LIMITS.linksPerPaste + 1 }, (_, i) => `https://www.tiktok.com/@a/video/${7000000000000000000 + i}`);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(`You can add up to ${LIMITS.linksPerPaste} links at a time.`);
  });

  it('refuses a paste when the shelf is full, before anything is paid for', async () => {
    const guest = await sessions!.signIn({ guest: true });
    for (let i = 0; i < LIMITS.booksPerGuest; i++) await insert(guest.userId, `Filler ${i}`);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers: guest.headers, payload: { urls: ['https://www.tiktok.com/@a/video/7000000000000000001'] } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe('Your shelf is full (500 books). Save your shelf to keep up to 5,000.');
  });

  it('caps shelves per reader, but an existing name still answers', async () => {
    for (let i = 0; i < LIMITS.shelvesPerUser; i++) await store.createTag(userId, `Shelf ${i}`);
    const extra = await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'One too many' } });
    expect(extra.statusCode).toBe(409);
    const same = await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'shelf 7' } });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ name: 'Shelf 7' });
  });

  it('refuses request bodies over the limit', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify({ urls: ['x'.repeat(LIMITS.requestBodyBytes)] }) });
    expect(res.statusCode).toBe(413);
  });

  it('keeps a report open after the reader deletes the book it came from', async () => {
    const id = await shelve(userId, 'Babel', '777');
    await report({ platform: 'tiktok', postId: '777', reason: 'graphic' });
    await store.deleteBooks(userId, [id]);
    expect(await store.countReports('open')).toBe(1);
  });
});
