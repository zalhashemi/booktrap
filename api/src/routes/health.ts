import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@booktrap/shared';
import { errorBody } from '../errors';
import type { UserDirectory } from '../users/types';

export const API_VERSION = '0.1.0';

export function healthRoutes(app: FastifyInstance, users: UserDirectory) {
  // Liveness: the process is up. Never touches the database.
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    ok: true,
    service: 'booktrap-api',
    version: API_VERSION,
    storage: users.kind,
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
