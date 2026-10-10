import type { FastifyInstance } from 'fastify';
import { ERROR_CODES, type HealthResponse } from '@booktrap/shared';
import { errorBody } from '../errors';
import type { DeviceRepo } from '../repo/types';

export const API_VERSION = '0.1.0';

export function healthRoutes(app: FastifyInstance, repo: DeviceRepo) {
  // Liveness: the process is up. Never touches the database.
  app.get('/health', { config: { rateLimit: false } }, async (): Promise<HealthResponse> => ({
    ok: true,
    service: 'booktrap-api',
    version: API_VERSION,
    storage: repo.kind,
  }));

  // Readiness: the database answers. Rate limited, since every call reaches the database.
  app.get('/health/ready', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      await repo.ping();
      return { ok: true };
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send(errorBody(ERROR_CODES.notReady, 'Database is unreachable.'));
    }
  });
}
