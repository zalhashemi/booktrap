import type { FastifyInstance } from 'fastify';
import { ERROR_CODES, type HealthResponse } from '@booktrap/shared';
import { errorBody } from '../errors';
import type { UserDirectory } from '../users/types';

export const API_VERSION = '0.1.0';

export function healthRoutes(app: FastifyInstance, users: UserDirectory) {
  // Liveness: the process is up. Never touches the database.
  app.get('/health', { config: { rateLimit: false } }, async (): Promise<HealthResponse> => ({
    ok: true,
    service: 'booktrap-api',
    version: API_VERSION,
    storage: users.kind,
  }));

  // TEMPORARY (Phase 10): shows the caller their own proxy chain, to set TRUST_PROXY_HOPS correctly. Stores nothing.
  app.get('/health/whoami', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => ({
    ip: request.ip,
    socket: request.socket.remoteAddress,
    xForwardedFor: request.headers['x-forwarded-for'] ?? null,
    cfConnectingIp: request.headers['cf-connecting-ip'] ?? null,
    trueClientIp: request.headers['true-client-ip'] ?? null,
    xRealIp: request.headers['x-real-ip'] ?? null,
  }));

  // Readiness: the database answers. Rate limited, since every call reaches the database.
  app.get('/health/ready', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      await users.ping();
      return { ok: true };
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send(errorBody(ERROR_CODES.notReady, 'Database is unreachable.'));
    }
  });
}
