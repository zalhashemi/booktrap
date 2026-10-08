import { useState } from 'react';
import { CheckCircle, Question } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';

/** Cover plate at a fixed 2:3 ratio, with a bookcloth placeholder when there is no cover. */
export function CoverPlate({ book, className = '' }: { book: Book; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <div className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-[2px] bg-burgundy shadow-shelf ${className}`}>
      {/* The bookcloth plate is always underneath, so slow or missing covers never leave a blank. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center" aria-hidden="true">
        <span className="h-px w-3/5 bg-gold/70" />
        <span className="foil line-clamp-3 text-[0.55rem] leading-tight tracking-[0.08em]">{book.title}</span>
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
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {book.isNew && (
        // The "New" bookmark ribbon: lime is reserved for this and nothing else.
        <span className="absolute top-0 right-1.5 h-4 w-2.5 bg-lime [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" aria-hidden="true" />
      )}
    </div>
  );
}

export function BookRow({ book }: { book: Book }) {
  const sources = book.sources.length;
  const first = book.sources[0];
  return (
    <li className="flex gap-4 py-4">
      <CoverPlate book={book} className="w-14" />
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-[1.1rem] leading-snug">{book.title}</h3>
        <p className="mt-0.5 text-sm text-text-muted">{book.author ?? 'Author unknown'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8rem]">
          {book.isNew && (
            <span className="rounded-[2px] bg-lime px-1.5 py-0.5 font-semibold tracking-[0.02em] text-on-lime">New</span>
          )}
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
          {first && (
            <a
              href={first.url}
              target="_blank"
              rel="noreferrer"
              className="text-text-faint underline-offset-4 hover:text-text hover:underline"
            >
              {sources === 1 ? `From @${first.creatorHandle ?? 'TikTok'}` : `Seen in ${sources} TikToks`}
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
