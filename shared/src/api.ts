import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal('booktrap-api'),
  version: z.string(),
  storage: z.enum(['supabase', 'memory']),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const RegisterDeviceResponseSchema = z.object({
  deviceId: z.string(),
  created: z.boolean(),
});
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponseSchema>;

export const MeResponseSchema = z.object({
  deviceId: z.string(),
  createdAt: z.string(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Every non-2xx response from the API uses this shape. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ERROR_CODES = {
  badRequest: 'bad_request',
  unauthorized: 'unauthorized',
  deviceExists: 'device_exists',
  rateLimited: 'rate_limited',
  notFound: 'not_found',
  internal: 'internal_error',
  notReady: 'not_ready',
  limitReached: 'limit_reached',
  paused: 'processing_paused',
} as const;
