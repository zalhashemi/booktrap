import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, NetworkError, createApiClient, type ApiClient } from '../api/client';
import { bootstrapDevice } from './bootstrap';
import { createCredentialStore } from './credentials';

const ME = { deviceId: 'x', createdAt: '2026-10-08T00:00:00.000Z' };

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    health: vi.fn(),
    registerDevice: vi.fn().mockResolvedValue({ deviceId: 'x', created: true }),
    me: vi.fn().mockResolvedValue(ME),
    createJob: vi.fn(),
    listJobs: vi.fn(),
    retryItem: vi.fn(),
    listBooks: vi.fn(),
    ...overrides,
  };
}

describe('bootstrapDevice', () => {
  it('registers on first launch and remembers that it did', async () => {
    const store = createCredentialStore(null);
    const api = fakeApi();
    const session = await bootstrapDevice(api, store);
    expect(api.registerDevice).toHaveBeenCalledOnce();
    expect(session.credentials.registered).toBe(true);
    expect(store.load()?.registered).toBe(true);

    await bootstrapDevice(api, store);
    expect(api.registerDevice).toHaveBeenCalledOnce();
  });

  it('re-registers once when the server no longer knows the device', async () => {
    const store = createCredentialStore(null);
    const me = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError(401, 'unauthorized', 'no'))
      .mockResolvedValue(ME);
    store.save({ deviceId: crypto.randomUUID(), deviceSecret: 'a'.repeat(43), registered: true });
    const api = fakeApi({ me });
    await bootstrapDevice(api, store);
    expect(api.registerDevice).toHaveBeenCalledOnce();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('surfaces network failures without touching stored credentials', async () => {
    const store = createCredentialStore(null);
    const api = fakeApi({ registerDevice: vi.fn().mockRejectedValue(new NetworkError('down')) });
    await expect(bootstrapDevice(api, store)).rejects.toBeInstanceOf(NetworkError);
    expect(store.load()?.registered).toBe(false);
  });
});

describe('api client', () => {
  it('sends device credentials as headers and parses the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(ME), { status: 200 }));
    const client = createApiClient('https://api.example/', fetchImpl);
    const credentials = { deviceId: crypto.randomUUID(), deviceSecret: 'b'.repeat(43) };
    await expect(client.me(credentials)).resolves.toEqual(ME);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example/v1/me');
    expect(init.headers['x-device-id']).toBe(credentials.deviceId);
    expect(init.headers['x-device-secret']).toBe(credentials.deviceSecret);
  });

  it('turns error bodies into ApiRequestError', async () => {
    const body = { error: { code: 'rate_limited', message: 'slow down' } };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 429 }));
    const client = createApiClient('https://api.example', fetchImpl);
    await expect(client.health()).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('turns fetch failures into NetworkError', async () => {
    const client = createApiClient('https://api.example', vi.fn().mockRejectedValue(new TypeError('fail')));
    await expect(client.health()).rejects.toBeInstanceOf(NetworkError);
  });

  it('reports a caller abort as an abort, not as a network failure', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    );
    const client = createApiClient('https://api.example', fetchImpl as unknown as typeof fetch);
    const controller = new AbortController();
    const pending = client.health(controller.signal);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('works where AbortSignal.any is missing (older iOS Safari)', async () => {
    const original = AbortSignal.any;
    // @ts-expect-error simulating an older browser
    delete AbortSignal.any;
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('{"ok":true,"service":"booktrap-api","version":"1","storage":"memory"}'));
      const client = createApiClient('https://api.example', fetchImpl);
      await expect(client.health(new AbortController().signal)).resolves.toMatchObject({ ok: true });
    } finally {
      AbortSignal.any = original;
    }
  });

  it('rejects responses that do not match the schema', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"ok":"yes"}', { status: 200 }));
    const client = createApiClient('https://api.example', fetchImpl);
    await expect(client.health()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
