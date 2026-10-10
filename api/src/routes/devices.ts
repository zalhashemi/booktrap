import type { FastifyInstance } from 'fastify';
import {
  DeviceCredentialsSchema,
  ERROR_CODES,
  type MeResponse,
  type RegisterDeviceResponse,
} from '@booktrap/shared';
import { requireDevice } from '../auth/device-auth';
import { hashSecret, verifySecret } from '../auth/secret';
import { HttpError } from '../errors';
import type { JobQueue } from '../pipeline/queue';
import type { DeviceRepo } from '../repo/types';
import type { LibraryStore } from '../store/types';

export interface DeviceRouteOptions {
  registrationsPerIpPerHour: number;
  /** For "Delete my shelf": the device's data, and its queued work. */
  store: LibraryStore;
  queue: JobQueue;
}

export function deviceRoutes(app: FastifyInstance, repo: DeviceRepo, options: DeviceRouteOptions) {
  /**
   * Register a device the client generated. Idempotent: re-registering with the same
   * secret succeeds, so the client can retry after a network failure. A different
   * secret for an existing id is refused. That 409 does reveal that an id exists; this is
   * acceptable because ids are random UUID v4s that cannot be guessed.
   */
  app.post(
    '/v1/devices',
    { config: { rateLimit: { max: options.registrationsPerIpPerHour, timeWindow: '1 hour' } } },
    async (request, reply): Promise<RegisterDeviceResponse> => {
      const body = DeviceCredentialsSchema.safeParse(request.body);
      if (!body.success) {
        throw new HttpError(400, ERROR_CODES.badRequest, 'deviceId must be a UUID v4 and deviceSecret a 43-character base64url string.');
      }
      const { deviceId, deviceSecret } = body.data;

      if (await repo.insert(deviceId, hashSecret(deviceSecret))) {
        reply.code(201);
        return { deviceId, created: true };
      }

      const existing = await repo.find(deviceId);
      if (existing && verifySecret(deviceSecret, existing.secretHash)) {
        return { deviceId, created: false };
      }
      throw new HttpError(409, ERROR_CODES.deviceExists, 'This device id is already registered.');
    },
  );

  app.get('/v1/me', { preHandler: requireDevice(repo) }, async (request): Promise<MeResponse> => {
    const device = request.device!;
    return { deviceId: device.id, createdAt: device.createdAt };
  });

  /**
   * "Delete my shelf" (privacy policy: the right to erasure). Removes the device and every book, source,
   * shelf and job it owns. Its credentials and backup code stop working for good: the id can't come back.
   */
  app.delete('/v1/devices/me', { preHandler: requireDevice(repo), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const deviceId = request.device!.id;
    options.queue.forgetDevice(deviceId);
    await options.store.eraseDevice(deviceId);
    await repo.remove(deviceId);
    request.log.info({ deviceId }, 'device deleted by its owner');
    reply.code(204);
  });
}
