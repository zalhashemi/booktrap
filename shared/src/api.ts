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
