import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import {
  CreateJobRequestSchema,
  ERROR_CODES,
  LIMITS,
  PRIVATE_COLLECTION_MESSAGE,
  bookLimitFor,
  shelfFullMessage,
  linkKey,
  parseSourceUrl,
  type Job,
  type JobListResponseSchema,
  type UsageResponse,
} from '@booktrap/shared';
import type { z } from 'zod';
import { HttpError } from '../errors';
import { MAX_ATTEMPTS, monthStart, utcDayStart } from '../pipeline/process';
import type { JobQueue, QueueEstimate } from '../pipeline/queue';
import { DailyCapError, type ItemKind, type JobWithItems, type LibraryStore } from '../store/types';

export interface JobRouteOptions {
  dailyCapPerUser: number;
  dailyCapGuest: number;
  dailyCapPerIp: number;
  monthlyBudgetUsd: number;
  killSwitch: boolean;
  /** Keyed hash so raw IPs are never stored. */
  ipHashKey: string;
  pipelineConfigured: boolean;
}

export function toJobResponse(job: JobWithItems, estimates?: Map<string, QueueEstimate>): Job {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    items: job.items.map((item) => ({
      id: item.id,
      inputUrl: item.inputUrl,
      platform: item.platform,
      postId: item.postId,
      kind: item.kind,
      status: item.status,
      error: item.error,
      booksFound: item.booksFound,
      parentItemId: item.parentItemId,
      note: item.note,
      blocked: item.blocked,
      queue: item.status === 'queued' ? (estimates?.get(item.id) ?? null) : null,
    })),
  };
}


const PAUSED_MESSAGE = 'BookTrap has paused reading new links for now. Please try again later.';

