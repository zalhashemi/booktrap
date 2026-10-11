import { describe, expect, it } from 'vitest';
import { LIMITS, bookLimitFor, shelfFullMessage } from './limits';
import { extractSourceLinks, readablePaste } from './links';
import { BookIdsRequestSchema, CreateJobRequestSchema, MergeBooksRequestSchema, TagNameSchema, UpdateBookRequestSchema } from './library';
import { CreateReportRequestSchema, TakedownRequestSchema } from './moderation';

const many = (n: number, make: (i: number) => string = (i) => `id-${i}`) => Array.from({ length: n }, (_, i) => make(i));

describe('limits in the request schemas', () => {
  it('bounds a submission’s entries (the 30 distinct links are counted after duplicates go), each within the link length', () => {
    expect(CreateJobRequestSchema.safeParse({ urls: many(LIMITS.linksPerRequest) }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ urls: many(LIMITS.linksPerRequest + 1) }).success).toBe(false);
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

describe('readablePaste', () => {
  const link = 'https://www.tiktok.com/@a/video/7672440936101727519';

  it('keeps short pastes as they are', () => {
    expect(readablePaste(`see ${link}`)).toBe(`see ${link}`);
  });

  it('never splits a link at the edge, so a shorter id can’t be read', () => {
    const text = `${'x'.repeat(30)} ${link} tail`;
    const cut = readablePaste(text, 50);
    expect(cut).toBe('x'.repeat(30));
    expect(extractSourceLinks(cut)).toEqual([]);
    // A link ending exactly at the limit is kept whole.
    expect(readablePaste(`${link} more`, link.length)).toBe(link);
    expect(readablePaste('x'.repeat(80), 50)).toBe('');
  });
});

describe('shelfFullMessage', () => {
  it('tells guests to save their shelf and members to make room', () => {
    expect(shelfFullMessage(true)).toBe('Your shelf is full (500 books). Save your shelf to keep up to 5,000.');
    expect(shelfFullMessage(false, 1)).toBe('Your shelf is full (5,000 books), so 1 book from this post wasn’t added. Delete some to make room.');
  });
});
