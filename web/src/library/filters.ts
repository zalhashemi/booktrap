import type { Book, BookStatus } from '@booktrap/shared';

export type Flag = 'all' | 'new';
export type SortKey = 'added' | 'title' | 'author';

export interface ShelfQuery {
  search: string;
  flag: Flag;
  status: BookStatus | 'any';
  tagId: string | 'any';
  sort: SortKey;
}

export const DEFAULT_QUERY: ShelfQuery = { search: '', flag: 'all', status: 'any', tagId: 'any', sort: 'added' };

/** Shared with the exports, so the shelf and a plain-text copy always say the same thing. */
export { STATUS_LABELS } from '@booktrap/shared';

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

/** Counts for the shelf's page-tabs: everything, New, and each status. */
export function flagCounts(books: Book[]): Record<ShelfTab, number> {
  const byStatus = (status: BookStatus) => books.filter((book) => book.status === status).length;
  return {
    all: books.length,
    new: books.filter((book) => book.isNew).length,
    want_to_read: byStatus('want_to_read'),
    reading: byStatus('reading'),
    read: byStatus('read'),
  };
}

/** The shelf's page-tabs: one row for New and every status (the contract's signature control). */
export type ShelfTab = Flag | BookStatus;

export function tabQuery(tab: ShelfTab): Pick<ShelfQuery, 'flag' | 'status'> {
  if (tab === 'all' || tab === 'new') return { flag: tab, status: 'any' };
  return { flag: 'all', status: tab };
}

export function activeTab(query: ShelfQuery): ShelfTab | null {
  if (query.flag === 'new') return query.status === 'any' ? 'new' : null;
  return query.status === 'any' ? 'all' : query.status;
}

export function isFiltered(query: ShelfQuery): boolean {
  return query.search.trim() !== '' || query.flag !== 'all' || query.status !== 'any' || query.tagId !== 'any';
}
