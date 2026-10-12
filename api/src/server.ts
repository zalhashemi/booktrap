import { constants as zlib } from 'node:zlib';
import Fastify, { type FastifyError } from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ERROR_CODES, LIMITS } from '@booktrap/shared';
import { createRevocations } from './auth/revocations';
import { requireUser, type SessionVerifier } from './auth/session-auth';
import type { Config } from './config';
import { HttpError, errorBody } from './errors';
import type { JobQueue } from './pipeline/queue';
import type { verifyBook } from './pipeline/verify';
import { jobRoutes } from './routes/jobs';
import { libraryRoutes } from './routes/library';
import { adminRoutes, reportRoutes } from './routes/reports';
import type { LibraryStore } from './store/types';
import { accountRoutes } from './routes/account';
import { healthRoutes } from './routes/health';
import type { UserDirectory } from './users/types';

export interface AppDeps {
  config: Config;
  /** Checks Supabase access tokens (the project's JWKS in production, local keys in tests). */
  verifySession: SessionVerifier;
  users: UserDirectory;
  store: LibraryStore;
  queue: JobQueue;
  /** Test seam for book re-verification. */
  verifyBook?: typeof verifyBook;
  /** Test seam for outbound fetches made by routes (book covers). */
  fetchImpl?: typeof fetch;
}

export async function buildApp({ config, verifySession, users, store, queue, verifyBook: verify, fetchImpl }: AppDeps) {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      // Belt and braces: the default serializers do not log headers, but never let a token through.
      redact: ['req.headers.authorization'],
      // Request lines carry the method and path only: no client IP in the logs (privacy policy).
      serializers: { req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url }) },
    },
    // Trust exactly the proxy hops we deploy behind (Render's edge = 1). Trusting "all" would let
    // clients pick their own IP via X-Forwarded-For and walk around every IP rate limit.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: LIMITS.requestBodyBytes,
  });

  await app.register(cors, {
    origin: config.ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  });

  // Phase 9: a 1,000-book shelf is 1.1 MB of JSON. Brotli at quality 4 shrinks it about 10x for a few ms of
  // CPU (the default, 11, costs far more on half a CPU). Images (covers) aren't compressible and pass through.
  await app.register(compress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new HttpError(429, ERROR_CODES.rateLimited, `Too many requests. Try again in ${context.after}.`),
  });

  // Shelves and job state are private to a user: no cache keeps them (routes that may be cached, like
  // covers, set their own). nosniff stops a passed-through cover from ever being read as anything but an image.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
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

  const revocations = createRevocations();
  const auth = requireUser(verifySession, { revocations, onSeen: (userId, at) => users.touch(userId, at) });

  healthRoutes(app, users);
  accountRoutes(app, { auth, verify: verifySession, store, users, queue, revocations });
  jobRoutes(app, {
    auth,
    store,
    queue,
    options: {
      dailyCapPerUser: config.DAILY_LINK_CAP_PER_USER,
      dailyCapGuest: config.DAILY_LINK_CAP_GUEST,
      dailyCapPerIp: config.DAILY_LINK_CAP_PER_IP,
      monthlyBudgetUsd: config.MONTHLY_BUDGET_USD,
      killSwitch: config.GLOBAL_SPEND_KILL_SWITCH,
      ipHashKey: config.ipHashKey,
      pipelineConfigured: config.LOAD_TEST || Boolean(config.APIFY_TOKEN && config.ANTHROPIC_API_KEY),
    },
  });
  libraryRoutes(app, { auth, store, googleBooksApiKey: config.GOOGLE_BOOKS_API_KEY, verify, fetchImpl });
  reportRoutes(app, { auth, store });
  if (config.ADMIN_TOKEN) adminRoutes(app, { store, adminToken: config.ADMIN_TOKEN });

  return app;
}
