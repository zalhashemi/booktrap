import type { z } from 'zod';
import {
  ApiErrorSchema,
  BookListResponseSchema,
  DEVICE_ID_HEADER,
  DEVICE_SECRET_HEADER,
  HealthResponseSchema,
  JobListResponseSchema,
  JobSchema,
  MeResponseSchema,
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

  async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.credentials) {
      headers[DEVICE_ID_HEADER] = options.credentials.deviceId;
      headers[DEVICE_SECRET_HEADER] = options.credentials.deviceSecret;
    }

    const { signal, dispose } = withTimeout(options.signal, REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      });
    } catch (error) {
      // A caller-initiated abort (e.g. React Query cancelling) is not a connectivity problem.
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      throw new NetworkError('Could not reach the BookTrap server.', { cause: error });
    } finally {
      dispose();
    }

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
  }

  return {
    health: (signal?: AbortSignal) => request('/health', { schema: HealthResponseSchema, signal }),
    registerDevice: (credentials: DeviceCredentials) =>
      request('/v1/devices', {
        method: 'POST',
        body: { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret },
        schema: RegisterDeviceResponseSchema,
      }),
    me: (credentials: DeviceCredentials) => request('/v1/me', { schema: MeResponseSchema, credentials }),
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
