import type { Book } from '@booktrap/shared';

/** Bookcloth colours for covers we don't have, picked per title so a shelf of placeholders still varies. */
const CLOTHS = ['bg-burgundy', 'bg-emerald', 'bg-cloth-charcoal', 'bg-cloth-plum'];

export function clothFor(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CLOTHS[hash % CLOTHS.length]!;
}

export interface CoverTab {
  key: string;
  className: string;
  label: string;
}

/** The page-tabs peeking from a cover's top edge: the shelf's signature way of showing state. */
export function coverTabs(book: Book): CoverTab[] {
  const tabs: CoverTab[] = [];
  if (book.isNew) tabs.push({ key: 'new', className: 'bg-lime', label: 'New' });
  if (book.unsure) tabs.push({ key: 'unsure', className: 'bg-rose', label: 'Unsure' });
  if (book.status === 'reading') tabs.push({ key: 'reading', className: 'bg-emerald', label: 'Reading' });
  if (book.status === 'read') tabs.push({ key: 'read', className: 'bg-sage', label: 'Read' });
  return tabs;
}

/** Books whose New highlight has already swept in during this visit (so it plays once, not per render). */
const swept = new Set<string>();

export function claimHighlightSweep(bookId: string): boolean {
  if (swept.has(bookId)) return false;
  swept.add(bookId);
  return true;
}
