import { z } from 'zod';
import {
  AdminPostListSchema,
  AdminStatsSchema,
  ApiErrorSchema,
  PostReachSchema,
  TakedownResponseSchema,
  type AdminTab,
  type StatsRange,
  type PostRef,
  type TakedownRequest,
} from '@booktrap/shared';
import { API_URL, ApiRequestError, NetworkError } from './client';

/**
 * The hidden admin page's calls. They carry the admin key (kept in this tab only), never the
 * reader's Supabase session.
 */
export function createAdminClient(key: string, baseUrl = API_URL) {
  const root = baseUrl.replace(/\/+$/, '');
  async function request<T>(path: string, schema: z.ZodType<T> | null, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout?.(75_000),
      });
    } catch (error) {
      throw new NetworkError('Could not reach the BookTrap server.', { cause: error });
    }
    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new ApiRequestError(response.status, parsed.success ? parsed.data.error.code : 'unknown', parsed.success ? parsed.data.error.message : `Request failed with status ${response.status}.`);
    }
    if (!schema) return undefined as T;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ApiRequestError(response.status, 'invalid_response', 'The server sent a response this page does not understand.');
    return parsed.data;
  }

  return {
    /** Throws a 401 ApiRequestError when the key is wrong. */
    check: () => request<void>('/admin/check', null),
    posts: (tab: AdminTab) => request(`/admin/posts?tab=${tab}`, AdminPostListSchema),
    reach: (post: PostRef) => request(`/admin/reach?platform=${post.platform}&postId=${encodeURIComponent(post.postId)}`, PostReachSchema),
    takeDown: (target: TakedownRequest) => request('/admin/takedown', TakedownResponseSchema, target),
    dismiss: (post: PostRef) => request('/admin/dismiss', z.object({ dismissed: z.number() }), post),
    unblock: (post: PostRef) => request('/admin/unblock', z.object({ unblocked: z.boolean() }), post),
    /** Counts and totals, with days in this browser's time zone (the answer says which zone was used). */
    stats: (range: StatsRange) => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return request(`/admin/stats?range=${range}${zone ? `&tz=${encodeURIComponent(zone)}` : ''}`, AdminStatsSchema);
    },
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;
