import { z } from 'zod';

export const MeResponseSchema = z.object({
  userId: z.string(),
  /** A guest: an anonymous Supabase user who hasn't added an email yet. */
  isGuest: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** After logging in on a browser that had a guest shelf: the guest's access token proves it owned that shelf. */
export const MergeGuestRequestSchema = z.object({
  guestToken: z.string().min(1).max(4096),
});
export type MergeGuestRequest = z.infer<typeof MergeGuestRequestSchema>;

export const MergeGuestResponseSchema = z.object({
  /** Books new to the account. */
  added: z.number().int(),
  /** Books the account already had, which gained the guest's sources and shelves instead. */
  folded: z.number().int(),
});
export type MergeGuestResponse = z.infer<typeof MergeGuestResponseSchema>;

/** "Download my data", made in the background: the reader polls this until the file is ready. */
export const ExportStatusSchema = z.object({
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  requestedAt: z.string(),
  readyAt: z.string().nullable(),
  /** Asking again before this hands back this same export. */
  nextAt: z.string(),
});
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

/** The reader's recent export, or null when there's none (never asked for, or dropped). */
export const ExportStatusResponseSchema = z.object({ export: ExportStatusSchema.nullable() });
export type ExportStatusResponse = z.infer<typeof ExportStatusResponseSchema>;

/** Today's reading for this user, against their daily cap (resets at midnight UTC). Guests get fewer. */
export const UsageResponseSchema = z.object({
  postsToday: z.number().int(),
  dailyLimit: z.number().int(),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

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
  rateLimited: 'rate_limited',
  notFound: 'not_found',
  internal: 'internal_error',
  notReady: 'not_ready',
  limitReached: 'limit_reached',
  busy: 'busy',
  paused: 'processing_paused',
  reauthRequired: 'reauth_required',
} as const;
