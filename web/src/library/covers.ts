import type { Book } from '@booktrap/shared';

/** Bookcloth colours for covers we don't have, picked per title so a shelf of placeholders still varies. */
const CLOTHS = ['bg-cloth-1', 'bg-cloth-2', 'bg-cloth-3', 'bg-cloth-4'];

/** A small, stable string hash: the same text always picks the same cloth, binding or cache key. */
export function hashString(text: string, seed = 0, multiplier = 31): number {
  let hash = seed;
  for (const char of text) hash = (hash * multiplier + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** Which of the four bookcloths a title gets; the PDF uses the same pick so a book keeps its colour. */
export function clothIndex(title: string): number {
  return hashString(title) % CLOTHS.length;
}

/** Which binding a placeholder gets (rules, head-and-tail bands, or a label panel), so a run of them varies. */
export function bindingFor(title: string): 0 | 1 | 2 {
  // A different seed and multiplier from the cloth, so binding and colour vary independently.
  return (hashString(title, 7, 17) % 3) as 0 | 1 | 2;
}

export function clothFor(title: string): string {
  return CLOTHS[clothIndex(title)]!;
}

export interface CoverTab {
  key: 'new' | 'reading' | 'read';
  className: string;
  label: string;
}

/** The page-tabs peeking from a cover's top edge: the shelf's signature way of showing state. */
export function coverTabs(book: Book): CoverTab[] {
  const tabs: CoverTab[] = [];
  if (book.isNew) tabs.push({ key: 'new', className: 'bg-lime', label: 'New' });
  if (book.status === 'reading') tabs.push({ key: 'reading', className: 'bg-reading', label: 'Reading' });
  if (book.status === 'read') tabs.push({ key: 'read', className: 'bg-read', label: 'Read' });
  return tabs;
}

/** Books whose New highlight has already swept in during this visit (so it plays once, not per render). */
const swept = new Set<string>();

export function claimHighlightSweep(bookId: string): boolean {
  if (swept.has(bookId)) return false;
  swept.add(bookId);
  return true;
}
