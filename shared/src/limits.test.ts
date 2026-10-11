import { describe, expect, it } from 'vitest';
import { LIMITS, bookLimitFor } from './limits';
import { BookIdsRequestSchema, CreateJobRequestSchema, MergeBooksRequestSchema, TagNameSchema, UpdateBookRequestSchema } from './library';
import { CreateReportRequestSchema, TakedownRequestSchema } from './moderation';

const many = (n: number, make: (i: number) => string = (i) => `id-${i}`) => Array.from({ length: n }, (_, i) => make(i));

describe('limits in the request schemas', () => {
  it('takes up to the links-per-paste limit, each within the link length', () => {
    expect(CreateJobRequestSchema.safeParse({ urls: many(LIMITS.linksPerPaste) }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ urls: many(LIMITS.linksPerPaste + 1) }).success).toBe(false);
    expect(CreateJobRequestSchema.safeParse({ urls: ['x'.repeat(LIMITS.linkChars + 1)] }).success).toBe(false);
  });

  it('bounds book edits: title, author, notes and shelves per book', () => {
    const ok = UpdateBookRequestSchema.safeParse({ title: 't'.repeat(LIMITS.titleChars), author: 'a'.repeat(LIMITS.authorChars), notes: 'n'.repeat(LIMITS.notesChars), tagIds: many(LIMITS.shelvesPerBook) });
    expect(ok.success).toBe(true);
    for (const patch of [
      { title: 't'.repeat(LIMITS.titleChars + 1) },
      { author: 'a'.repeat(LIMITS.authorChars + 1) },
      { notes: 'n'.repeat(LIMITS.notesChars + 1) },
      { tagIds: many(LIMITS.shelvesPerBook + 1) },
    ]) {
      expect(UpdateBookRequestSchema.safeParse(patch).success).toBe(false);
    }
  });

  it('bounds shelf names and how many books one request acts on', () => {
    expect(TagNameSchema.safeParse('s'.repeat(LIMITS.shelfNameChars)).success).toBe(true);
    expect(TagNameSchema.safeParse('s'.repeat(LIMITS.shelfNameChars + 1)).success).toBe(false);
    expect(BookIdsRequestSchema.safeParse({ ids: many(LIMITS.booksPerRequest + 1) }).success).toBe(false);
    expect(MergeBooksRequestSchema.safeParse({ keepId: 'k', mergeIds: many(LIMITS.booksPerMerge + 1) }).success).toBe(false);
  });

  it('gives guests the smaller book limit', () => {
    expect(bookLimitFor(true)).toBe(500);
    expect(bookLimitFor(false)).toBe(5000);
  });
});

describe('report requests', () => {
  const base = { platform: 'tiktok', postId: '7672440936101727519' };

  it('needs a reason, and a note for Other', () => {
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'explicit' }).data).toEqual({ ...base, reason: 'explicit', note: null });
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'other' }).success).toBe(false);
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'other', note: '  ' }).success).toBe(false);
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'other', note: ' spam ' }).data?.note).toBe('spam');
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'nope' }).success).toBe(false);
  });

  it('bounds the note', () => {
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'mine', note: 'n'.repeat(LIMITS.reportNoteChars) }).success).toBe(true);
    expect(CreateReportRequestSchema.safeParse({ ...base, reason: 'mine', note: 'n'.repeat(LIMITS.reportNoteChars + 1) }).success).toBe(false);
  });

  it('takes a takedown by link or by post', () => {
    expect(TakedownRequestSchema.safeParse({ url: 'https://www.tiktok.com/@a/video/1' }).success).toBe(true);
    expect(TakedownRequestSchema.safeParse(base).success).toBe(true);
    expect(TakedownRequestSchema.safeParse({}).success).toBe(false);
  });
});
