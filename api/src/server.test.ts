import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { purgeIdleGuests } from './account';
import { testSessions } from './auth/test-sessions';
import { loadConfig } from './config';
import { JobQueue } from './pipeline/queue';
import { buildApp } from './server';
import { createMemoryLibraryStore } from './store/memory';
import { createMemoryUserDirectory, type MemoryUserDirectory } from './users/memory';

let sessions: Awaited<ReturnType<typeof testSessions>>;
beforeAll(async () => {
  sessions = await testSessions();
});

/** App with in-memory storage and a queue that never runs anything (route-level tests). */
function testApp(env: Record<string, string>, store = createMemoryLibraryStore(), users: MemoryUserDirectory = createMemoryUserDirectory()) {
  return buildApp({
    config: loadConfig({ NODE_ENV: 'test', ...env }),
    verifySession: sessions.verify,
    users,
    store,
    queue: new JobQueue(async () => {}),
  });
}

/**
 * A store whose reads take a moment, like a real database, so parallel requests really overlap.
 * Paired with `listening()`: inject() hands requests over one at a time, so races need real HTTP.
 */
function slowStore() {
  const store = createMemoryLibraryStore();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
  const { countItemsSince, spendSince } = store;
  // Read, then the answer takes a moment to arrive: what a request saw can be stale by the time it acts.
  const slow = <A extends unknown[], R>(read: (...args: A) => Promise<R>) => async (...args: A) => {
    const result = await read(...args);
    await pause();
    return result;
  };
  store.countItemsSince = slow(countItemsSince);
  store.spendSince = slow(spendSince);
  return store;
}

type App = Awaited<ReturnType<typeof buildApp>>;

/** Starts the app on a free port and returns a fetch for it, for tests that need truly parallel requests. */
async function listening(app: App) {
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  onTestFinished(() => app.close());
  return (path: string, init: { method: string; headers: Record<string, string>; body: unknown }) =>
    fetch(`${base}${path}`, { ...init, headers: { ...init.headers, 'content-type': 'application/json' }, body: JSON.stringify(init.body) });
}

const BOOK = { author: null, isbn10: null, isbn13: null, coverUrl: null, publishedYear: null, verified: false };

describe('API', () => {
  let app: App;
  let users: MemoryUserDirectory;

  beforeEach(async () => {
    users = createMemoryUserDirectory();
    app = await testApp({}, createMemoryLibraryStore(), users);
  });
  afterEach(() => app.close());

  it('reports health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: 'booktrap-api', storage: 'memory' });
  });

  it('says who is signed in, and whether they are a guest', async () => {
    const member = await sessions.signIn();
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: member.headers })).json()).toEqual({ userId: member.userId, isGuest: false });
    const guest = await sessions.signIn({ guest: true });
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: guest.headers })).json()).toEqual({ userId: guest.userId, isGuest: true });
  });

  it.each([
    ['no token', () => ({})],
    ['a device id and secret', () => ({ 'x-device-id': randomUUID(), 'x-device-secret': 'x'.repeat(43) })],
    ['a malformed token', () => ({ authorization: 'Bearer abc' })],
  ])('returns 401 for %s', async (_label, headers) => {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: headers() });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('notes a visit at most once an hour', async () => {
    const guest = await sessions.signIn({ guest: true });
    users.add(guest.userId, { guest: true, createdAt: new Date(Date.now() - 40 * 86_400_000) });
    const longAgo = new Date(Date.now() - 30 * 86_400_000);
    expect(await users.inactiveGuests(longAgo, 10)).toEqual([guest.userId]);
    await app.inject({ method: 'GET', url: '/v1/me', headers: guest.headers });
    await new Promise((resolve) => setImmediate(resolve));
    expect(await users.inactiveGuests(longAgo, 10)).toEqual([]);
  });

  it('only allows the configured CORS origin, with the Authorization header', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: { origin: 'http://localhost:5180', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5180');
    expect(allowed.headers['access-control-allow-headers']).toMatch(/authorization/);
    const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps private responses out of caches and turns off content sniffing', async () => {
    const { headers } = await sessions.signIn();
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers });
    expect(res.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  });

  it('uses the standard error shape for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });
});

