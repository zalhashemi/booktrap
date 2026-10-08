import { useEffect, useRef, useState } from 'react';
import type { Book } from '@booktrap/shared';
import { CoverPlate, SelectMark } from './BookRow';

/** Narrowest a cover plate may get; columns are as many whole cells as fit. */
const MIN_CELL = { phone: 96, wide: 128 };
const GAP = 16;

function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry!.contentRect.width;
      const min = width >= 640 ? MIN_CELL.wide : MIN_CELL.phone;
      setColumns(Math.max(2, Math.floor((width + GAP) / (min + GAP))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, columns };
}

interface Props {
  books: Book[];
  onOpen: (book: Book) => void;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (book: Book) => void;
}

/**
 * The signature view: covers registered at one 2:3 size, standing on gold-ruled shelf planks,
 * with their titles below the plank like shelf labels. Rows reflow by whole cells.
 */
export function ShelfGrid({ books, onOpen, selecting, selected, onToggle }: Props) {
  const { ref, columns } = useColumns();
  const rows: Book[][] = [];
  for (let i = 0; i < books.length; i += columns) rows.push(books.slice(i, i + columns));
  const template = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP };

  return (
    <div ref={ref} className="mt-8 space-y-10">
      {rows.map((row, rowIndex) => (
        <div key={row[0]!.id} className="relative">
          <ul className="grid items-end px-1" style={template} aria-label={`Shelf ${rowIndex + 1}`}>
            {row.map((book) => {
              const isSelected = selected.has(book.id);
              return (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => (selecting ? onToggle(book) : onOpen(book))}
                    aria-pressed={selecting ? isSelected : undefined}
                    aria-label={`${selecting ? (isSelected ? 'Deselect' : 'Select') : 'Open'} ${book.title}${book.author ? ` by ${book.author}` : ''}`}
                    className="group relative block w-full rounded-[2px] transition-transform duration-300 ease-out-expo hover:-translate-y-1.5 focus-visible:-translate-y-1.5 motion-reduce:hover:translate-y-0"
                  >
                    <CoverPlate book={book} className={`w-full transition-opacity ${selecting && !isSelected ? 'opacity-60' : ''}`} />
                    {selecting && (
                      <span className="absolute top-1.5 left-1.5">
                        <SelectMark selected={isSelected} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* The shelf plank the covers stand on. */}
          <div className="h-[5px] rounded-[1px] bg-gold shadow-shelf" aria-hidden="true" />
          <div className="mt-2.5 grid px-1" style={template} aria-hidden="true">
            {row.map((book) => (
              <div key={book.id} className="min-w-0">
                <p className="line-clamp-2 font-serif text-[0.85rem] leading-snug">{book.title}</p>
                <p className="mt-0.5 truncate text-[0.75rem] text-text-muted">{book.author ?? 'Author unknown'}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
