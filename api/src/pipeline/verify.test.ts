import { describe, expect, it, vi } from 'vitest';
import { scoreCandidate, verifyBook, type Candidate } from './verify';

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  title: 'The Secret History',
  subtitle: null,
  authors: ['Donna Tartt'],
  isbn10: null,
  isbn13: '9781400031702',
  coverUrl: null,
  publishedYear: 1992,
  ...overrides,
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('scoreCandidate', () => {
  it('accepts a misread title with the right author', () => {
    expect(scoreCandidate('The Secret Histroy', 'Donna Tartt', candidate({})).accept).toBe(true);
  });

  it('rejects the right title by the wrong author', () => {
    expect(scoreCandidate('Sunburn', 'Chloe Michelle Howarth', candidate({ title: 'Sunburn', authors: ['Laura Lippman'] })).accept).toBe(false);
  });

  it('needs a near-exact title when no author was read', () => {
    expect(scoreCandidate('The Secret History', null, candidate({})).accept).toBe(true);
    expect(scoreCandidate('Secret Hist', null, candidate({})).accept).toBe(false);
  });

  it('matches titles that only agree once the subtitle is included', () => {
    expect(
      scoreCandidate('Babel An Arcane History', 'R.F. Kuang', candidate({ title: 'Babel', subtitle: 'An Arcane History', authors: ['R. F. Kuang'] })).accept,
    ).toBe(true);
  });
});

describe('verifyBook', () => {
  it('uses Google Books when it has a good match', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            volumeInfo: {
              title: "Giovanni's Room",
              authors: ['James Baldwin'],
              publishedDate: '2013-05-14',
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780345806567' },
                { type: 'ISBN_10', identifier: '0345806565' },
              ],
              imageLinks: { thumbnail: 'http://books.google.com/books/content?id=x&zoom=1&edge=curl' },
            },
          },
        ],
      }),
    );
    const result = await verifyBook('Giovanni’s Room', 'James Baldwin', { fetch: fetchImpl, googleBooksApiKey: 'k' });
    expect(result).toMatchObject({ verified: true, isbn13: '9780345806567', publishedYear: 2013 });
    expect(result.coverUrl).toBe('https://books.google.com/books/content?id=x&zoom=1');
    expect(fetchImpl.mock.calls[0]![0]).toContain('key=k');
  });

  it('falls back to Open Library when Google has nothing good', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ docs: [{ title: 'Almost Life', author_name: ['Kiran Millwood Hargrave'], isbn: ['9781529434071'], cover_i: 42 }] }),
      );
    const result = await verifyBook('Almost Life', 'Kiran Millwood Hargrave', { fetch: fetchImpl });
    expect(result).toMatchObject({ verified: true, isbn13: '9781529434071', coverUrl: 'https://covers.openlibrary.org/b/id/42-L.jpg' });
  });

  it('prefers English-language ISBNs from Open Library’s edition list', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ docs: [{ title: "Giovanni's Room", author_name: ['James Baldwin'], isbn: ['9785875320040', '9780345806567'] }] }),
      );
    const result = await verifyBook('Giovanni’s Room', 'James Baldwin', { fetch: fetchImpl });
    expect(result.isbn13).toBe('9780345806567');
  });

  it('adds the book unverified when both services fail, instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'quota' }, 429));
    const result = await verifyBook('Some Unknown Zine', null, { fetch: fetchImpl });
    expect(result).toMatchObject({ verified: false, title: 'Some Unknown Zine', isbn13: null });
  });
});
