import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { DEVICE_ID_HEADER, DEVICE_SECRET_HEADER, ERROR_CODES } from '@booktrap/shared';
import type { Config } from './config';
import { HttpError, errorBody } from './errors';
import type { JobQueue } from './pipeline/queue';
import type { verifyBook } from './pipeline/verify';
import type { DeviceRepo } from './repo/types';
import { jobRoutes } from './routes/jobs';
import { libraryRoutes } from './routes/library';
import type { LibraryStore } from './store/types';
import { deviceRoutes } from './routes/devices';
import { healthRoutes } from './routes/health';

export interface AppDeps {
  config: Config;
  devices: DeviceRepo;
  store: LibraryStore;
  queue: JobQueue;
  /** Test seam for book re-verification. */
  verifyBook?: typeof verifyBook;
}

export async function buildApp({ config, devices, store, queue, verifyBook: verify }: AppDeps) {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      // Belt and braces: the default serializers do not log headers, but never let a secret through.
      redact: [`req.headers["${DEVICE_SECRET_HEADER}"]`, 'req.headers.authorization'],
    },
    // Trust exactly the proxy hops we deploy behind (Render's edge = 1). Trusting "all" would let
    // clients pick their own IP via X-Forwarded-For and walk around every IP rate limit.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, {
    origin: config.ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', DEVICE_ID_HEADER, DEVICE_SECRET_HEADER],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new HttpError(429, ERROR_CODES.rateLimited, `Too many requests. Try again in ${context.after}.`),
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send(errorBody(ERROR_CODES.badRequest, error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody(ERROR_CODES.internal, 'Something went wrong on our side.'));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(errorBody(ERROR_CODES.notFound, 'No such endpoint.')),
  );

  healthRoutes(app, devices);
  deviceRoutes(app, devices, { registrationsPerIpPerHour: config.REGISTRATIONS_PER_IP_PER_HOUR });
  jobRoutes(app, {
    devices,
    store,
    queue,
    options: {
      maxLinksPerSubmission: config.MAX_LINKS_PER_SUBMISSION,
      dailyCapPerDevice: config.DAILY_LINK_CAP_PER_DEVICE,
      dailyCapPerIp: config.DAILY_LINK_CAP_PER_IP,
      monthlyBudgetUsd: config.MONTHLY_BUDGET_USD,
      killSwitch: config.GLOBAL_SPEND_KILL_SWITCH,
      ipHashKey: config.SUPABASE_SERVICE_ROLE_KEY ?? 'booktrap-dev-ip-key',
      pipelineConfigured: Boolean(config.APIFY_TOKEN && config.ANTHROPIC_API_KEY),
    },
  });
  libraryRoutes(app, { devices, store, googleBooksApiKey: config.GOOGLE_BOOKS_API_KEY, verify });

  return app;
}
