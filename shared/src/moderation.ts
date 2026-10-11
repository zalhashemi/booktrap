import { z } from 'zod';
import { LIMITS } from './limits';
import { SOURCE_PLATFORMS } from './source';

/**
 * Why a post was skipped (nothing from it is added). explicit and graphic come from the extraction's
 * content check, refused when Claude declined to read the post, removed after a takedown.
 */
export const BLOCKED_KINDS = ['explicit', 'graphic', 'refused', 'removed'] as const;
export const BlockedKindSchema = z.enum(BLOCKED_KINDS);
export type BlockedKind = z.infer<typeof BlockedKindSchema>;

export const BLOCKED_MESSAGES: Record<BlockedKind, string> = {
  explicit: 'This post shows explicit content, not books, so nothing was added.',
  graphic: 'This post shows graphic violence, not books, so nothing was added.',
  refused: 'BookTrap’s reader declined this post, so nothing was added.',
  removed: 'This post was removed from BookTrap after a report, so nothing was added.',
};

export const REPORT_REASONS = ['explicit', 'graphic', 'hateful', 'mine', 'other'] as const;
export const ReportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const REPORT_REASON_LABELS: Record<ReportReason, { label: string; hint: string }> = {
  explicit: { label: 'Sexual or explicit', hint: 'Nudity or sexual content that isn’t a book cover.' },
  graphic: { label: 'Violent or graphic', hint: 'Gore, injury or cruelty.' },
  hateful: { label: 'Hateful or harassing', hint: 'Attacks a person or a group.' },
  mine: { label: 'It’s my post', hint: 'You made it and want it out of BookTrap.' },
  other: { label: 'Other', hint: 'Tell us what’s wrong in the note.' },
};

const PlatformSchema = z.enum(SOURCE_PLATFORMS);

/** "Report this post" from a book's sources. "Other" needs a note saying what's wrong. */
export const CreateReportRequestSchema = z
  .object({
    platform: PlatformSchema,
    postId: z.string().min(1).max(200),
    reason: ReportReasonSchema,
    note: z
      .string()
      .max(LIMITS.reportNoteChars)
      .transform((value) => value.trim() || null)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
  })
  .refine((report) => report.reason !== 'other' || report.note, { message: 'Tell us what’s wrong with it.', path: ['note'] });
export type CreateReportRequest = z.input<typeof CreateReportRequestSchema>;

// Admin -------------------------------------------------------------------------------

export const ADMIN_TABS = ['open', 'blocked', 'removed', 'dismissed'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const PostReachSchema = z.object({
  /** Readers with the post as a source on a live or deleted book. */
  shelves: z.number().int(),
  /** Books with no other source, which a takedown deletes unless the reader changed them. */
  onlyHere: z.number().int(),
  /** Of those, books the reader changed (status, notes or shelves), which a takedown keeps. */
  edited: z.number().int(),
});
export type PostReach = z.infer<typeof PostReachSchema>;

/** Reports grouped by post, or a blocked or removed post: one row of the admin page. */
export const AdminPostSchema = z.object({
  platform: PlatformSchema,
  postId: z.string(),
  url: z.string().nullable(),
  creatorHandle: z.string().nullable(),
  reports: z.array(
    z.object({ id: z.string(), reason: ReportReasonSchema, note: z.string().nullable(), createdAt: z.string() }),
  ),
  /** Why it's blocked (the Auto-blocked tab) or what removed it (the Taken down tab). */
  blocked: BlockedKindSchema.nullable(),
  /** When it was reported first, blocked, or taken down. */
  since: z.string(),
  last: z.string(),
  reach: PostReachSchema.nullable(),
});
export type AdminPost = z.infer<typeof AdminPostSchema>;

export const AdminPostListSchema = z.object({
  posts: z.array(AdminPostSchema),
  counts: z.object({ open: z.number().int(), blocked: z.number().int(), removed: z.number().int(), dismissed: z.number().int() }),
});
export type AdminPostList = z.infer<typeof AdminPostListSchema>;

/** Take down a post by its link (a removal request by email) or by platform and id (from a report). */
export const TakedownRequestSchema = z.union([
  z.object({ url: z.string().min(1).max(LIMITS.linkChars) }),
  z.object({ platform: PlatformSchema, postId: z.string().min(1).max(200) }),
]);
export type TakedownRequest = z.infer<typeof TakedownRequestSchema>;

export const PostRefSchema = z.object({ platform: PlatformSchema, postId: z.string().min(1).max(200) });
export type PostRef = z.infer<typeof PostRefSchema>;

export const TakedownResponseSchema = z.object({
  platform: PlatformSchema,
  postId: z.string(),
  sourcesRemoved: z.number().int(),
  booksDeleted: z.number().int(),
  booksKept: z.number().int(),
});
export type TakedownResponse = z.infer<typeof TakedownResponseSchema>;
