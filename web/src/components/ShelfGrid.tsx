import type { Book } from '@booktrap/shared';
import { coverTabs } from '../library/covers';
import { STATUS_LABELS } from '../library/filters';
import { BookTitle, CoverPlate, SelectMark } from './BookRow';

interface Props {
  books: Book[];
  onOpen: (book: Book) => void;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (book: Book) => void;
}

/**
 * The shelf: covers registered at one 2:3 size on a shared baseline, each carrying its state as
 * page-tabs peeking from the top edge. Columns auto-fill at a minimum cover width.
 */
export function ShelfGrid({ books, onOpen, selecting, selected, onToggle }: Props) {
  return (
    <ul aria-label="Books on your shelf" className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-x-4 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(132px,1fr))] sm:gap-x-6">
      {books.map((book) => {
        const isSelected = selected.has(book.id);
        const flags = coverTabs(book);
        const states = flags.map((tab) => tab.label);
        return (
          <li key={book.id} className="min-w-0">
            <button
              type="button"
              onClick={() => (selecting ? onToggle(book) : onOpen(book))}
              aria-pressed={selecting ? isSelected : undefined}
              aria-label={`${selecting ? (isSelected ? 'Deselect' : 'Select') : 'Open'} ${book.title}${book.author ? ` by ${book.author}` : ''}${
                states.length ? ` (${states.join(', ')})` : ''
              }`}
              className="group block w-full rounded-[10px] pt-2 text-left"
            >
              <span className="relative block transition-transform duration-300 ease-snappy group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5 group-active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none">
                <CoverPlate book={book} flags={flags} className={`w-full transition-opacity duration-200 ${selecting && !isSelected ? 'opacity-55' : ''}`} />
                {selecting && (
                  <span className="absolute top-2 left-2">
                    <SelectMark selected={isSelected} />
                  </span>
                )}
              </span>
              <BookTitle book={book} className="mt-3 line-clamp-2 block font-display text-[0.92rem] leading-snug" />
              <span className="mt-1 block truncate text-[0.8rem] text-text-muted">{book.author ?? 'Author unknown'}</span>
              {book.status !== 'want_to_read' && (
                <span className="mt-1 block text-[0.75rem] font-bold text-tag-ink">{STATUS_LABELS[book.status]}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