export function jobRoutes(
  app: FastifyInstance,
  deps: { auth: preHandlerAsyncHookHandler; store: LibraryStore; queue: JobQueue; options: JobRouteOptions },
) {
  const { store, queue, options } = deps;
  const auth = { preHandler: deps.auth };
  // Guests get a smaller daily cap than signed-in users.
  const capOf = (request: FastifyRequest) => (request.user!.isAnonymous ? options.dailyCapGuest : options.dailyCapPerUser);
  const ipHash = (request: FastifyRequest) => createHmac('sha256', options.ipHashKey).update(request.ip).digest('hex');

  app.post(
    '/v1/jobs',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply): Promise<Job> => {
      const user = request.user!;
      const cap = capOf(request);
      const body = CreateJobRequestSchema.safeParse(request.body);
      if (!body.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Send a list of TikTok or Instagram links.');

      const seen = new Set<string>();
      const links = body.data.urls.map((raw) => ({ raw, link: parseSourceUrl(raw) }));
      const invalid = links.filter((entry) => !entry.link);
      if (invalid.length) {
        throw new HttpError(
          400,
          ERROR_CODES.badRequest,
          `These aren’t TikTok or Instagram links: ${invalid.map((entry) => entry.raw).slice(0, 3).join(', ')}`,
        );
      }
      // Saved Instagram collections can't be opened by anyone but their owner (the web app says so before sending).
      if (links.some((entry) => entry.link!.kind === 'private_collection')) {
        throw new HttpError(400, ERROR_CODES.badRequest, PRIVATE_COLLECTION_MESSAGE);
      }
      const unique = links.flatMap(({ link }) => {
        const key = linkKey(link!);
        if (seen.has(key)) return [];
        seen.add(key);
        return [link!];
      });
      // Distinct links: the same post pasted twice counts once.
      if (unique.length > LIMITS.linksPerPaste) {
        throw new HttpError(400, ERROR_CODES.badRequest, `You can add up to ${LIMITS.linksPerPaste} links at a time.`);
      }

      // A full shelf would pay to read posts whose books can't be added.
      if ((await store.countBooks(user.id)) >= bookLimitFor(user.isAnonymous)) {
        throw new HttpError(409, ERROR_CODES.limitReached, shelfFullMessage(user.isAnonymous));
      }

      if (options.killSwitch || !options.pipelineConfigured) throw new HttpError(503, ERROR_CODES.paused, PAUSED_MESSAGE);
      if ((await store.spendSince(monthStart(new Date()))) >= options.monthlyBudgetUsd) {
        throw new HttpError(503, ERROR_CODES.paused, 'BookTrap has reached its reading budget for this month. Please try again next month.');
      }

      // A collection link isn't a post: its videos count when it expands, against what's left of today.
      // It still needs at least one post of room, or there is nothing it could read.
      const hasCollection = unique.some((link) => link.kind === 'collection');
      const posts = unique.filter((link) => link.kind !== 'collection').length + (hasCollection ? 1 : 0);

      // An Instagram /p/ post may be a photo, a carousel or a video: its kind is known after fetching.
      const kindOf = (kind: string): ItemKind | null => (kind === 'video' ? 'video' : kind === 'photo' ? 'carousel' : kind === 'collection' ? 'collection' : null);
      let job: JobWithItems;
      try {
        // Counted and inserted atomically, so parallel submissions can't each slip under a cap.
        job = await store.createJob(
          user.id,
          ipHash(request),
          unique.map((link) => ({ inputUrl: link.url, platform: link.platform, postId: link.postId, kind: kindOf(link.kind) })),
          { posts, perUser: cap, perIp: options.dailyCapPerIp, since: utcDayStart() },
        );
      } catch (error) {
        if (!(error instanceof DailyCapError)) throw error;
        if (error.scope === 'ip') {
          throw new HttpError(429, ERROR_CODES.limitReached, 'This network has reached today’s limit. It resets at midnight UTC.');
        }
        const left = Math.max(0, cap - error.used);
        // A guest's way past the cap is saving the shelf: signed-in readers get more posts a day.
        const more = user.isAnonymous ? ` Save your shelf to read up to ${options.dailyCapPerUser} a day.` : '';
        throw new HttpError(
          429,
          ERROR_CODES.limitReached,
          left === 0
            ? `You’ve reached today’s limit of ${cap} posts. It resets at midnight UTC.${more}`
            : `You can add ${left} more ${left === 1 ? 'post' : 'posts'} today (limit ${cap}). It resets at midnight UTC.${more}`,
        );
      }
      for (const item of job.items) queue.enqueue(item.id, user.id);
      reply.code(201);
      return toJobResponse(job, queue.estimates());
    },
  );

  /** How much of today's cap this user has used (shown in Settings). */
  app.get('/v1/usage', auth, async (request): Promise<UsageResponse> => {
    const postsToday = await store.countItemsSince({ userId: request.user!.id }, utcDayStart());
    return { postsToday, dailyLimit: capOf(request) };
  });

  app.get('/v1/jobs', auth, async (request): Promise<z.infer<typeof JobListResponseSchema>> => {
    const jobs = await store.listJobs(request.user!.id, 5);
    const estimates = queue.estimates();
    return { jobs: jobs.map((job) => toJobResponse(job, estimates)) };
  });

  app.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId', auth, async (request): Promise<Job> => {
    const job = await store.getJob(request.user!.id, request.params.jobId).catch(() => null);
    if (!job) throw new HttpError(404, ERROR_CODES.notFound, 'No such job.');
    return toJobResponse(job, queue.estimates());
  });

  app.post<{ Params: { jobId: string; itemId: string } }>(
    '/v1/jobs/:jobId/items/:itemId/retry',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request): Promise<Job> => {
      const user = request.user!;
      const job = await store.getJob(user.id, request.params.jobId).catch(() => null);
      const item = job?.items.find((candidate) => candidate.id === request.params.itemId);
      if (!job || !item) throw new HttpError(404, ERROR_CODES.notFound, 'No such link.');
      if (item.status !== 'failed') throw new HttpError(409, ERROR_CODES.badRequest, 'Only failed links can be retried.');
      if (options.killSwitch || !options.pipelineConfigured) throw new HttpError(503, ERROR_CODES.paused, PAUSED_MESSAGE);
      const fresh = await store.getItem(item.id);
      if ((fresh?.attempts ?? 0) >= MAX_ATTEMPTS) {
        throw new HttpError(409, ERROR_CODES.limitReached, `BookTrap has already tried this link ${MAX_ATTEMPTS} times.`);
      }
      // Retries can pay for scraping again, so a reader at their daily cap can't retry either.
      const since = utcDayStart();
      const [userCount, ipCount] = await Promise.all([
        store.countItemsSince({ userId: user.id }, since),
        store.countItemsSince({ ipHash: ipHash(request) }, since),
      ]);
      if (userCount >= capOf(request) || ipCount >= options.dailyCapPerIp) {
        throw new HttpError(429, ERROR_CODES.limitReached, 'You’ve reached today’s limit. Retries reset at midnight UTC.');
      }

      await store.updateItem(item.id, { status: 'queued', error: null });
      await store.refreshJobStatus(job.id);
      queue.enqueue(item.id, user.id);
      return toJobResponse((await store.getJob(user.id, job.id))!, queue.estimates());
    },
  );

}
