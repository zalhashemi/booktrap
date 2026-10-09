import { describe, expect, it } from 'vitest';
import type { Book } from '@booktrap/shared';
import { DEFAULT_QUERY, applyQuery, flagCounts } from './filters';

let n = 0;
const book = (overrides: Partial<Book>): Book => ({
  id: `b${n++}`,
  title: 'Untitled',
  author: null,
  isbn10: null,
  isbn13: null,
  coverUrl: null,
  publishedYear: null,
  status: 'want_to_read',
  isNew: false,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  sources: [],
  tags: [],
  ...overrides,
});

const books = [
  book({ title: 'The Secret History', author: 'Donna Tartt', createdAt: '2026-10-03T00:00:00Z', isNew: true }),
  book({ title: 'Babel', author: 'R. F. Kuang', createdAt: '2026-10-02T00:00:00Z', tags: [{ id: 't1', name: 'Dark academia' }] }),
  book({ title: 'A Separate Peace', author: 'John Knowles', createdAt: '2026-10-01T00:00:00Z', status: 'read' }),
  book({ title: 'Les Misérables', author: null, createdAt: '2026-09-30T00:00:00Z' }),
];

const titles = (list: Book[]) => list.map((b) => b.title);

describe('applyQuery', () => {
  it('sorts newest first by default', () => {
    expect(titles(applyQuery([...books], DEFAULT_QUERY))[0]).toBe('The Secret History');
  });

  it('sorts titles ignoring leading articles', () => {
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, sort: 'title' }))).toEqual([
      'Babel',
      'Les Misérables',
      'The Secret History',
      'A Separate Peace',
    ]);
  });

  it('sorts by author surname, unknown authors last', () => {
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, sort: 'author' }))).toEqual([
      'A Separate Peace',
      'Babel',
      'The Secret History',
      'Les Misérables',
    ]);
  });

  it('searches title, author and tags, ignoring accents and case', () => {
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, search: 'miserables' }))).toEqual(['Les Misérables']);
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, search: 'tartt' }))).toEqual(['The Secret History']);
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, search: 'dark acad' }))).toEqual(['Babel']);
  });

  it('combines flag, status and tag filters', () => {
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, flag: 'all', status: 'read' }))).toEqual(['A Separate Peace']);
    expect(titles(applyQuery([...books], { ...DEFAULT_QUERY, tagId: 't1' }))).toEqual(['Babel']);
    expect(applyQuery([...books], { ...DEFAULT_QUERY, flag: 'new', status: 'read' })).toEqual([]);
  });
});

describe('flagCounts', () => {
  it('counts each flag', () => {
    expect(flagCounts(books)).toEqual({ all: 4, new: 1 });
  });
});
