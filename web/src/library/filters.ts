import type { Book, BookStatus } from '@booktrap/shared';

export type Flag = 'all' | 'new' | 'unsure' | 'verified';
export type SortKey = 'added' | 'title' | 'author';

export interface ShelfQuery {
  search: string;
  flag: Flag;
  status: BookStatus | 'any';
  tagId: string | 'any';
  sort: SortKey;
}

export const DEFAULT_QUERY: ShelfQuery = { search: '', flag: 'all', status: 'any', tagId: 'any', sort: 'added' };

export const STATUS_LABELS: Record<BookStatus, string> = {
  want_to_read: 'Want to read',
  reading: 'Reading',
  read: 'Read',
};

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Sort key for titles: ignore a leading article, as library catalogues do. */
function titleKey(title: string): string {
  return fold(title).replace(/^(the|a|an)\s+/, '');
}

/** Sort key for authors: surname first ("Donna Tartt" sorts under T). Unknown authors go last. */
function authorKey(author: string | null): string {
  if (!author) return '￿';
  const parts = fold(author).trim().split(/\s+/);
  return `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`;
}

export function matchesSearch(book: Book, search: string): boolean {
  const terms = fold(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold([book.title, book.author ?? '', ...book.tags.map((tag) => tag.name)].join(' '));
  return terms.every((term) => haystack.includes(term));
}

export function applyQuery(books: Book[], query: ShelfQuery): Book[] {
  const filtered = books.filter((book) => {
    if (query.flag === 'new' && !book.isNew) return false;
    if (query.flag === 'unsure' && !book.unsure) return false;
    if (query.flag === 'verified' && !book.verified) return false;
    if (query.status !== 'any' && book.status !== query.status) return false;
    if (query.tagId !== 'any' && !book.tags.some((tag) => tag.id === query.tagId)) return false;
    return matchesSearch(book, query.search);
  });

  const compare: Record<SortKey, (a: Book, b: Book) => number> = {
    added: (a, b) => b.createdAt.localeCompare(a.createdAt),
    title: (a, b) => titleKey(a.title).localeCompare(titleKey(b.title)),
    author: (a, b) => authorKey(a.author).localeCompare(authorKey(b.author)) || titleKey(a.title).localeCompare(titleKey(b.title)),
  };
  return filtered.sort(compare[query.sort]);
}

export function flagCounts(books: Book[]) {
  return {
    all: books.length,
    new: books.filter((book) => book.isNew).length,
    unsure: books.filter((book) => book.unsure).length,
    verified: books.filter((book) => book.verified).length,
  };
}

export function isFiltered(query: ShelfQuery): boolean {
  return query.search.trim() !== '' || query.flag !== 'all' || query.status !== 'any' || query.tagId !== 'any';
}
