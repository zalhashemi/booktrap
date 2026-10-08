import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Checks, ListChecks } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';
import { BookRow } from '../components/BookRow';
import { BookSheet } from '../components/BookSheet';
import { Button, ButtonLink } from '../components/Button';
import { SelectionBar } from '../components/SelectionBar';
import { ShelfGrid } from '../components/ShelfGrid';
import { ShelfToolbar, type ViewMode } from '../components/ShelfToolbar';
import { useToast } from '../components/Toaster';
import { DEFAULT_QUERY, applyQuery, flagCounts, isFiltered, type ShelfQuery, type SortKey } from '../library/filters';
import { useBooks, useDeleteBooks, useMarkAllSeen, useMergeBooks, useRestoreBooks, useTags } from '../library/hooks';

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

const PREFS_KEY = 'booktrap.shelf.prefs';

/** View and sort are per-browser conveniences: remembered when possible, fine when not. */
function loadPrefs(): { view: ViewMode; sort: SortKey } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<{ view: ViewMode; sort: SortKey }>;
    return {
      view: saved.view === 'list' ? 'list' : 'shelf',
      sort: saved.sort === 'title' || saved.sort === 'author' ? saved.sort : 'added',
    };
  } catch {
    return { view: 'shelf', sort: 'added' };
  }
}

function savePrefs(prefs: { view: ViewMode; sort: SortKey }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: preferences simply aren't remembered.
  }
}

export function ShelfPage() {
  const books = useBooks();
  const tags = useTags();
  const toast = useToast();
  const deleteBooks = useDeleteBooks();
  const restoreBooks = useRestoreBooks();
  const markAllSeen = useMarkAllSeen();
  const mergeBooks = useMergeBooks();

  const [prefs, setPrefs] = useState(loadPrefs);
  const [query, setQuery] = useState<ShelfQuery>(() => ({ ...DEFAULT_QUERY, sort: prefs.sort }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all = useMemo(() => books.data ?? [], [books.data]);
  const counts = useMemo(() => flagCounts(all), [all]);
  const visible = useMemo(() => applyQuery([...all], query), [all, query]);
  const openBook = all.find((book) => book.id === openId) ?? null;

  const updateQuery = (next: ShelfQuery) => {
    setQuery(next);
    if (next.sort !== prefs.sort) {
      const updated = { ...prefs, sort: next.sort };
      setPrefs(updated);
      savePrefs(updated);
    }
  };
  const setView = (view: ViewMode) => {
    const updated = { ...prefs, view };
    setPrefs(updated);
    savePrefs(updated);
  };

  const toggle = useCallback((book: Book) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  }, []);

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  /** Deletes with an Undo toast (brief §7). The server keeps deleted books for 30 days. */
  const remove = (ids: string[]) => {
    // mutateAsync, not per-call callbacks: overlapping deletes each keep their own Undo toast.
    deleteBooks.mutateAsync(ids).then(
      () =>
        toast(ids.length === 1 ? 'Book deleted' : `${ids.length} books deleted`, {
          action: { label: 'Undo', run: () => restoreBooks.mutate(ids) },
        }),
      () => toast('Couldn’t delete. Check your connection and try again.'),
    );
  };

  const newCount = counts.new;

  return (
    <div className={selecting ? 'pb-20' : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-[2.15rem] leading-[1.08] tracking-[-0.01em] md:text-[2.9rem]">Your shelf</h1>
          {all.length > 0 && (
            <p className="mt-1 text-sm text-text-muted">
              {all.length} {all.length === 1 ? 'book' : 'books'}
              {newCount > 0 && <span className="text-text">, {newCount} new</span>}
            </p>
          )}
        </div>
        {all.length > 0 && (
          <div className="flex gap-2">
            {newCount > 0 && (
              <Button type="button" variant="quiet" onClick={() => markAllSeen.mutate()} className="min-h-11 px-4">
                <Checks size={18} aria-hidden="true" />
                Mark all as seen
              </Button>
            )}
            {!selecting && (
              <Button type="button" variant="quiet" onClick={() => setSelecting(true)} className="min-h-11 px-4">
                <ListChecks size={18} aria-hidden="true" />
                Select
              </Button>
            )}
          </div>
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
      ) : all.length === 0 ? (
        <>
          <EmptyShelf />
          <div className="mt-8 max-w-[34rem]">
            <h2 className="font-serif text-[1.3rem]">Nothing shelved yet</h2>
            <p className="mt-2 text-text-muted">
              Every book BookTrap finds in your TikToks stands here. The newest arrivals wear a lime ribbon so you can spot
              them.
            </p>
            <ButtonLink to="/" className="mt-6">
              Paste links
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <ShelfToolbar query={query} onChange={updateQuery} counts={counts} tags={tags.data ?? []} view={prefs.view} onViewChange={setView} />

          {visible.length === 0 ? (
            <div className="mt-12 max-w-[34rem]">
              <h2 className="font-serif text-[1.3rem]">No books match</h2>
              <p className="mt-2 text-text-muted">Try a different search, or clear the filters to see your whole shelf.</p>
              {isFiltered(query) && (
                <Button type="button" variant="quiet" onClick={() => setQuery({ ...DEFAULT_QUERY, sort: query.sort })} className="mt-5">
                  Clear filters
                </Button>
              )}
            </div>
          ) : prefs.view === 'shelf' ? (
            <ShelfGrid books={visible} onOpen={(book) => setOpenId(book.id)} selecting={selecting} selected={selected} onToggle={toggle} />
          ) : (
            <ul className="mt-6 max-w-[760px] divide-y divide-rule">
              {visible.map((book) => (
                <BookRow
                  key={book.id}
                  book={book}
                  onOpen={(b) => setOpenId(b.id)}
                  selecting={selecting}
                  selected={selected.has(book.id)}
                  onToggle={toggle}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <BookSheet
        book={openBook}
        onClose={() => setOpenId(null)}
        onDelete={(book) => {
          setOpenId(null);
          remove([book.id]);
        }}
      />

      {selecting && (
        <SelectionBar
          selected={all.filter((book) => selected.has(book.id))}
          busy={deleteBooks.isPending || mergeBooks.isPending}
          onCancel={stopSelecting}
          onDelete={() => {
            remove([...selected]);
            stopSelecting();
          }}
          onMerge={(keep, others) =>
            mergeBooks.mutate(
              { keepId: keep.id, mergeIds: others.map((book) => book.id) },
              {
                onSuccess: () => {
                  toast(`Merged into “${keep.title}”`);
                  stopSelecting();
                },
                onError: () => toast('Couldn’t merge. Try again.'),
              },
            )
          }
        />
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
