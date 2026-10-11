import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { JobQueue } from '../pipeline/queue';
import type { Verification } from '../pipeline/verify';
import { testSessions } from '../auth/test-sessions';
import { buildApp } from '../server';
import { createMemoryLibraryStore } from '../store/memory';
import type { LibraryStore } from '../store/types';
import { createMemoryUserDirectory } from '../users/memory';

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
  let userId: string;
  let coverFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let sessions: Awaited<ReturnType<typeof testSessions>> | undefined;

  async function shelve(title: string, author: string | null, postId: string = randomUUID()) {
    const id = await store.insertBook(userId, {
      title,
      author,
      isbn10: null,
      isbn13: null,
      coverUrl: null,
      publishedYear: null,
      verified: false,
      normalizedKey: title.toLowerCase(),
    });
    await store.addSource(id, { platform: 'tiktok', postId, url: `https://www.tiktok.com/@r/video/${postId}`, creatorHandle: 'r', thumbnailUrl: null, evidence: 'cover', confidence: 0.5 });
    return id;
  }

  beforeEach(async () => {
    sessions ??= await testSessions();
    store = createMemoryLibraryStore();
    verify = vi.fn(async (title: string, author: string | null) => unverified(title, author));
    coverFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      verifySession: sessions.verify,
      users: createMemoryUserDirectory(),
      store,
      queue: new JobQueue(async () => {}),
      verifyBook: verify as never,
      fetchImpl: (...args) => coverFetch(...args),
    });
    ({ userId, headers } = await sessions.signIn());
  });
  afterEach(() => app.close());

  it('edits status and notes, and clears the new highlight', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/books/${id}`,
      headers,
      payload: { status: 'reading', notes: '  borrowed from Sam  ', isNew: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'reading', notes: 'borrowed from Sam', isNew: false });
    expect(res.json()).not.toHaveProperty('unsure');
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
    expect(res.json()).toMatchObject({ title: 'The Secret History', isbn13: '9781400031702', publishedYear: 1992 });
  });

  it('keeps an edited book as typed when no catalogue match is found, with no flag', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { title: 'Babbel zine' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Babbel zine', author: 'R. F. Kuang' });
    expect(Object.keys(res.json())).not.toEqual(expect.arrayContaining(['unsure', 'verified']));
  });

  it('ignores an "unsure" field from an older app version', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { unsure: false } });
    expect(res.statusCode).toBe(200);
  });

  it('drops the old book’s ISBN and cover when a rename can’t be verified', async () => {
    const id = await shelve('Babel', 'R. F. Kuang');
    await store.updateBook(userId, id, {
      verified: true,
      isbn13: '9780063021426',
      coverUrl: 'https://covers.openlibrary.org/b/id/9-L.jpg',
      publishedYear: 2022,
    });
    const res = await app.inject({ method: 'PATCH', url: `/v1/books/${id}`, headers, payload: { title: 'Babbel zine' } });
    expect(res.json()).toMatchObject({ title: 'Babbel zine', isbn13: null, coverUrl: null, publishedYear: null });
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

  it('cannot touch another user’s books', async () => {
    const otherUser = randomUUID();
    const id = await store.insertBook(otherUser, {
      title: 'Not yours',
      author: null,
      isbn10: null,
      isbn13: null,
      coverUrl: null,
      publishedYear: null,
      verified: false,
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

  describe('book covers', () => {
    const jpeg = (bytes: number, headers: Record<string, string> = {}) =>
      new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/jpeg', ...headers } });

    async function shelveWithCover(coverUrl: string | null, owner = userId) {
      return store.insertBook(owner, {
        title: 'Babel',
        author: null,
        isbn10: null,
        isbn13: null,
        coverUrl,
        publishedYear: null,
        verified: true,
        normalizedKey: `babel-${randomUUID()}`,
      });
    }

    it('passes the stored cover through for its owner', async () => {
      const id = await shelveWithCover('https://books.google.com/books/content?id=x&img=1');
      coverFetch.mockResolvedValueOnce(jpeg(1234));
      const res = await app.inject({ method: 'GET', url: `/v1/books/${id}/cover`, headers });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, max-age=86400');
      expect(res.rawPayload).toHaveLength(1234);
      expect(coverFetch.mock.calls[0]![0]).toBe('https://books.google.com/books/content?id=x&img=1');
    });

    it('follows Open Library’s redirect to the Internet Archive', async () => {
      const id = await shelveWithCover('https://covers.openlibrary.org/b/id/1-L.jpg');
      coverFetch
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://ia800100.us.archive.org/view_archive.php?file=1-L.jpg' } }))
        .mockResolvedValueOnce(jpeg(10));
      expect((await app.inject({ method: 'GET', url: `/v1/books/${id}/cover`, headers })).statusCode).toBe(200);
    });

    it('follows Google Books’ hand-off to its image host', async () => {
      const id = await shelveWithCover('https://books.google.com/books/content?id=x&img=1');
      coverFetch
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://books.googleusercontent.com/books/content?id=x' } }))
        .mockResolvedValueOnce(jpeg(10));
      expect((await app.inject({ method: 'GET', url: `/v1/books/${id}/cover?v=abc`, headers })).statusCode).toBe(200);
    });

    it('never serves another user’s book', async () => {
      const id = await shelveWithCover('https://books.google.com/books/content?id=x', randomUUID());
      expect((await app.inject({ method: 'GET', url: `/v1/books/${id}/cover`, headers })).statusCode).toBe(404);
      expect(coverFetch).not.toHaveBeenCalled();
    });

    it('refuses hosts outside the cover allowlist, including on a redirect', async () => {
      const off = await shelveWithCover('https://evil.example/cover.jpg');
      expect((await app.inject({ method: 'GET', url: `/v1/books/${off}/cover`, headers })).statusCode).toBe(404);
      expect(coverFetch).not.toHaveBeenCalled();

      const hop = await shelveWithCover('https://covers.openlibrary.org/b/id/1-L.jpg');
      coverFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
      expect((await app.inject({ method: 'GET', url: `/v1/books/${hop}/cover`, headers })).statusCode).toBe(404);
      expect(coverFetch).toHaveBeenCalledTimes(1);
    });

    it('rejects non-images and covers over 2 MB', async () => {
      const id = await shelveWithCover('https://books.google.com/books/content?id=x');
      coverFetch.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      expect((await app.inject({ method: 'GET', url: `/v1/books/${id}/cover`, headers })).statusCode).toBe(404);
      coverFetch.mockResolvedValueOnce(jpeg(2 * 1024 * 1024 + 1));
      expect((await app.inject({ method: 'GET', url: `/v1/books/${id}/cover`, headers })).statusCode).toBe(404);
    });

    it('says 404 when there is no cover', async () => {
      const id = await shelveWithCover(null);
      expect((await app.inject({ method: 'GET', url: `/v1/books/${id}/cover`, headers })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/v1/books/not-a-uuid/cover', headers })).statusCode).toBe(404);
    });
  });
});
