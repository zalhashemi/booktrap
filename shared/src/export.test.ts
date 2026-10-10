import { describe, expect, it } from 'vitest';
import {
  GENERIC_CSV_COLUMNS,
  GOODREADS_COLUMNS,
  authorLastFirst,
  csvCell,
  goodreadsShelfName,
  toExportJson,
  toGenericCsv,
  toGoodreadsCsv,
  toPlainText,
} from './export';
import type { Book } from './library';

const book = (overrides: Partial<Book> = {}): Book => ({
  id: 'b1',
  title: 'The Secret History',
  author: 'Donna Tartt',
  isbn10: '1400031702',
  isbn13: '9781400031702',
  coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg',
  publishedYear: 1992,
  status: 'want_to_read',
  isNew: true,
  notes: null,
  createdAt: '2026-10-09T12:00:00.000Z',
  updatedAt: '2026-10-09T12:00:00.000Z',
  sources: [
    {
      id: 's1',
      platform: 'tiktok',
      postId: '7672440936101727519',
      url: 'https://www.tiktok.com/@wmccusker/video/7672440936101727519',
      creatorHandle: 'wmccusker',
      thumbnailUrl: null,
      evidence: 'cover',
      confidence: 0.4,
      createdAt: '2026-10-09T12:00:00.000Z',
    },
  ],
  tags: [{ id: 't1', name: 'Dark Academia' }],
  ...overrides,
});

/** A small RFC 4180 reader, enough to check what a spreadsheet would see. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += char;
  }
  return rows;
}

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Pride, and Prejudice')).toBe('"Pride, and Prejudice"');
    expect(csvCell('The "Real" One')).toBe('"The ""Real"" One"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(1992)).toBe('1992');
  });

  it('defuses spreadsheet formulas unless told not to', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-1 Below', 'import')).toBe('-1 Below');
    expect(csvCell('=HYPERLINK(1)', 'import')).toBe("'=HYPERLINK(1)");
    expect(csvCell('-cmd|x!A0', 'import')).toBe("'-cmd|x!A0");
  });
});

describe('Goodreads CSV', () => {
  it('writes Goodreads’ export header with a BOM and CRLF lines', () => {
    const csv = toGoodreadsCsv([book()]);
    expect(csv.startsWith('﻿Book Id,Title,Author,Author l-f,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parseCsv(csv)[0]).toEqual([...GOODREADS_COLUMNS]);
  });

  it('maps status to the exclusive shelf and repeats it in Bookshelves with the tags', () => {
    const rows = parseCsv(
      toGoodreadsCsv([
        book(),
        book({ id: 'b2', status: 'reading', tags: [] }),
        book({ id: 'b3', status: 'read', tags: [{ id: 't2', name: 'Café Reads!' }, { id: 't3', name: 'read' }] }),
      ]),
    );
    const col = (name: (typeof GOODREADS_COLUMNS)[number]) => GOODREADS_COLUMNS.indexOf(name);
    expect(rows.slice(1).map((row) => row[col('Exclusive Shelf')])).toEqual(['to-read', 'currently-reading', 'read']);
    expect(rows.slice(1).map((row) => row[col('Bookshelves')])).toEqual(['to-read, dark-academia', 'currently-reading', 'read, cafe-reads']);
    expect(rows[1]![col('Author l-f')]).toBe('Tartt, Donna');
    expect(rows[1]![col('ISBN13')]).toBe('9781400031702');
    expect(rows[1]![col('Date Added')]).toBe('2026/10/09');
    expect(rows[3]![col('Read Count')]).toBe('1');
  });

  it('keeps titles exactly as they are', () => {
    const rows = parseCsv(toGoodreadsCsv([book({ title: '-273.15', author: null, isbn10: null, isbn13: null })]));
    expect(rows[1]![1]).toBe('-273.15');
    expect(rows[1]![2]).toBe('');
  });
});

describe('generic CSV', () => {
  it('has platform-neutral source columns and no confidence or verified flags', () => {
    const rows = parseCsv(toGenericCsv([book()]));
    expect(rows[0]).toEqual([...GENERIC_CSV_COLUMNS]);
    expect(rows[0]!.join()).not.toMatch(/unsure|verified|confidence|evidence/);
    const row = Object.fromEntries(rows[0]!.map((name, i) => [name, rows[1]![i]]));
    expect(row).toMatchObject({ source_platform: 'tiktok', source_post_id: '7672440936101727519', tags: 'Dark Academia', status: 'want_to_read' });
  });

  it('writes one row per source, and one for a book with none', () => {
    const second = { ...book().sources[0]!, id: 's2', platform: 'instagram' as const, postId: 'DeJvdqUjLd1', url: 'https://www.instagram.com/p/DeJvdqUjLd1/' };
    const rows = parseCsv(toGenericCsv([book({ sources: [book().sources[0]!, second] }), book({ id: 'b2', sources: [] })]));
    expect(rows).toHaveLength(4);
    expect(rows[2]![GENERIC_CSV_COLUMNS.indexOf('source_platform')]).toBe('instagram');
    expect(rows[3]![GENERIC_CSV_COLUMNS.indexOf('source_url')]).toBe('');
  });
});

describe('JSON', () => {
  it('nests platform-neutral sources and leaves out confidence and evidence', () => {
    const data = JSON.parse(toExportJson([book()], new Date('2026-10-09T00:00:00Z')));
    expect(data).toMatchObject({ app: 'BookTrap', version: 1, exported_at: '2026-10-09T00:00:00.000Z' });
    expect(data.books[0].sources[0]).toEqual({
      source_platform: 'tiktok',
      source_post_id: '7672440936101727519',
      source_url: 'https://www.tiktok.com/@wmccusker/video/7672440936101727519',
      creator_handle: 'wmccusker',
      created_at: '2026-10-09T12:00:00.000Z',
    });
    expect(JSON.stringify(data)).not.toMatch(/unsure|verified|confidence|evidence/);
  });
});

describe('plain text', () => {
  const books = [book(), book({ id: 'b2', title: 'Piranesi', author: null, status: 'read' })];
  it('writes "Title by Author" per line', () => {
    expect(toPlainText(books, { status: false, numbering: false })).toBe('The Secret History by Donna Tartt\nPiranesi');
  });
  it('adds numbering and status when asked', () => {
    expect(toPlainText(books, { status: true, numbering: true })).toBe('1. The Secret History by Donna Tartt (Want to read)\n2. Piranesi (Read)');
  });
});

describe('helpers', () => {
  it('formats authors last-first and shelf names the Goodreads way', () => {
    expect(authorLastFirst('R. F. Kuang')).toBe('Kuang, R. F.');
    expect(authorLastFirst('Homer')).toBe('Homer');
    expect(authorLastFirst(null)).toBe('');
    expect(authorLastFirst('Ursula K. Le Guin')).toBe('Le Guin, Ursula K.');
    expect(authorLastFirst('Daphne du Maurier')).toBe('du Maurier, Daphne');
    expect(authorLastFirst('Martin Luther King Jr.')).toBe('King, Martin Luther, Jr.');
    expect(goodreadsShelfName('  Summer 2026 — TBR ')).toBe('summer-2026-tbr');
  });
});
