import { z } from 'zod';

export const JOB_ITEM_STATUSES = ['queued', 'fetching', 'extracting', 'verifying', 'done', 'failed'] as const;
export const JobItemStatusSchema = z.enum(JOB_ITEM_STATUSES);
export type JobItemStatus = z.infer<typeof JobItemStatusSchema>;

export const JobItemSchema = z.object({
  id: z.string(),
  inputUrl: z.string(),
  postId: z.string().nullable(),
  kind: z.enum(['video', 'carousel', 'collection', 'collection_child']).nullable(),
  status: JobItemStatusSchema,
  /** Human-readable reason, only when status is "failed". */
  error: z.string().nullable(),
  booksFound: z.number().int(),
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
  urls: z.array(z.string().max(2048)).min(1).max(200),
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
  postId: z.string(),
  url: z.string(),
  creatorHandle: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  evidence: EvidenceSchema.nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
});
export type BookSource = z.infer<typeof BookSourceSchema>;

export const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  isbn10: z.string().nullable(),
  isbn13: z.string().nullable(),
  coverUrl: z.string().nullable(),
  publishedYear: z.number().int().nullable(),
  status: BookStatusSchema,
  verified: z.boolean(),
  unsure: z.boolean(),
  isNew: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sources: z.array(BookSourceSchema),
});
export type Book = z.infer<typeof BookSchema>;

export const BookListResponseSchema = z.object({ books: z.array(BookSchema) });
