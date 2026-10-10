/**
 * Export formats (brief §8). Pure functions so the web app and tests share one definition of
 * every column. Nothing here reports confidence, evidence or a verified flag (change request 001).
 */

import type { Book, BookStatus } from './library';

/**
 * The header of Goodreads' own library export (24 columns), which its importer
 * (goodreads.com/review/import) reads back. Fable's beta import expects the same file.
 */
export const GOODREADS_COLUMNS = [
  'Book Id',
  'Title',
  'Author',
  'Author l-f',
  'Additional Authors',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Average Rating',
  'Publisher',
  'Binding',
  'Number of Pages',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Bookshelves',
  'Bookshelves with positions',
  'Exclusive Shelf',
  'My Review',
  'Spoiler',
  'Private Notes',
  'Read Count',
  'Owned Copies',
] as const;

export const GOODREADS_SHELVES: Record<BookStatus, string> = {
  want_to_read: 'to-read',
  reading: 'currently-reading',
  read: 'read',
};

export const STATUS_LABELS: Record<BookStatus, string> = {
  want_to_read: 'Want to read',
  reading: 'Reading',
  read: 'Read',
};

export const GENERIC_CSV_COLUMNS = [
  'id',
  'title',
  'author',
  'isbn10',
  'isbn13',
  'published_year',
  'status',
  'is_new',
  'tags',
  'notes',
  'cover_url',
  'created_at',
  'updated_at',
  'source_platform',
  'source_post_id',
  'source_url',
  'source_creator',
  'source_added_at',
] as const;

type Cell = string | number | boolean | null | undefined;

/**
 * How a CSV defuses text a spreadsheet would run as a formula:
 * - 'strict' (generic CSV): a cell starting with = + - @ (or a tab/CR) gets a leading apostrophe.
 * - 'import' (Goodreads CSV, read by an importer, where the apostrophe would land in the title):
 *   = + @ and tab/CR always; a leading "-" only when the cell looks like a formula.
 */
export type FormulaGuard = 'strict' | 'import';

/** One CSV cell (RFC 4180), with spreadsheet formulas defused. */
export function csvCell(value: Cell, guard: FormulaGuard = 'strict'): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && needsGuard(text, guard)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function needsGuard(text: string, guard: FormulaGuard): boolean {
  if (/^[=+@\t\r]/.test(text)) return true;
  if (!text.startsWith('-')) return false;
  return guard === 'strict' || /[|!(=]/.test(text);
}

/** CRLF rows with a UTF-8 byte-order mark, so Excel opens accented titles correctly. */
function toCsv(header: readonly string[], rows: Cell[][], guard: FormulaGuard): string {
  const line = (cells: readonly Cell[]) => cells.map((cell) => csvCell(cell, guard)).join(',');
  return '﻿' + [header, ...rows].map(line).join('\r\n') + '\r\n';
}

/** Lowercase words that belong to the surname ("du Maurier", "van Gogh"), plus "Le" before a surname. */
const SURNAME_PARTICLES = new Set(['da', 'de', 'del', 'della', 'der', 'di', 'du', 'la', 'le', 'van', 'von', 'den', 'ter', 'st.', 'bin', 'ibn', 'al']);
const NAME_SUFFIXES = /^(jr\.?|sr\.?|ii|iii|iv)$/i;

/**
 * "Donna Tartt" → "Tartt, Donna", as Goodreads writes it. Particles stay with the surname
 * ("Le Guin, Ursula K.") and suffixes go last ("King, Martin Luther, Jr.").
 */
export function authorLastFirst(author: string | null): string {
  const parts = (author ?? '').trim().split(/\s+/).filter(Boolean);
  const suffix = parts.length > 2 && NAME_SUFFIXES.test(parts.at(-1)!.replace(/,$/, '')) ? parts.pop()!.replace(/,$/, '') : null;
  if (parts.length > 0) parts[parts.length - 1] = parts.at(-1)!.replace(/,$/, '');
  if (parts.length < 2) return [parts.join(' '), suffix].filter(Boolean).join(', ');
  let start = parts.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(parts[start - 1]!.toLowerCase())) start--;
  const surname = parts.slice(start).join(' ');
  const given = parts.slice(0, start).join(' ');
  return [surname, given, suffix].filter(Boolean).join(', ');
}

