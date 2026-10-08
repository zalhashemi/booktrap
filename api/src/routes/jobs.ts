import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CreateJobRequestSchema,
  ERROR_CODES,
  parseTikTokUrl,
  type BookListResponseSchema,
  type Job,
  type JobListResponseSchema,
} from '@booktrap/shared';
import type { z } from 'zod';
import { requireDevice } from '../auth/device-auth';
import { HttpError } from '../errors';
import { MAX_ATTEMPTS, monthStart } from '../pipeline/process';
import type { JobQueue } from '../pipeline/queue';
import type { DeviceRepo } from '../repo/types';
import type { ItemKind, JobWithItems, LibraryStore } from '../store/types';

export interface JobRouteOptions {
  maxLinksPerSubmission: number;
  dailyCapPerDevice: number;
  dailyCapPerIp: number;
  monthlyBudgetUsd: number;
  killSwitch: boolean;
  /** Keyed hash so raw IPs are never stored. */
  ipHashKey: string;
  pipelineConfigured: boolean;
}

export function toJobResponse(job: JobWithItems): Job {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    items: job.items.map((item) => ({
      id: item.id,
      inputUrl: item.inputUrl,
      postId: item.postId,
      kind: item.kind,
      status: item.status,
      error: item.error,
      booksFound: item.booksFound,
    })),
  };
}

function utcDayStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const PAUSED_MESSAGE = 'BookTrap has paused reading new links for now. Please try again later.';

export function jobRoutes(
  app: FastifyInstance,
  deps: { devices: DeviceRepo; store: LibraryStore; queue: JobQueue; options: JobRouteOptions },
) {
  const { store, queue, options } = deps;
  const auth = { preHandler: requireDevice(deps.devices) };
  const ipHash = (request: FastifyRequest) => createHmac('sha256', options.ipHashKey).update(request.ip).digest('hex');

  app.post(
    '/v1/jobs',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply): Promise<Job> => {
      const device = request.device!;
      const body = CreateJobRequestSchema.safeParse(request.body);
      if (!body.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Send a list of TikTok links.');

      const seen = new Set<string>();
      const links = body.data.urls.map((raw) => ({ raw, link: parseTikTokUrl(raw) }));
      const invalid = links.filter((entry) => !entry.link);
      if (invalid.length) {
        throw new HttpError(400, ERROR_CODES.badRequest, `These aren’t TikTok links: ${invalid.map((entry) => entry.raw).slice(0, 3).join(', ')}`);
      }
      const unique = links.flatMap(({ link }) => {
        const key = link!.postId ?? link!.url;
        if (seen.has(key)) return [];
        seen.add(key);
        return [link!];
      });
      if (unique.length > options.maxLinksPerSubmission) {
        throw new HttpError(400, ERROR_CODES.badRequest, `You can add up to ${options.maxLinksPerSubmission} links at a time.`);
      }

      if (options.killSwitch || !options.pipelineConfigured) throw new HttpError(503, ERROR_CODES.paused, PAUSED_MESSAGE);
      if ((await store.spendSince(monthStart(new Date()))) >= options.monthlyBudgetUsd) {
        throw new HttpError(503, ERROR_CODES.paused, 'BookTrap has reached its reading budget for this month. Please try again next month.');
      }

      const since = utcDayStart();
      const hash = ipHash(request);
      const [deviceCount, ipCount] = await Promise.all([
        store.countItemsSince({ deviceId: device.id }, since),
        store.countItemsSince({ ipHash: hash }, since),
      ]);
      if (deviceCount + unique.length > options.dailyCapPerDevice) {
        const left = Math.max(0, options.dailyCapPerDevice - deviceCount);
        throw new HttpError(
          429,
          ERROR_CODES.limitReached,
          left === 0
            ? `You’ve reached today’s limit of ${options.dailyCapPerDevice} posts. It resets at midnight UTC.`
            : `You can add ${left} more ${left === 1 ? 'post' : 'posts'} today (limit ${options.dailyCapPerDevice}). It resets at midnight UTC.`,
        );
      }
      if (ipCount + unique.length > options.dailyCapPerIp) {
        throw new HttpError(429, ERROR_CODES.limitReached, 'This network has reached today’s limit. It resets at midnight UTC.');
      }

      const kindOf = (kind: string): ItemKind | null => (kind === 'video' ? 'video' : kind === 'photo' ? 'carousel' : kind === 'collection' ? 'collection' : null);
      const job = await store.createJob(
        device.id,
        hash,
        unique.map((link) => ({ inputUrl: link.url, postId: link.postId, kind: kindOf(link.kind) })),
      );
      for (const item of job.items) queue.enqueue(item.id, device.id);
      reply.code(201);
      return toJobResponse(job);
    },
  );

  app.get('/v1/jobs', auth, async (request): Promise<z.infer<typeof JobListResponseSchema>> => {
    const jobs = await store.listJobs(request.device!.id, 5);
    return { jobs: jobs.map(toJobResponse) };
  });

  app.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId', auth, async (request): Promise<Job> => {
    const job = await store.getJob(request.device!.id, request.params.jobId).catch(() => null);
    if (!job) throw new HttpError(404, ERROR_CODES.notFound, 'No such job.');
    return toJobResponse(job);
  });

  app.post<{ Params: { jobId: string; itemId: string } }>(
    '/v1/jobs/:jobId/items/:itemId/retry',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request): Promise<Job> => {
      const device = request.device!;
      const job = await store.getJob(device.id, request.params.jobId).catch(() => null);
      const item = job?.items.find((candidate) => candidate.id === request.params.itemId);
      if (!job || !item) throw new HttpError(404, ERROR_CODES.notFound, 'No such link.');
      if (item.status !== 'failed') throw new HttpError(409, ERROR_CODES.badRequest, 'Only failed links can be retried.');
      if (options.killSwitch || !options.pipelineConfigured) throw new HttpError(503, ERROR_CODES.paused, PAUSED_MESSAGE);
      const fresh = await store.getItem(item.id);
      if ((fresh?.attempts ?? 0) >= MAX_ATTEMPTS) {
        throw new HttpError(409, ERROR_CODES.limitReached, `BookTrap has already tried this link ${MAX_ATTEMPTS} times.`);
      }
      // Retries can pay for scraping again, so a device at its daily cap can't retry either.
      const since = utcDayStart();
      const [deviceCount, ipCount] = await Promise.all([
        store.countItemsSince({ deviceId: device.id }, since),
        store.countItemsSince({ ipHash: ipHash(request) }, since),
      ]);
      if (deviceCount >= options.dailyCapPerDevice || ipCount >= options.dailyCapPerIp) {
        throw new HttpError(429, ERROR_CODES.limitReached, 'You’ve reached today’s limit. Retries reset at midnight UTC.');
      }

      await store.updateItem(item.id, { status: 'queued', error: null });
      await store.refreshJobStatus(job.id);
      queue.enqueue(item.id, device.id);
      return toJobResponse((await store.getJob(device.id, job.id))!);
    },
  );

  app.get('/v1/books', auth, async (request): Promise<z.infer<typeof BookListResponseSchema>> => {
    return { books: await store.listBooks(request.device!.id) };
  });
}
