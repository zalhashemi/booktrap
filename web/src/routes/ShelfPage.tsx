import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Checks, Export, ListChecks } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';
import { BookRow } from '../components/BookRow';
import { BookSheet } from '../components/BookSheet';
import { Button, ButtonLink } from '../components/Button';
import { ExportSheet, type ExportScope } from '../components/ExportSheet';
import { SelectionBar } from '../components/SelectionBar';
import { ShelfGrid } from '../components/ShelfGrid';
import { ShelfToolbar, type ViewMode } from '../components/ShelfToolbar';
import { useToast } from '../components/toast-context';
import { DEFAULT_QUERY, applyQuery, flagCounts, isFiltered, type ShelfQuery, type SortKey } from '../library/filters';
import { useBooks, useDeleteBooks, useMarkAllSeen, useMergeBooks, useRestoreBooks, useTags } from '../library/hooks';

/** Ghost books for the empty shelf: an optional page-tab colour and lean. */
const GHOST_BOOKS: { tab?: string; lean?: number }[] = [
  { tab: 'bg-lime' },
  { lean: -2 },
  { tab: 'bg-reading', lean: 1.5 },
  {},
  { tab: 'bg-success', lean: 3 },
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
  const [exportScope, setExportScope] = useState<ExportScope | null>(null);

  const all = useMemo(() => books.data ?? [], [books.data]);
  const counts = useMemo(() => flagCounts(all), [all]);
  const visible = useMemo(() => applyQuery([...all], query), [all, query]);
  const openBook = all.find((book) => book.id === openId) ?? null;
  const filtered = isFiltered(query);
  // Exports keep the shelf's current sort, whichever books they cover.
  const wholeShelf = useMemo(() => applyQuery([...all], { ...DEFAULT_QUERY, sort: query.sort }), [all, query.sort]);
  // Every ticked book, as the selection bar counts them, even ones the current filters hide.
  const selectedBooks = useMemo(() => wholeShelf.filter((book) => selected.has(book.id)), [wholeShelf, selected]);

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
    <div className={selecting ? 'pb-36 sm:pb-24' : undefined}>
      {/* Phones keep this to the title, the count and Export: the books start high on the page. */}
      <div className="flex items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-[2.2rem] leading-[1.05] md:text-[3.1rem]">Your shelf</h1>
          {all.length > 0 && (
            <p className="marginalia mt-1 flex flex-wrap items-baseline gap-x-2 text-[1.1rem]">
              <span>
                {all.length} {all.length === 1 ? 'book' : 'books'}
                {newCount > 0 && <span className="text-text">, {newCount} new!</span>}
              </span>
              {newCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllSeen.mutate()}
                  className="-my-3 inline-flex min-h-11 items-center gap-1 font-sans text-[0.85rem] font-bold text-accent-ink underline-offset-4 hover:underline"
                >
                  <Checks size={16} weight="bold" aria-hidden="true" />
                  Mark all as seen
                </button>
              )}
            </p>
          )}
        </div>
        {all.length > 0 && (
          <div className="flex shrink-0 gap-2 pt-1 md:pt-3">
            {!selecting && (
              // Phones start select mode from the tab row instead.
              <span className="hidden md:contents">
                <Button type="button" variant="quiet" onClick={() => setSelecting(true)} className="min-h-11 px-4 text-[0.92rem]">
                  <ListChecks size={18} weight="bold" aria-hidden="true" />
                  Select
                </Button>
              </span>
            )}
            <Button type="button" variant="quiet" onClick={() => setExportScope(selecting && selected.size > 0 ? 'selected' : filtered ? 'view' : 'all')} className="min-h-11 px-4 text-[0.92rem]">
              <Export size={18} weight="bold" aria-hidden="true" />
              Export
            </Button>
          </div>
        )}
      </div>

      {books.isPending ? (
        <p className="mt-10 text-text-muted">Taking books off the shelf…</p>
      ) : books.isError ? (
        <div role="alert" className="mt-10 max-w-[34rem]">
          <p className="text-note-ink">Your shelf couldn’t be loaded just now. Your books are safe.</p>
          <button type="button" onClick={() => void books.refetch()} className="mt-3 min-h-11 text-sm underline underline-offset-4">
            Try again
          </button>
        </div>
      ) : all.length === 0 ? (
        <>
          <EmptyShelf />
          <div className="mt-8 max-w-[34rem]">
            <h2 className="font-display text-[1.5rem]">Nothing shelved yet</h2>
            <p className="mt-2 text-text-muted">
              Every book BookTrap finds in your TikToks and Instagram posts lands here, and the newest ones get a lime highlight so you can spot
              them.
            </p>
            <ButtonLink to="/" className="mt-6">
              Paste your first links
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <ShelfToolbar
            query={query}
            onChange={updateQuery}
            counts={counts}
            tags={tags.data ?? []}
            view={prefs.view}
            onViewChange={setView}
            onSelect={selecting ? undefined : () => setSelecting(true)}
          />

          {visible.length === 0 ? (
            <div className="mt-12 max-w-[34rem]">
              <h2 className="font-display text-[1.5rem]">No books match</h2>
              <p className="mt-2 text-text-muted">Try a different search, or clear the filters to see your whole shelf.</p>
              {filtered && (
                <Button type="button" variant="quiet" onClick={() => setQuery({ ...DEFAULT_QUERY, sort: query.sort })} className="mt-5">
                  Clear filters
                </Button>
              )}
            </div>
          ) : prefs.view === 'shelf' ? (
            <ShelfGrid books={visible} onOpen={(book) => setOpenId(book.id)} selecting={selecting} selected={selected} onToggle={toggle} />
          ) : (
            <ul aria-label="Books on your shelf" className="mt-5 max-w-[780px] space-y-1">
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

      <ExportSheet
        open={exportScope !== null}
        onClose={() => setExportScope(null)}
        all={wholeShelf}
        view={visible}
        filtered={filtered}
        selected={selecting ? selectedBooks : null}
        initialScope={exportScope ?? 'all'}
      />

      {selecting && (
        <SelectionBar
          selected={selectedBooks}
          onExport={() => setExportScope('selected')}
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

/** The empty shelf: ghost books waiting for their covers, a few already flagged with page-tabs. */
function EmptyShelf() {
  return (
    <div className="relative mt-10 max-w-[560px]" aria-hidden="true">
      <div className="flex items-end gap-3 sm:gap-4">
        {GHOST_BOOKS.map((book, index) => (
          <div
            key={index}
            className="ghost-book relative flex-1"
            style={{ '--i': index, '--lean': `${book.lean ?? 0}deg`, maxWidth: 104 } as CSSProperties}
          >
            {book.tab && <span className={`absolute -top-2 right-3 h-4 w-3 rounded-t-[4px] ${book.tab}`} />}
            <div className="aspect-[2/3] rounded-cover border-2 border-dashed border-rule-accent bg-surface/60" />
          </div>
        ))}
      </div>
      <p className="marginalia mt-4 text-[1.1rem]">your next favourite book goes here</p>
    </div>
  );
}
