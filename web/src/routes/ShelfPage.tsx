import type { CSSProperties } from 'react';
import { BookRow } from '../components/BookRow';
import { ButtonLink } from '../components/Button';
import { useBooks } from '../library/hooks';

/** Ghost spines for the empty shelf: height (% of shelf), width (px) and an optional lean. */
const GHOST_SPINES: { h: number; w: number; lean?: number }[] = [
  { h: 78, w: 26 },
  { h: 92, w: 34 },
  { h: 70, w: 22 },
  { h: 86, w: 30 },
  { h: 96, w: 38 },
  { h: 74, w: 24 },
  { h: 88, w: 30, lean: 9 },
];

export function ShelfPage() {
  const books = useBooks();
  const list = books.data ?? [];
  const newCount = list.filter((book) => book.isNew).length;

  return (
    <div>
      <div className="flex max-w-[720px] flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-display text-[2.15rem] leading-[1.08] tracking-[-0.01em] md:text-[2.9rem]">Your shelf</h1>
        {list.length > 0 && (
          <p className="text-sm text-text-muted">
            {list.length} {list.length === 1 ? 'book' : 'books'}
            {newCount > 0 && <span className="text-text"> · {newCount} new</span>}
          </p>
        )}
      </div>

      {books.isPending ? (
        <p className="mt-10 text-text-muted">Taking books off the shelf…</p>
      ) : books.isError ? (
        <div role="alert" className="mt-10 max-w-[34rem]">
          <p className="text-rose-ink">Your shelf couldn’t be loaded just now. Your books are safe.</p>
          <button type="button" onClick={() => void books.refetch()} className="mt-3 min-h-11 text-sm underline underline-offset-4">
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <>
          <EmptyShelf />
          <div className="mt-8 max-w-[34rem]">
            <h2 className="font-serif text-[1.3rem]">Nothing shelved yet</h2>
            <p className="mt-2 text-text-muted">
              Every book BookTrap finds in your TikToks stands here as a spine. The newest arrivals wear a ribbon so
              you can spot them.
            </p>
            <ButtonLink to="/" className="mt-6">
              Paste links
            </ButtonLink>
          </div>
        </>
      ) : (
        <ul className="mt-8 max-w-[720px] divide-y divide-rule">
          {list.map((book) => (
            <BookRow key={book.id} book={book} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyShelf() {
  return (
    <div className="mt-10 max-w-[560px]" aria-hidden="true">
      <div className="flex h-44 items-end gap-[6px] px-3 md:h-52">
        <Bookend />
        {GHOST_SPINES.map((spine, index) => (
          <div
            key={index}
            className="ghost-spine relative rounded-t-[2px] border border-b-0 border-dashed border-rule-gold"
            style={
              {
                height: `${spine.h}%`,
                width: spine.w,
                '--i': index,
                '--lean': `${spine.lean ?? 0}deg`,
              } as CSSProperties
            }
          >
            <span className="absolute inset-x-[5px] top-[14%] h-px bg-rule-gold" />
            <span className="absolute inset-x-[5px] bottom-[12%] h-px bg-rule-gold" />
          </div>
        ))}
        <div className="flex-1" />
        <Bookend flip />
      </div>
      <div className="h-[5px] rounded-[1px] bg-gold shadow-shelf" />
    </div>
  );
}

function Bookend({ flip = false }: { flip?: boolean }) {
  return (
    <div className={`flex h-[46%] items-end ${flip ? 'flex-row-reverse' : ''}`}>
      <div className="h-full w-[7px] rounded-t-[1px] bg-surface-strong" />
      <div className="h-[7px] w-[18px] bg-surface-strong" />
    </div>
  );
}
