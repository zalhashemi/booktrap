import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { JobQueue } from '../pipeline/queue';
import type { Verification } from '../pipeline/verify';
import { createMemoryDeviceRepo } from '../repo/memory';
import { buildApp } from '../server';
import { createMemoryLibraryStore } from '../store/memory';
import type { LibraryStore } from '../store/types';

type App = Awaited<ReturnType<typeof buildApp>>;

const unverified = (title: string, author: string | null): Verification => ({
  verified: false,
  title,
  author,
  isbn10: null,
  isbn13: null,
  coverUrl: null,
  publishedYear: null,
  score: 0,
});

describe('library API', () => {
  let app: App;
  let store: LibraryStore;
  let verify: ReturnType<typeof vi.fn>;
  let headers: Record<string, string>;
  let deviceId: string;

  async function shelve(title: string, author: string | null, postId: string = randomUUID()) {
    const id = await store.insertBook(deviceId, {
      title,
      author,
      isbn10: null,
      isbn13: null,
      coverUrl: null,
      publishedYear: null,
      verified: false,
      unsure: true,
      normalizedKey: title.toLowerCase(),
    });
    await store.addSource(id, { postId, url: `https://www.tiktok.com/@r/video/${postId}`, creatorHandle: 'r', thumbnailUrl: null, evidence: 'cover', confidence: 0.5 });
    return id;
  }

  beforeEach(async () => {
    store = createMemoryLibraryStore();
    verify = vi.fn(async (title: string, author: string | null) => unverified(title, author));
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      devices: createMemoryDeviceRepo(),
      store,
      queue: new JobQueue(async () => {}),
      verifyBook: verify as never,
    });
    const creds = { deviceId: randomUUID(), deviceSecret: randomBytes(32).toString('base64url') };
    await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    headers = { 'x-device-id': creds.deviceId, 'x-device-secret': creds.deviceSecret };
    deviceId = creds.deviceId;
  });
  afterEach(() => app.close());

  it('edits status and notes, and confirming clears the unsure flag', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/books/${id}`,
      headers,
      payload: { status: 'reading', notes: '  borrowed from Sam  ', unsure: false, isNew: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'reading', notes: 'borrowed from Sam', unsure: false, isNew: false });
    expect(verify).not.toHaveBeenCalled();
  });

  it('re-verifies when the title or author changes, keeping the reader’s wording', async () => {
    const id = await shelve('The Secret Histroy', null);
    verify.mockResolvedValueOnce({
      verified: true,
      title: 'The Secret History',
      author: 'Donna Tartt',
      isbn10: null,
      isbn13: '9781400031702',
      coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      publishedYear: 1992,
      score: 2,
    });
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { title: 'The Secret History', author: 'Donna Tartt' } });
    expect(verify).toHaveBeenCalledWith('The Secret History', 'Donna Tartt', expect.anything());
    expect(res.json()).toMatchObject({ title: 'The Secret History', verified: true, unsure: false, isbn13: '9781400031702', publishedYear: 1992 });
  });

  it('marks an edited book unsure again when verification finds nothing', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    await store.updateBook(deviceId, id, { verified: true, unsure: false });
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { title: 'Babbel zine' } });
    expect(res.json()).toMatchObject({ verified: false, unsure: true });
  });

  it('drops the old book’s ISBN and cover when a rename can’t be verified', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    await store.updateBook(deviceId, id, {
      verified: true,
      unsure: false,
      isbn13: '9780063021426',
      coverUrl: 'https://covers.openlibrary.org/b/id/9-L.jpg',
      publishedYear: 2022,
    });
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { title: 'Babbel zine' } });
    expect(res.json()).toMatchObject({ title: 'Babbel zine', isbn13: null, coverUrl: null, publishedYear: null, unsure: true });
  });

  it('answers 404, never a server error, for ids that aren’t ids', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/v1/books/not-a-uuid', headers, payload: { status: 'read' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/v1/tags/xyz', headers })).statusCode).toBe(404);
    const del = await app.inject({ method: 'POST', url: '/v1/books/delete', headers, payload: { ids: ['nope', 'also-nope'] } });
    expect(del.json().count).toBe(0);
  });

  it('merges a restored book into a copy that was re-imported while it was deleted', async () => {
    const original = await shelve('Piranesi', 'Susanna Clarke', 'post-a');
    await app.inject({ method: 'POST', url: '/v1/books/delete', headers, payload: { ids: [original] } });
    await shelve('Piranesi', 'Susanna Clarke', 'post-b');
    await app.inject({ method: 'POST', url: '/v1/books/restore', headers, payload: { ids: [original] } });
    const books = (await app.inject({ method: 'GET', url: '/v1/books', headers })).json().books;
    expect(books).toHaveLength(1);
    expect(books[0].sources.map((s: { postId: string }) => s.postId).sort()).toEqual(['post-a', 'post-b']);
  });

  it('rejects invalid edits with a readable message', async () => {
    const id = await shelve('Babel', null);
    const empty = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { title: '   ' } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toBe('A book needs a title.');
    const isbn = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { isbn13: '123' } });
    expect(isbn.json().error.message).toMatch(/ISBN-13/);
  });

  it('cannot touch another device’s books', async () => {
    const otherDevice = randomUUID();
    const id = await store.insertBook(otherDevice, {
      title: 'Not yours',
      author: null,
      isbn10: null,
      isbn13: null,
      coverUrl: null,
      publishedYear: null,
      verified: false,
      unsure: false,
      normalizedKey: 'not yours',
    });
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { status: 'read' } });
    expect(res.statusCode).toBe(404);
    const del = await app.inject({ method: 'POST', url: '/v1/books/delete', headers, payload: { ids: [id] } });
    expect(del.json().count).toBe(0);
  });

  it('deletes books softly so they can be restored', async () => {
    const a = await shelve('Babel', null);
    const b = await shelve('Piranesi', null);
    const del = await app.inject({ method: 'POST', url: '/v1/books/delete', headers, payload: { ids: [a, b] } });
    expect(del.json().count).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/v1/books', headers })).json().books).toHaveLength(0);
    const restore = await app.inject({ method: 'POST', url: '/v1/books/restore', headers, payload: { ids: [a] } });
    expect(restore.json().count).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/v1/books', headers })).json().books.map((book: { id: string }) => book.id)).toEqual([a]);
  });

  it('marks everything seen', async () => {
    await shelve('Babel', null);
    await shelve('Piranesi', null);
    const res = await app.inject({ method: 'POST', url: '/v1/books/mark-seen', headers });
    expect(res.json().count).toBe(2);
    const books = (await app.inject({ method: 'GET', url: '/v1/books', headers })).json().books;
    expect(books.every((book: { isNew: boolean }) => !book.isNew)).toBe(true);
  });

  it('merges duplicates: sources and tags move to the kept book and the other row disappears', async () => {
    const keep = await shelve('The Song of Achilles', 'Madeline Miller', 'post-1');
    const dupe = await shelve('Song of Achilles (TikTok edit)', 'M. Miller', 'post-2');
    const tag = (await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'Greek myth' } })).json();
    await app.inject({ method: 'PATCH', url: `/v1/books/${dupe}`, headers, payload: { tagIds: [tag.id] } });

    const res = await app.inject({ method: 'POST', url: '/v1/books/merge', headers, payload: { keepId: keep, mergeIds: [dupe] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources.map((s: { postId: string }) => s.postId)).toEqual(['post-1', 'post-2']);
    expect(res.json().tags).toEqual([{ id: tag.id, name: 'Greek myth' }]);
    expect((await app.inject({ method: 'GET', url: '/v1/books', headers })).json().books).toHaveLength(1);
  });

  describe('tags', () => {
    it('creates tags, returning the existing one for a case-insensitive duplicate', async () => {
      const first = await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'Dark academia' } });
      const again = await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: ' dark ACADEMIA ' } });
      expect(again.json().id).toBe(first.json().id);
      expect((await app.inject({ method: 'GET', url: '/v1/tags', headers })).json().tags).toHaveLength(1);
    });

    it('refuses to rename a tag onto another tag’s name', async () => {
      await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'Classics' } });
      const other = (await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'Romance' } })).json();
      const res = await app.inject({ method: 'PATCH', url: `/v1/tags/${other.id}`, headers, payload: { name: 'classics' } });
      expect(res.statusCode).toBe(409);
    });

    it('deleting a tag removes it from books', async () => {
      const id = await shelve('Babel', null);
      const tag = (await app.inject({ method: 'POST', url: '/v1/tags', headers, payload: { name: 'Fantasy' } })).json();
      await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { tagIds: [tag.id] } });
      expect((await app.inject({ method: 'DELETE', url: `/v1/tags/${tag.id}`, headers })).statusCode).toBe(204);
      const [book] = (await app.inject({ method: 'GET', url: '/v1/books', headers })).json().books;
      expect(book.tags).toEqual([]);
    });

    it('ignores tag ids that belong to someone else', async () => {
      const id = await shelve('Babel', null);
      const foreign = await store.createTag(randomUUID(), 'Theirs');
      const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { tagIds: [foreign.id] } });
      expect(res.json().tags).toEqual([]);
    });
  });
});
