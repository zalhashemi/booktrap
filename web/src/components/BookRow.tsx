import { useState } from 'react';
import { Check, CheckCircle, Question } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';
import { STATUS_LABELS } from '../library/filters';

/** Cover plate at a fixed 2:3 ratio, with a bookcloth placeholder when there is no cover. */
export function CoverPlate({ book, className = '' }: { book: Book; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <div className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-[2px] bg-burgundy shadow-shelf ${className}`}>
      {/* The bookcloth plate is always underneath, so slow or missing covers never leave a blank. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center" aria-hidden="true">
        <span className="h-px w-3/5 bg-gold/70" />
        <span className="foil line-clamp-4 text-[0.55rem] leading-tight tracking-[0.08em]">{book.title}</span>
        <span className="h-px w-3/5 bg-gold/70" />
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
      {book.isNew && (
        // The "New" bookmark ribbon: lime is reserved for this and nothing else.
        <span className="absolute top-0 right-1.5 h-[22%] max-h-6 w-[14%] max-w-3 min-w-2 bg-lime [clip-path:polygon(0_0,100%_0,100%_100%,50%_78%,0_100%)]" aria-hidden="true" />
      )}
      {book.unsure && (
        <span className="absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-full bg-ground/85 text-rose-ink" aria-hidden="true">
          <Question size={13} weight="bold" />
        </span>
      )}
    </div>
  );
}

/** The selection tick drawn over a cover or beside a row in select mode. */
export function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 items-center justify-center rounded-[3px] border transition-colors duration-150 ${
        selected ? 'border-gold bg-gold text-ground' : 'border-text-faint bg-ground/80 text-transparent'
      }`}
    >
      <Check size={14} weight="bold" />
    </span>
  );
}

export function BookFlags({ book }: { book: Book }) {
  return (
    <>
      {book.isNew && <span className="rounded-[2px] bg-lime px-1.5 py-0.5 font-semibold tracking-[0.02em] text-on-lime">New</span>}
      {book.unsure ? (
        <span className="inline-flex items-center gap-1 text-rose-ink">
          <Question size={14} weight="bold" aria-hidden="true" />
          Unsure
        </span>
      ) : book.verified ? (
        <span className="inline-flex items-center gap-1 text-emerald-ink">
          <CheckCircle size={14} weight="bold" aria-hidden="true" />
          Verified
        </span>
      ) : null}
    </>
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
  const sources = book.sources.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => (selecting ? onToggle(book) : onOpen(book))}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `${selected ? 'Deselect' : 'Select'} ${book.title}` : undefined}
        className={`group flex w-full gap-4 rounded-board py-4 text-left transition-colors duration-150 ${
          selected ? 'bg-surface' : 'hover:bg-ground-raised'
        } focus-visible:outline-offset-0`}
      >
        {selecting && (
          <span className="flex items-center pl-1">
            <SelectMark selected={selected} />
          </span>
        )}
        <CoverPlate book={book} className="w-14" />
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[1.1rem] leading-snug group-hover:text-gold-ink">{book.title}</span>
          <span className="mt-0.5 block text-sm text-text-muted">{book.author ?? 'Author unknown'}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8rem]">
            <BookFlags book={book} />
            {book.status !== 'want_to_read' && <span className="text-text">{STATUS_LABELS[book.status]}</span>}
            {book.tags.map((tag) => (
              <span key={tag.id} className="text-sage">
                {tag.name}
              </span>
            ))}
            <span className="text-text-faint">{sources === 1 ? `From @${book.sources[0]?.creatorHandle ?? 'TikTok'}` : `Seen in ${sources} TikToks`}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