describe('accounts', () => {
  async function setup() {
    const store = createMemoryLibraryStore();
    const users = createMemoryUserDirectory();
    const app = await testApp({}, store, users);
    onTestFinished(() => app.close());
    const signIn = async (guest = false) => {
      const session = await sessions.signIn({ guest });
      users.add(session.userId, { guest });
      return { ...session, token: session.headers.authorization.slice('Bearer '.length) };
    };
    return { app, store, users, signIn };
  }

  it('deletes an account and everything in it', async () => {
    const { app, store, users, signIn } = await setup();
    const reader = await signIn();
    await store.insertBook(reader.userId, { ...BOOK, title: 'Babel', normalizedKey: 'babel' });
    await store.createTag(reader.userId, 'Fantasy');
    expect((await app.inject({ method: 'DELETE', url: '/v1/account' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/v1/account', headers: reader.headers })).statusCode).toBe(204);
    expect(await store.listBooks(reader.userId)).toEqual([]);
    expect(await store.listTags(reader.userId)).toEqual([]);
    expect(users.has(reader.userId)).toBe(false);
  });

  it('merges a guest shelf into the account logged in to, folding duplicates', async () => {
    const { app, store, users, signIn } = await setup();
    const reader = await signIn();
    const guest = await signIn(true);
    const kept = await store.insertBook(reader.userId, { ...BOOK, title: 'Piranesi', author: 'Susanna Clarke', normalizedKey: 'piranesi' });
    await store.addSource(kept, { platform: 'tiktok', postId: '1', url: 'https://www.tiktok.com/@a/video/1', creatorHandle: 'a', thumbnailUrl: null, evidence: null, confidence: null });
    await store.createTag(reader.userId, 'Fantasy');

    const twin = await store.insertBook(guest.userId, { ...BOOK, title: 'Piranesi', author: 'Susanna Clarke', normalizedKey: 'piranesi' });
    await store.addSource(twin, { platform: 'instagram', postId: 'X', url: 'https://www.instagram.com/p/X/', creatorHandle: 'b', thumbnailUrl: null, evidence: null, confidence: null });
    const fresh = await store.insertBook(guest.userId, { ...BOOK, title: 'Circe', author: 'Madeline Miller', normalizedKey: 'circe' });
    const fantasy = await store.createTag(guest.userId, 'fantasy');
    const myths = await store.createTag(guest.userId, 'Myths');
    await store.setBookTags(guest.userId, fresh, [fantasy.id, myths.id]);

    const res = await app.inject({ method: 'POST', url: '/v1/account/merge-guest', headers: reader.headers, payload: { guestToken: guest.token } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ added: 1, folded: 1 });

    const shelf = await store.listBooks(reader.userId);
    expect(shelf.map((book) => book.title).sort()).toEqual(['Circe', 'Piranesi']);
    expect(shelf.find((book) => book.title === 'Piranesi')!.sources.map((source) => source.platform).sort()).toEqual(['instagram', 'tiktok']);
    // "fantasy" joined the account's "Fantasy"; "Myths" moved over.
    expect((await store.listTags(reader.userId)).map((tag) => tag.name)).toEqual(['Fantasy', 'Myths']);
    expect(shelf.find((book) => book.title === 'Circe')!.tags.map((tag) => tag.name)).toEqual(['Fantasy', 'Myths']);
    expect(await store.listBooks(guest.userId)).toEqual([]);
    expect(users.has(guest.userId)).toBe(false);
  });

  it('moves a guest’s posts today onto the account, so the daily cap still counts them', async () => {
    const { app, store, signIn } = await setup();
    const reader = await signIn();
    const guest = await signIn(true);
    await store.createJob(guest.userId, null, [{ inputUrl: 'u', platform: 'tiktok', postId: '1', kind: 'video' }]);
    await app.inject({ method: 'POST', url: '/v1/account/merge-guest', headers: reader.headers, payload: { guestToken: guest.token } });
    expect(await store.countItemsSince({ userId: reader.userId }, new Date(0))).toBe(1);
  });

  it('only merges a guest shelf, and only into a signed-in account', async () => {
    const { app, store, signIn } = await setup();
    const reader = await signIn();
    const other = await signIn();
    const guest = await signIn(true);
    await store.insertBook(other.userId, { ...BOOK, title: 'Babel', normalizedKey: 'babel' });
    const merge = (headers: Record<string, string>, guestToken: string) =>
      app.inject({ method: 'POST', url: '/v1/account/merge-guest', headers, payload: { guestToken } });

    // Another account's token can't hand its books over.
    expect((await merge(reader.headers, other.token)).statusCode).toBe(403);
    expect(await store.listBooks(other.userId)).toHaveLength(1);
    // A guest can't merge into a guest, a forged token is refused, and so is the account's own.
    expect((await merge(guest.headers, guest.token)).statusCode).toBe(400);
    expect((await merge(reader.headers, `${guest.token.slice(0, -4)}AAAA`)).statusCode).toBe(403);
    expect((await merge(reader.headers, reader.token)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/account/merge-guest', headers: reader.headers, payload: {} })).statusCode).toBe(400);
  });

  it('refuses a guest token issued before that guest saved their shelf', async () => {
    const { app, store, users, signIn } = await setup();
    const reader = await signIn();
    const former = await signIn(true);
    await store.insertBook(former.userId, { ...BOOK, title: 'Babel', normalizedKey: 'babel' });
    // The token still says "guest" for up to an hour, but the user has added an email since.
    users.upgrade(former.userId);
    const res = await app.inject({ method: 'POST', url: '/v1/account/merge-guest', headers: reader.headers, payload: { guestToken: former.token } });
    expect(res.statusCode).toBe(403);
    expect(await store.listBooks(former.userId)).toHaveLength(1);
    expect(users.has(former.userId)).toBe(true);
  });

  it('refuses a deleted account’s token that hasn’t expired yet', async () => {
    const { app, signIn } = await setup();
    const reader = await signIn();
    expect((await app.inject({ method: 'DELETE', url: '/v1/account', headers: reader.headers })).statusCode).toBe(204);
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: reader.headers });
    expect(res.statusCode).toBe(401);
  });

  it('finishes a merge that failed half way when it is tried again, still folding duplicates', async () => {
    const { app, store, users, signIn } = await setup();
    const reader = await signIn();
    const guest = await signIn(true);
    for (const title of ['Piranesi', 'Circe', 'Babel']) {
      await store.insertBook(reader.userId, { ...BOOK, title, normalizedKey: title.toLowerCase() });
      await store.insertBook(guest.userId, { ...BOOK, title, normalizedKey: title.toLowerCase() });
    }
    const { mergeBooks } = store;
    let calls = 0;
    store.mergeBooks = async (...args) => {
      if (++calls === 2) throw new Error('connection reset');
      return mergeBooks(...args);
    };
    const merge = () => app.inject({ method: 'POST', url: '/v1/account/merge-guest', headers: reader.headers, payload: { guestToken: guest.token } });
    expect((await merge()).statusCode).toBe(500);
    // The first try folded one book; the retry folds the one still waiting.
    expect((await merge()).json()).toEqual({ added: 0, folded: 1 });
    // The book moved just before the failure stays a second copy (one at most); nothing is lost.
    const titles = (await store.listBooks(reader.userId)).map((book) => book.title).sort();
    expect(titles).toHaveLength(4);
    expect(new Set(titles)).toEqual(new Set(['Babel', 'Circe', 'Piranesi']));
    expect(users.has(guest.userId)).toBe(false);
  });

  it('deletes guests nobody has visited for 30 days, and only them', async () => {
    const store = createMemoryLibraryStore();
    const users = createMemoryUserDirectory();
    const old = new Date(Date.now() - 31 * 86_400_000);
    users.add('idle-guest', { guest: true, createdAt: old });
    users.add('new-guest', { guest: true });
    users.add('idle-member', { createdAt: old });
    await store.insertBook('idle-guest', { ...BOOK, title: 'Babel', normalizedKey: 'babel' });
    await store.insertBook('idle-member', { ...BOOK, title: 'Circe', normalizedKey: 'circe' });

    expect(await purgeIdleGuests({ store, users, queue: new JobQueue(async () => {}) })).toBe(1);
    expect(users.has('idle-guest')).toBe(false);
    expect(await store.listBooks('idle-guest')).toEqual([]);
    expect(users.has('new-guest')).toBe(true);
    expect(await store.listBooks('idle-member')).toHaveLength(1);
  });
});

describe('jobs API', () => {
  const VIDEO = 'https://www.tiktok.com/@reader/video/7672440936101727519';
  const KEYS = { APIFY_TOKEN: 'a', ANTHROPIC_API_KEY: 'b', DAILY_LINK_CAP_PER_USER: '2' };

  async function registered(_app: App, guest = false) {
    return (await sessions.signIn({ guest })).headers;
  }

  it('requires a signed-in user', async () => {
    const app = await testApp(KEYS);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', payload: { urls: [VIDEO] } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates a job, de-duplicating the same post pasted twice', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls: [VIDEO, `${VIDEO}?_t=1`] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ status: 'queued', postId: '7672440936101727519', kind: 'video' });
    await app.close();
  });

  it('reports today’s usage against the daily limit', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    expect((await app.inject({ method: 'GET', url: '/v1/usage', headers })).json()).toEqual({ postsToday: 0, dailyLimit: 2 });
    await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls: [VIDEO] } });
    expect((await app.inject({ method: 'GET', url: '/v1/usage', headers })).json()).toEqual({ postsToday: 1, dailyLimit: 2 });
    expect((await app.inject({ method: 'GET', url: '/v1/usage' })).statusCode).toBe(401);
    await app.close();
  });

  it('rejects links that are not TikTok or Instagram', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls: ['https://evil.example/x'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/aren’t TikTok or Instagram links/);
    await app.close();
  });

  it('takes TikTok and Instagram links in one paste, with the platform on each item', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    const urls = [VIDEO, 'https://www.instagram.com/reel/DeMTMjJjmqF/?igsh=x', 'https://www.instagram.com/reels/DeMTMjJjmqF/'];
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls } });
    expect(res.statusCode).toBe(201);
    expect(res.json().items.map((item: { platform: string; postId: string; kind: string }) => [item.platform, item.postId, item.kind])).toEqual([
      ['tiktok', '7672440936101727519', 'video'],
      ['instagram', 'DeMTMjJjmqF', 'video'],
    ]);
    await app.close();
  });

  it('counts Instagram links against the same daily cap', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    const urls = ['https://www.instagram.com/p/DeJvdqUjLd1/', 'https://www.instagram.com/p/DeJhSQfmt6k/', VIDEO];
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls } });
    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it('counts a collection link as room for one post, not as a post of its own', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    // Cap 2: one video plus one collection fits; the collection reads whatever is left when it expands.
    const urls = [VIDEO, 'https://www.tiktok.com/@reader/playlist/Books-7442134949027351314'];
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls } });
    expect(res.statusCode).toBe(201);
    expect(res.json().items.map((item: { kind: string }) => item.kind)).toEqual(['video', 'collection']);
    await app.close();
  });

  it('explains that saved Instagram collections are private', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers,
      payload: { urls: ['https://www.instagram.com/reader/saved/books/17912345678901234/'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/saved collections private/);
    await app.close();
  });

  it('reports "paused" instead of accepting links when the scraper keys are missing', async () => {
    const app = await testApp({});
    const headers = await registered(app);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls: [VIDEO] } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('processing_paused');
    await app.close();
  });

  it('enforces the per-user daily cap with a clear message', async () => {
    const app = await testApp(KEYS);
    const headers = await registered(app);
    const urls = ['7672440936101727519', '7672440936101727520', '7672440936101727521'].map(
      (id) => `https://www.tiktok.com/@reader/video/${id}`,
    );
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers, payload: { urls } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatchObject({ code: 'limit_reached' });
    expect(res.json().error.message).toMatch(/add 2 more posts today/);
    await app.close();
  });

  it('never lets parallel submissions slip past the daily cap together', async () => {
    const app = await testApp(KEYS, slowStore());
    const headers = await registered(app);
    const urls = ['7672440936101727519', '7672440936101727520', '7672440936101727521', '7672440936101727522', '7672440936101727523'];
    const post = await listening(app);
    const responses = await Promise.all(
      urls.map((id) => post('/v1/jobs', { method: 'POST', headers, body: { urls: [`https://www.tiktok.com/@reader/video/${id}`] } })),
    );
    // Cap 2: exactly two get in, however the requests interleave.
    expect(responses.map((res) => res.status).sort()).toEqual([201, 201, 429, 429, 429]);
    expect((await app.inject({ method: 'GET', url: '/v1/usage', headers })).json().postsToday).toBe(2);
  });

  it('holds the per-network cap across readers submitting at once', async () => {
    const app = await testApp({ ...KEYS, DAILY_LINK_CAP_PER_USER: '10', DAILY_LINK_CAP_PER_IP: '2' }, slowStore());
    const readers = await Promise.all([registered(app), registered(app), registered(app)]);
    const post = await listening(app);
    const responses = await Promise.all(
      readers.map((headers, index) =>
        post('/v1/jobs', { method: 'POST', headers, body: { urls: [`https://www.tiktok.com/@reader/video/767244093610172752${index}`] } }),
      ),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([201, 201, 429]);
    const refused = responses.find((res) => res.status === 429)!;
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/network has reached today’s limit/);
  });

  it('erases a deleted account’s books and jobs, but its posts still count against the network’s cap', async () => {
    const store = createMemoryLibraryStore();
    const app = await testApp({ ...KEYS, DAILY_LINK_CAP_PER_USER: '10', DAILY_LINK_CAP_PER_IP: '2' }, store);
    const first = await sessions.signIn();
    const urls = ['7672440936101727519', '7672440936101727520'].map((id) => `https://www.tiktok.com/@reader/video/${id}`);
    expect((await app.inject({ method: 'POST', url: '/v1/jobs', headers: first.headers, payload: { urls } })).statusCode).toBe(201);
    await store.insertBook(first.userId, { ...BOOK, title: 'Babel', normalizedKey: 'babel' });

    expect((await app.inject({ method: 'DELETE', url: '/v1/account', headers: first.headers })).statusCode).toBe(204);
    expect(await store.listBooks(first.userId)).toEqual([]);
    expect(await store.listJobs(first.userId, 5)).toEqual([]);

    // Starting over on the same network doesn't buy a fresh daily allowance.
    const second = await registered(app, true);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers: second, payload: { urls: [`https://www.tiktok.com/@reader/video/7672440936101727521`] } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toMatch(/network has reached today’s limit/);
    await app.close();
  });

  it('gives guests the guest cap, and says that saving the shelf raises it', async () => {
    const app = await testApp({ ...KEYS, DAILY_LINK_CAP_PER_USER: '40', DAILY_LINK_CAP_GUEST: '1' });
    const guest = await registered(app, true);
    expect((await app.inject({ method: 'GET', url: '/v1/usage', headers: guest })).json()).toEqual({ postsToday: 0, dailyLimit: 1 });
    const urls = ['7672440936101727519', '7672440936101727520'].map((id) => `https://www.tiktok.com/@reader/video/${id}`);
    const res = await app.inject({ method: 'POST', url: '/v1/jobs', headers: guest, payload: { urls } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toMatch(/add 1 more post today \(limit 1\).*Save your shelf to read up to 40 a day/);
    const member = await registered(app);
    expect((await app.inject({ method: 'POST', url: '/v1/jobs', headers: member, payload: { urls } })).statusCode).toBe(201);
    await app.close();
  });

  it('never shows one reader another reader’s job', async () => {
    const app = await testApp(KEYS);
    const owner = await registered(app);
    const job = (await app.inject({ method: 'POST', url: '/v1/jobs', headers: owner, payload: { urls: [VIDEO] } })).json();
    const stranger = await registered(app);
    const res = await app.inject({ method: 'GET', url: `/v1/jobs/${job.id}`, headers: stranger });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('rate limiting behind a proxy', () => {
  it('ignores client-forged X-Forwarded-For entries when counting requests', async () => {
    const app = await testApp({ TRUST_PROXY_HOPS: '1' });
    try {
      const statuses: number[] = [];
      for (let n = 0; n < 61; n++) {
        const res = await app.inject({
          method: 'GET',
          url: '/health/ready',
          // The client forges the leftmost entry; the proxy appends the real address last.
          headers: { 'x-forwarded-for': `10.0.0.${n}, 203.0.113.7` },
        });
        statuses.push(res.statusCode);
      }
      // 60 a minute per real address, whatever the forged part says.
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe('config', () => {
  it('trusts one proxy hop by default in production only', () => {
    const prodEnv = { NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', IP_HASH_KEY: 'h' };
    expect(loadConfig(prodEnv).TRUST_PROXY_HOPS).toBe(1);
    expect(loadConfig({}).TRUST_PROXY_HOPS).toBe(0);
  });

  it('requires its own IP hash key in production, rather than borrowing the Supabase key', () => {
    const env = { NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(() => loadConfig(env)).toThrow(/IP_HASH_KEY is required/);
    expect(loadConfig({ ...env, IP_HASH_KEY: 'h' }).ipHashKey).toBe('h');
  });

  it('requires Supabase in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/required in production/);
  });

  it('rejects half-configured Supabase', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toThrow(/both/);
  });

  it('reduces a Supabase Data API URL to the project origin', () => {
    const config = loadConfig({ SUPABASE_URL: 'https://abcd.supabase.co/rest/v1/', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(config.SUPABASE_URL).toBe('https://abcd.supabase.co');
  });

  it('parses a comma-separated origin list', () => {
    expect(loadConfig({ ALLOWED_ORIGIN: 'https://a.dev, https://b.dev' }).ALLOWED_ORIGIN).toEqual([
      'https://a.dev',
      'https://b.dev',
    ]);
  });
});
