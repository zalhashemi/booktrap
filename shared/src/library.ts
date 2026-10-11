import { z } from 'zod';
import { LIMITS } from './limits';
import { BlockedKindSchema } from './moderation';
import { SOURCE_PLATFORMS } from './source';

export const SourcePlatformSchema = z.enum(SOURCE_PLATFORMS);

export const JOB_ITEM_STATUSES = ['queued', 'fetching', 'extracting', 'verifying', 'done', 'failed'] as const;
export const JobItemStatusSchema = z.enum(JOB_ITEM_STATUSES);
export type JobItemStatus = z.infer<typeof JobItemStatusSchema>;

export const JobItemSchema = z.object({
  id: z.string(),
  inputUrl: z.string(),
  platform: SourcePlatformSchema,
  postId: z.string().nullable(),
  kind: z.enum(['video', 'carousel', 'collection', 'collection_child']).nullable(),
  status: JobItemStatusSchema,
  /** Human-readable reason, only when status is "failed". */
  error: z.string().nullable(),
  booksFound: z.number().int(),
  /** Set on the videos a collection link expanded into. */
  parentItemId: z.string().nullable(),
  /** A note for the reader on a finished item, e.g. that only part of a collection was read. */
  note: z.string().nullable(),
  /** Set when the post was skipped and nothing from it was added (moderation or a takedown). */
  // Defaulted: a web build that ships before its API still reads the older API's jobs.
  blocked: BlockedKindSchema.nullable().default(null),
});
export type JobItem = z.infer<typeof JobItemSchema>;

export const JobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  createdAt: z.string(),
  items: z.array(JobItemSchema),
});
export type Job = z.infer<typeof JobSchema>;

export const CreateJobRequestSchema = z.object({
  urls: z.array(z.string().max(LIMITS.linkChars)).min(1).max(LIMITS.linksPerRequest),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobListResponseSchema = z.object({ jobs: z.array(JobSchema) });

export const BOOK_STATUSES = ['want_to_read', 'reading', 'read'] as const;
export const BookStatusSchema = z.enum(BOOK_STATUSES);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const EVIDENCE_KINDS = ['cover', 'spine', 'text_overlay', 'caption', 'spoken', 'other'] as const;
export const EvidenceSchema = z.enum(EVIDENCE_KINDS);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const BookSourceSchema = z.object({
  id: z.string(),
  platform: SourcePlatformSchema,
  postId: z.string(),
  url: z.string(),
  creatorHandle: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  evidence: EvidenceSchema.nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
});
export type BookSource = z.infer<typeof BookSourceSchema>;

export const TagSchema = z.object({ id: z.string(), name: z.string() });
export type Tag = z.infer<typeof TagSchema>;
export const TagListResponseSchema = z.object({ tags: z.array(TagSchema) });
export const TAG_NAME_MAX = LIMITS.shelfNameChars;
export const TagNameSchema = z.string().trim().min(1, 'Give the shelf a name.').max(TAG_NAME_MAX);

export const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  isbn10: z.string().nullable(),
  isbn13: z.string().nullable(),
  coverUrl: z.string().nullable(),
  publishedYear: z.number().int().nullable(),
  status: BookStatusSchema,
  isNew: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sources: z.array(BookSourceSchema),
  tags: z.array(TagSchema),
});
export type Book = z.infer<typeof BookSchema>;

const isbn = (digits: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .refine((value) => value === '' || new RegExp(digits === 10 ? '^[0-9]{9}[0-9X]$' : '^97[89][0-9]{10}$').test(value), {
      message: `ISBN-${digits} should be ${digits} digits.`,
    })
    .transform((value) => (value === '' ? null : value));

/** Everything a reader can change on a book (brief §7 Editing). Omitted fields are left alone. */
export const UpdateBookRequestSchema = z
  .object({
    title: z.string().trim().min(1, 'A book needs a title.').max(LIMITS.titleChars),
    author: z
      .string()
      .trim()
      .max(LIMITS.authorChars)
      .transform((value) => value || null)
      .nullable(),
    isbn10: isbn(10).nullable(),
    isbn13: isbn(13).nullable(),
    status: BookStatusSchema,
    notes: z
      .string()
      .max(LIMITS.notesChars)
      .transform((value) => value.trim() || null)
      .nullable(),
    /** false = seen (opening or editing a book clears its "new" highlight). */
    isNew: z.literal(false),
    tagIds: z.array(z.string()).max(LIMITS.shelvesPerBook),
  })
  .partial();
export type UpdateBookRequest = z.input<typeof UpdateBookRequestSchema>;

export const BookIdsRequestSchema = z.object({ ids: z.array(z.string()).min(1).max(LIMITS.booksPerRequest) });
export const MergeBooksRequestSchema = z.object({ keepId: z.string(), mergeIds: z.array(z.string()).min(1).max(LIMITS.booksPerMerge) });
export const CountResponseSchema = z.object({ count: z.number().int() });

export const BookListResponseSchema = z.object({ books: z.array(BookSchema) });
