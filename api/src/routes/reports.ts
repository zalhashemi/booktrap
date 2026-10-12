import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import {
  ADMIN_TABS,
  CreateReportRequestSchema,
  ERROR_CODES,
  LIMITS,
  PostRefSchema,
  STATS_RANGES,
  TakedownRequestSchema,
  type AdminPostList,
  type AdminStats,
  type AdminTab,
  type PostReach,
  type TakedownResponse,
} from '@booktrap/shared';
import { HttpError } from '../errors';
import { NotAPostError, listAdminPosts, postFromUrl, takeDown } from '../moderation';
import { buildAdminStats } from '../stats';
import { utcDayStart } from '../pipeline/process';
import type { resolveLink } from '../pipeline/resolve';
import type { LibraryStore } from '../store/types';

/** "Report this post": readers report posts that are sources on their own shelf. */
export function reportRoutes(app: FastifyInstance, deps: { auth: preHandlerAsyncHookHandler; store: LibraryStore }) {
  const { store } = deps;
  app.post(
    '/v1/reports',
    { preHandler: deps.auth, config: { rateLimit: { max: LIMITS.reportsPerDay, timeWindow: '1 hour' } } },
    async (request, reply): Promise<{ reported: true }> => {
      const parsed = CreateReportRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, parsed.error.issues[0]?.message ?? 'Choose what’s wrong with the post.');
      const userId = request.user!.id;
      const { platform, postId, reason, note } = parsed.data;

      if ((await store.countReportsSince(userId, utcDayStart())) >= LIMITS.reportsPerDay) {
        throw new HttpError(429, ERROR_CODES.limitReached, `You can send up to ${LIMITS.reportsPerDay} reports a day. Thank you for all of them.`);
      }
      // Only posts on the reader's own shelf: nobody can flood the queue with arbitrary links.
      const source = await store.findOwnSource(userId, platform, postId);
      if (!source) throw new HttpError(404, ERROR_CODES.notFound, 'That post isn’t on your shelf any more.');

      const created = await store.createReport(userId, { platform, postId, url: source.url, creatorHandle: source.creatorHandle, reason, note });
      if (created) request.log.info({ platform, reason }, 'post reported');
      reply.code(created ? 201 : 200);
      return { reported: true };
    },
  );
}

/** Sha-256 both sides, so comparing takes the same time whatever the lengths. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * The hidden admin page's API. Exists only when ADMIN_TOKEN is set, and takes that token as a bearer
 * token (not a Supabase session). Every failure is the same 401.
 */
export function adminRoutes(
  app: FastifyInstance,
  deps: { store: LibraryStore; adminToken: string; monthlyBudgetUsd: number; resolve?: typeof resolveLink },
) {
  const { store, adminToken } = deps;
  const requireAdmin = async (request: FastifyRequest) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token || !sameSecret(token, adminToken)) throw new HttpError(401, ERROR_CODES.unauthorized, 'That admin key isn’t right.');
  };
  const options = { preHandler: requireAdmin, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  const postRef = (body: unknown) => {
    const parsed = PostRefSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Say which post: platform and postId.');
    return parsed.data;
  };

  /** Checks the admin key, nothing else (the page's key screen). */
  app.get('/admin/check', options, async (_request, reply) => {
    reply.code(204);
  });

  /** How far one post reached, for its detail: what a takedown would remove. */
  app.get<{ Querystring: { platform?: string; postId?: string } }>('/admin/reach', options, async (request): Promise<PostReach> => {
    const { platform, postId } = postRef(request.query);
    return store.postReach(platform, postId);
  });

  app.get<{ Querystring: { tab?: string } }>('/admin/posts', options, async (request): Promise<AdminPostList> => {
    const tab = (ADMIN_TABS as readonly string[]).includes(request.query.tab ?? '') ? (request.query.tab as AdminTab) : 'open';
    return listAdminPosts(store, tab);
  });

  // The Stats view: counts and totals for a range, in the operator's time zone (the browser's).
  app.get('/admin/stats', options, async (request): Promise<AdminStats> => {
    const query = request.query as { range?: string; tz?: string };
    const range = STATS_RANGES.find((value) => value === query.range);
    if (!range) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose 7 days, 30 days or this month.');
    const timeZone = query.tz && isTimeZone(query.tz) ? query.tz : 'UTC';
    return buildAdminStats(await store.adminStats(range, timeZone), range, deps.monthlyBudgetUsd);
  });

  app.post('/admin/takedown', options, async (request): Promise<TakedownResponse> => {
    const parsed = TakedownRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Paste the post’s link.');
    let result: TakedownResponse;
    if ('url' in parsed.data) {
      let post;
      try {
        post = await postFromUrl(parsed.data.url, deps.resolve);
      } catch (error) {
        if (error instanceof NotAPostError) throw new HttpError(400, ERROR_CODES.badRequest, error.message);
        throw new HttpError(502, ERROR_CODES.badRequest, 'Couldn’t follow that share link. Paste the post’s full link instead.');
      }
      result = await takeDown(store, post, 'request');
    } else {
      result = await takeDown(store, parsed.data, 'admin');
    }
    request.log.info(result, 'post taken down');
    return result;
  });

  app.post('/admin/dismiss', options, async (request): Promise<{ dismissed: number }> => {
    const { platform, postId } = postRef(request.body);
    return { dismissed: await store.dismissReports(platform, postId) };
  });

  app.post('/admin/unblock', options, async (request): Promise<{ unblocked: boolean }> => {
    const { platform, postId } = postRef(request.body);
    const unblocked = await store.unblockPost(platform, postId);
    if (unblocked) request.log.info({ platform, postId }, 'post unblocked');
    return { unblocked };
  });
}

/** An IANA zone both Node and Postgres know (letters, digits, "/", "_", "-", "+"), e.g. Asia/Bahrain. */
function isTimeZone(value: string): boolean {
  if (value.length > 64 || !/^[A-Za-z][A-Za-z0-9/_+-]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
