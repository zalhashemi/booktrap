import { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';
import { sourceSummary } from '../library/links';
import { claimHighlightSweep, clothFor, coverTabs, type CoverTab } from '../library/covers';
import { STATUS_LABELS } from '../library/filters';

/** Cover at a fixed 2:3 ratio, with a bookcloth placeholder when there is no cover. */
export function CoverPlate({
  book,
  className = '',
  tabs = true,
  flags: givenFlags,
}: {
  book: Book;
  className?: string;
  tabs?: boolean;
  /** Precomputed tabs, when the caller already has them. */
  flags?: CoverTab[];
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const flags = tabs ? (givenFlags ?? coverTabs(book)) : [];
  return (
    <div className={`relative shrink-0 ${className}`}>
      {flags.length > 0 && (
        <div className="absolute -top-2.5 right-2 left-2 flex justify-end gap-1" aria-hidden="true">
          {flags.map((flag) => (
            <span key={flag.key} className={`h-5 w-[20%] max-w-6 min-w-3 rounded-t-[5px] shadow-[0_-1px_0_rgb(255_255_255/0.15)_inset] ${flag.className}`} />
          ))}
        </div>
      )}
      <div className={`relative aspect-[2/3] overflow-hidden rounded-cover shadow-soft ${clothFor(book.title)}`}>
        {/* The bookcloth plate is always underneath, so slow or missing covers never leave a blank. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-1.5 text-center" aria-hidden="true">
          <span className="h-px w-1/2 bg-accent/70" />
          <span className="line-clamp-4 font-display text-[0.62rem] leading-tight text-on-cloth">{book.title}</span>
          <span className="h-px w-1/2 bg-accent/70" />
        </div>
        {book.coverUrl && state !== 'failed' && (
          <img
            src={book.coverUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              // Some catalogues answer with a 1x1 "no cover" pixel instead of a 404.
              setState(event.currentTarget.naturalWidth > 10 ? 'loaded' : 'failed');
            }}
            onError={() => setState('failed')}
            // Shown the moment it has loaded: no fade, so a paused animation clock can never hide a cover.
            className={`absolute inset-0 h-full w-full object-cover ${state === 'loaded' ? 'visible' : 'invisible'}`}
          />
        )}
        {/* A soft page-edge sheen on the spine side makes covers read as books, not tiles. */}
        <span className="pointer-events-none absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/25 to-transparent" aria-hidden="true" />
      </div>
    </div>
  );
}

/** The selection tick drawn over a cover or beside a row in select mode. */
export function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-7 items-center justify-center rounded-pill border-2 transition-[background-color,border-color,transform] duration-200 ease-snappy ${
        selected ? 'scale-100 border-accent bg-accent text-on-tab' : 'scale-90 border-text-muted bg-ground/70 text-transparent'
      }`}
    >
      <Check size={15} weight="bold" />
    </span>
  );
}

export function BookFlags({ book }: { book: Book }) {
  return (
    <>
      {book.isNew && <span className="rounded-pill bg-lime px-2 py-0.5 text-[0.78rem] font-extrabold text-on-lime">New</span>}
    </>
  );
}

/** The book's title, with the lime highlighter stroke while it is new. */
export function BookTitle({ book, className = '' }: { book: Book; className?: string }) {
  // The sweep is claimed on first render only, so filtering or switching views never replays it.
  const [sweep] = useState(() => book.isNew && claimHighlightSweep(book.id));
  return (
    <span className={className}>
      <span className={book.isNew ? `highlight-new${sweep ? ' highlight-sweep' : ''}` : undefined}>{book.title}</span>
    </span>
  );
}

interface RowProps {
  book: Book;
  onOpen: (book: Book) => void;
  selecting: boolean;
  selected: boolean;
  onToggle: (book: Book) => void;
}

export function BookRow({ book, onOpen, selecting, selected, onToggle }: RowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => (selecting ? onToggle(book) : onOpen(book))}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `${selected ? 'Deselect' : 'Select'} ${book.title}` : undefined}
        className={`group flex w-full items-center gap-4 rounded-[18px] p-3 text-left transition-[background-color,transform] duration-200 ease-snappy active:scale-[0.99] ${
          selected ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent)]' : 'hover:bg-surface'
        }`}
      >
        {selecting && <SelectMark selected={selected} />}
        <CoverPlate book={book} className="w-16" />
        <span className="min-w-0 flex-1">
          <BookTitle book={book} className="block font-display text-[1.12rem] leading-snug" />
          <span className="mt-0.5 block text-sm text-text-muted">{book.author ?? 'Author unknown'}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <BookFlags book={book} />
            {book.status !== 'want_to_read' && (
              <span className={`rounded-pill px-2 py-0.5 text-[0.78rem] font-bold ${book.status === 'reading' ? 'bg-reading text-on-tab' : 'bg-read text-on-tab'}`}>
                {STATUS_LABELS[book.status]}
              </span>
            )}
            {book.tags.map((tag) => (
              <span key={tag.id} className="text-[0.8rem] font-bold text-tag-ink">
                #{tag.name}
              </span>
            ))}
            {book.sources.length > 0 && <span className="text-[0.8rem] text-text-faint">{sourceSummary(book.sources)}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
