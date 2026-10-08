import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  DEVICE_ID_HEADER,
  DEVICE_SECRET_HEADER,
  DeviceIdSchema,
  DeviceSecretSchema,
  ERROR_CODES,
} from '@booktrap/shared';
import { HttpError } from '../errors';
import type { DeviceRepo } from '../repo/types';
import { verifySecret } from './secret';

/** last_seen_at is written at most this often per device. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** Compared against when the id is unknown, to keep both failure paths the same cost. */
const UNKNOWN_DEVICE_HASH = '0'.repeat(64);

export interface AuthedDevice {
  id: string;
  createdAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: AuthedDevice;
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * preHandler that authorizes a request by device id + secret and attaches the device.
 * Every failure gives the same 401, and an unknown id still pays for one hash comparison,
 * so the response does not reveal whether the id or the secret was wrong.
 */
export function requireDevice(repo: DeviceRepo, now: () => Date = () => new Date()) {
  return async function deviceAuth(request: FastifyRequest, _reply: FastifyReply) {
    const unauthorized = new HttpError(401, ERROR_CODES.unauthorized, 'Device credentials are missing or invalid.');

    const id = DeviceIdSchema.safeParse(header(request, DEVICE_ID_HEADER));
    const secret = DeviceSecretSchema.safeParse(header(request, DEVICE_SECRET_HEADER));
    if (!id.success || !secret.success) throw unauthorized;

    const device = await repo.find(id.data);
    const matches = verifySecret(secret.data, device?.secretHash ?? UNKNOWN_DEVICE_HASH);
    if (!device || !matches) throw unauthorized;

    request.device = { id: device.id, createdAt: device.createdAt };

    const current = now();
    if (current.getTime() - new Date(device.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
      repo.touch(device.id, current).catch((error: unknown) => {
        request.log.warn({ err: error, deviceId: device.id }, 'failed to update last_seen_at');
      });
    }
  };
}
