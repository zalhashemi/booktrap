import { z } from 'zod';

/** 32 random bytes, base64url without padding. */
export const DEVICE_SECRET_BYTES = 32;
export const DEVICE_SECRET_LENGTH = 43;

export const DeviceIdSchema = z.uuid({ version: 'v4' });
export const DeviceSecretSchema = z
  .string()
  .length(DEVICE_SECRET_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, 'Secret must be base64url');

export const DeviceCredentialsSchema = z.object({
  deviceId: DeviceIdSchema,
  deviceSecret: DeviceSecretSchema,
});
export type DeviceCredentials = z.infer<typeof DeviceCredentialsSchema>;

export const DEVICE_ID_HEADER = 'x-device-id';
export const DEVICE_SECRET_HEADER = 'x-device-secret';
