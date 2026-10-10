import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { createMemoryDeviceRepo } from './repo/memory';
import type { DeviceRepo } from './repo/types';
import { JobQueue } from './pipeline/queue';
import { buildApp } from './server';
import { createMemoryLibraryStore } from './store/memory';

/** App with in-memory storage and a queue that never runs anything (route-level tests). */
function testApp(env: Record<string, string>, devices: DeviceRepo = createMemoryDeviceRepo()) {
  return buildApp({
    config: loadConfig({ NODE_ENV: 'test', ...env }),
    devices,
    store: createMemoryLibraryStore(),
    queue: new JobQueue(async () => {}),
  });
}

type App = Awaited<ReturnType<typeof buildApp>>;

function newCredentials() {
  return { deviceId: randomUUID(), deviceSecret: randomBytes(32).toString('base64url') };
}

function authHeaders(creds: { deviceId: string; deviceSecret: string }) {
  return { 'x-device-id': creds.deviceId, 'x-device-secret': creds.deviceSecret };
}

describe('API', () => {
  let app: App;
  let repo: DeviceRepo;

  beforeEach(async () => {
    repo = createMemoryDeviceRepo();
    app = await testApp({}, repo);
  });
  afterEach(() => app.close());

  it('reports health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: 'booktrap-api', storage: 'memory' });
  });

  it('registers a device and stores only a hash of the secret', async () => {
    const creds = newCredentials();
    const res = await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ deviceId: creds.deviceId, created: true });

    const stored = await repo.find(creds.deviceId);
    expect(stored?.secretHash).toBeDefined();
    expect(stored?.secretHash).not.toContain(creds.deviceSecret);
  });

  it('treats re-registration with the same secret as a no-op', async () => {
    const creds = newCredentials();
    await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    const again = await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ deviceId: creds.deviceId, created: false });
  });

  it('refuses to re-register an id with a different secret', async () => {
    const creds = newCredentials();
    await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    const hijack = await app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { ...creds, deviceSecret: newCredentials().deviceSecret },
    });
    expect(hijack.statusCode).toBe(409);
    expect(hijack.json().error.code).toBe('device_exists');
  });

  it('rejects malformed registration bodies', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/devices', payload: { deviceId: 'nope', deviceSecret: 'short' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });

  it('authorizes /v1/me with valid credentials', async () => {
    const creds = newCredentials();
    await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: authHeaders(creds) });
    expect(res.statusCode).toBe(200);
    expect(res.json().deviceId).toBe(creds.deviceId);
  });

  it.each([
    ['no headers', () => ({})],
    ['unknown device', () => authHeaders(newCredentials())],
    ['malformed secret', () => ({ 'x-device-id': randomUUID(), 'x-device-secret': 'x' })],
  ])('returns 401 for %s', async (_label, headers) => {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: headers() });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('returns 401 for a registered device with the wrong secret', async () => {
    const creds = newCredentials();
    await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: authHeaders({ ...creds, deviceSecret: newCredentials().deviceSecret }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('only allows the configured CORS origin', async () => {
    const allowed = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5180' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5180');
    const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses the standard error shape for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });
});

describe('jobs API', () => {
  const VIDEO = 'https://www.tiktok.com/@reader/video/7672440936101727519';
  const KEYS = { APIFY_TOKEN: 'a', ANTHROPIC_API_KEY: 'b', DAILY_LINK_CAP_PER_DEVICE: '2' };

  async function registered(app: App) {
    const creds = newCredentials();
    await app.inject({ method: 'POST', url: '/v1/devices', payload: creds });
    return authHeaders(creds);
  }

  it('requires device credentials', async () => {
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

  it('enforces the per-device daily cap with a clear message', async () => {
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

  it('never shows one device another device’s job', async () => {
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
  it('ignores client-forged X-Forwarded-For entries when counting registrations', async () => {
    const app = await testApp({ TRUST_PROXY_HOPS: '1', REGISTRATIONS_PER_IP_PER_HOUR: '2' });
    try {
      const statuses: number[] = [];
      for (let n = 0; n < 3; n++) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/devices',
          // The client forges the leftmost entry; the proxy appends the real address last.
          headers: { 'x-forwarded-for': `10.0.0.${n}, 203.0.113.7` },
          payload: newCredentials(),
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      await app.close();
    }
  });
});

describe('config', () => {
  it('trusts one proxy hop by default in production only', () => {
    const prodEnv = { NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(loadConfig(prodEnv).TRUST_PROXY_HOPS).toBe(1);
    expect(loadConfig({}).TRUST_PROXY_HOPS).toBe(0);
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
