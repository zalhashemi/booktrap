import { z } from 'zod';
import {
  AdminPostListSchema,
  ApiErrorSchema,
  TakedownResponseSchema,
  type AdminTab,
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
  async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
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
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new ApiRequestError(response.status, parsed.success ? parsed.data.error.code : 'unknown', parsed.success ? parsed.data.error.message : `Request failed with status ${response.status}.`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ApiRequestError(response.status, 'invalid_response', 'The server sent a response this page does not understand.');
    return parsed.data;
  }

  return {
    posts: (tab: AdminTab) => request(`/admin/posts?tab=${tab}`, AdminPostListSchema),
    takeDown: (target: TakedownRequest) => request('/admin/takedown', TakedownResponseSchema, target),
    dismiss: (post: PostRef) => request('/admin/dismiss', z.object({ dismissed: z.number() }), post),
    unblock: (post: PostRef) => request('/admin/unblock', z.object({ unblocked: z.boolean() }), post),
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;
