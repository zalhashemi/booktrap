import { z } from 'zod';
import {
  ApiErrorSchema,
  BookListResponseSchema,
  BookSchema,
  CountResponseSchema,
  TagListResponseSchema,
  TagSchema,
  type UpdateBookRequest,
  DEVICE_ID_HEADER,
  DEVICE_SECRET_HEADER,
  HealthResponseSchema,
  JobListResponseSchema,
  JobSchema,
  MeResponseSchema,
  UsageResponseSchema,
  RegisterDeviceResponseSchema,
  type DeviceCredentials,
} from '@booktrap/shared';

/**
 * The only module that talks to the BookTrap API. It never holds third-party keys:
 * the device credentials it sends are the user's own, generated on this device.
 */

/** Long enough for the free API host to wake from sleep. */
const REQUEST_TIMEOUT_MS = 75_000;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema: z.ZodType<T>;
  credentials?: DeviceCredentials;
  signal?: AbortSignal;
}

export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const root = baseUrl.replace(/\/+$/, '');

  /**
   * One HTTP exchange with the device headers and a timeout. `read` runs while the timeout still
   * applies, so a body that stalls mid-download is cut off too.
   */
  async function send<R>(
    path: string,
    options: { method?: RequestOptions<unknown>['method']; body?: unknown; credentials?: DeviceCredentials; signal?: AbortSignal; timeoutMs?: number },
    read: (response: Response) => Promise<R>,
  ): Promise<R> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.credentials) {
      headers[DEVICE_ID_HEADER] = options.credentials.deviceId;
      headers[DEVICE_SECRET_HEADER] = options.credentials.deviceSecret;
    }

    const { signal, dispose } = withTimeout(options.signal, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      });
      return await read(response);
    } catch (error) {
      // A caller-initiated abort (e.g. React Query cancelling) is not a connectivity problem.
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      if (error instanceof ApiRequestError) throw error;
      throw new NetworkError('Could not reach the BookTrap server.', { cause: error });
    } finally {
      dispose();
    }
  }

  async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    return send(path, options, async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw parsed.success
          ? new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
          : new ApiRequestError(response.status, 'unknown', `Request failed with status ${response.status}.`);
      }
      const parsed = options.schema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiRequestError(response.status, 'invalid_response', 'The server sent a response this app does not understand.');
      }
      return parsed.data;
    });
  }

  /**
   * A book's cover image (passed through by the API for the PDF), or null when there's none or it
   * fails. `version` changes when the book's cover does, so the browser cache never serves an old one.
   * A big shelf can hit the covers' rate limit: those wait as the server asks and try again.
   */
  async function bookCover(credentials: DeviceCredentials, bookId: string, version: string, signal?: AbortSignal): Promise<Blob | null> {
    const path = `/v1/books/${encodeURIComponent(bookId)}/cover?v=${encodeURIComponent(version)}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      let retryAfter = 0;
      try {
        const blob = await send(path, { credentials, signal, timeoutMs: 20_000 }, async (response) => {
          if (response.status === 429) {
            retryAfter = Math.min(30, Number(response.headers.get('retry-after')) || 2 ** (attempt + 1));
            return null;
          }
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
          return response.blob();
        });
        if (!retryAfter) return blob;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      if (signal?.aborted) throw signal.reason;
    }
    return null;
  }

  return {
    bookCover,
    health: (signal?: AbortSignal) => request('/health', { schema: HealthResponseSchema, signal }),
    registerDevice: (credentials: DeviceCredentials) =>
      request('/v1/devices', {
        method: 'POST',
        body: { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret },
        schema: RegisterDeviceResponseSchema,
      }),
    me: (credentials: DeviceCredentials) => request('/v1/me', { schema: MeResponseSchema, credentials }),
    /** Deletes this device's shelf from the server for good. */
    deleteDevice: (credentials: DeviceCredentials) =>
      request('/v1/devices/me', { method: 'DELETE', schema: z.unknown(), credentials }),
    usage: (credentials: DeviceCredentials, signal?: AbortSignal) => request('/v1/usage', { schema: UsageResponseSchema, credentials, signal }),
    createJob: (credentials: DeviceCredentials, urls: string[]) =>
      request('/v1/jobs', { method: 'POST', body: { urls }, schema: JobSchema, credentials }),
    listJobs: (credentials: DeviceCredentials, signal?: AbortSignal) =>
      request('/v1/jobs', { schema: JobListResponseSchema, credentials, signal }),
    retryItem: (credentials: DeviceCredentials, jobId: string, itemId: string) =>
      request(`/v1/jobs/${encodeURIComponent(jobId)}/items/${encodeURIComponent(itemId)}/retry`, {
        method: 'POST',
        schema: JobSchema,
        credentials,
      }),
    listBooks: (credentials: DeviceCredentials, signal?: AbortSignal) =>
      request('/v1/books', { schema: BookListResponseSchema, credentials, signal }),
    updateBook: (credentials: DeviceCredentials, bookId: string, patch: UpdateBookRequest) =>
      request(`/v1/books/${encodeURIComponent(bookId)}`, { method: 'PATCH', body: patch, schema: BookSchema, credentials }),
    deleteBooks: (credentials: DeviceCredentials, ids: string[]) =>
      request('/v1/books/delete', { method: 'POST', body: { ids }, schema: CountResponseSchema, credentials }),
    restoreBooks: (credentials: DeviceCredentials, ids: string[]) =>
      request('/v1/books/restore', { method: 'POST', body: { ids }, schema: CountResponseSchema, credentials }),
    markAllSeen: (credentials: DeviceCredentials) =>
      request('/v1/books/mark-seen', { method: 'POST', body: {}, schema: CountResponseSchema, credentials }),
    mergeBooks: (credentials: DeviceCredentials, keepId: string, mergeIds: string[]) =>
      request('/v1/books/merge', { method: 'POST', body: { keepId, mergeIds }, schema: BookSchema, credentials }),
    listTags: (credentials: DeviceCredentials, signal?: AbortSignal) =>
      request('/v1/tags', { schema: TagListResponseSchema, credentials, signal }),
    createTag: (credentials: DeviceCredentials, name: string) =>
      request('/v1/tags', { method: 'POST', body: { name }, schema: TagSchema, credentials }),
    renameTag: (credentials: DeviceCredentials, tagId: string, name: string) =>
      request(`/v1/tags/${encodeURIComponent(tagId)}`, { method: 'PATCH', body: { name }, schema: TagSchema, credentials }),
    deleteTag: (credentials: DeviceCredentials, tagId: string) =>
      request(`/v1/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE', schema: z.unknown(), credentials }),
  };
}

/**
 * Combines an optional caller signal with a timeout. Built by hand rather than with
 * AbortSignal.any / AbortSignal.timeout, which older iOS Safari versions lack.
 */
function withTimeout(callerSignal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
  const forward = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forward();
  else callerSignal?.addEventListener('abort', forward, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forward);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// vite.config.ts refuses to build for production without VITE_API_URL, so the
// localhost fallback can only ever apply in development and tests.
export const api = createApiClient(import.meta.env.VITE_API_URL || 'http://localhost:8787');