/** Goodreads shelf names are lowercase letters, digits, hyphens and underscores. */
export function goodreadsShelfName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/** "2026-10-09T…" → "2026/10/09", the date format of Goodreads' export. */
function goodreadsDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/');
}

export function toGoodreadsCsv(books: Book[]): string {
  const rows = books.map((book) => {
    const exclusive = GOODREADS_SHELVES[book.status];
    // The exclusive shelf is repeated in Bookshelves: an import with Exclusive Shelf alone has been
    // reported to shelve everything as "read".
    const shelves = [exclusive, ...book.tags.map((tag) => goodreadsShelfName(tag.name))].filter(Boolean);
    const unique = [...new Set(shelves)];
    const values: Record<(typeof GOODREADS_COLUMNS)[number], Cell> = {
      'Book Id': null,
      Title: book.title,
      Author: book.author,
      'Author l-f': authorLastFirst(book.author),
      'Additional Authors': null,
      ISBN: book.isbn10,
      ISBN13: book.isbn13,
      'My Rating': 0,
      'Average Rating': null,
      Publisher: null,
      Binding: null,
      'Number of Pages': null,
      'Year Published': book.publishedYear,
      'Original Publication Year': book.publishedYear,
      'Date Read': null,
      'Date Added': goodreadsDate(book.createdAt),
      Bookshelves: unique.join(', '),
      'Bookshelves with positions': null,
      'Exclusive Shelf': exclusive,
      'My Review': null,
      Spoiler: null,
      'Private Notes': book.notes,
      'Read Count': book.status === 'read' ? 1 : 0,
      'Owned Copies': 0,
    };
    return GOODREADS_COLUMNS.map((column) => values[column]);
  });
  return toCsv(GOODREADS_COLUMNS, rows, 'import');
}

/** One row per book and source, so nothing is lost; a book with no source still gets a row. */
export function toGenericCsv(books: Book[]): string {
  const rows: Cell[][] = [];
  for (const book of books) {
    const base: Cell[] = [
      book.id,
      book.title,
      book.author,
      book.isbn10,
      book.isbn13,
      book.publishedYear,
      book.status,
      book.isNew,
      book.tags.map((tag) => tag.name).join('; '),
      book.notes,
      book.coverUrl,
      book.createdAt,
      book.updatedAt,
    ];
    const sources = book.sources.length > 0 ? book.sources : [null];
    for (const source of sources) {
      rows.push([...base, source?.platform, source?.postId, source?.url, source?.creatorHandle, source?.createdAt]);
    }
  }
  return toCsv(GENERIC_CSV_COLUMNS, rows, 'strict');
}

export function toExportJson(books: Book[], exportedAt: Date = new Date()): string {
  const data = {
    app: 'BookTrap',
    version: 1,
    exported_at: exportedAt.toISOString(),
    books: books.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      isbn10: book.isbn10,
      isbn13: book.isbn13,
      published_year: book.publishedYear,
      status: book.status,
      is_new: book.isNew,
      tags: book.tags.map((tag) => tag.name),
      notes: book.notes,
      cover_url: book.coverUrl,
      created_at: book.createdAt,
      updated_at: book.updatedAt,
      sources: book.sources.map((source) => ({
        source_platform: source.platform,
        source_post_id: source.postId,
        source_url: source.url,
        creator_handle: source.creatorHandle,
        created_at: source.createdAt,
      })),
    })),
  };
  return JSON.stringify(data, null, 2) + '\n';
}

export interface PlainTextOptions {
  status: boolean;
  numbering: boolean;
}

/** "Title by Author" per line, optionally numbered and with the reading status. */
export function toPlainText(books: Book[], options: PlainTextOptions): string {
  return books
    .map((book, index) => {
      let line = book.author ? `${book.title} by ${book.author}` : book.title;
      if (options.status) line += ` (${STATUS_LABELS[book.status]})`;
      return options.numbering ? `${index + 1}. ${line}` : line;
    })
    .join('\n');
}
