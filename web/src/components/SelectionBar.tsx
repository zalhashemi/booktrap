import { useEffect, useId, useRef, useState } from 'react';
import { ArrowsMerge, Export, Trash, X } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';
import { CoverPlate } from './BookRow';
import { Button } from './Button';

interface Props {
  selected: Book[];
  onDelete: () => void;
  onMerge: (keep: Book, others: Book[]) => void;
  onExport: () => void;
  onCancel: () => void;
  busy: boolean;
}

/** Bulk actions for select mode: sits above the tab bar on phones, at the bottom on desktop. */
export function SelectionBar({ selected, onDelete, onMerge, onExport, onCancel, busy }: Props) {
  const [merging, setMerging] = useState(false);
  const count = selected.length;

  return (
    <>
      <div
        role="region"
        aria-label="Selected books"
        className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-[640px] rounded-[22px] bg-surface shadow-[var(--elev-lift),inset_0_0_0_1.5px_var(--rule-accent)] md:bottom-6"
      >
        {/* Phones put the actions on their own row so every label fits; wider screens keep one row. */}
        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Stop selecting"
            className="flex size-11 shrink-0 items-center justify-center rounded-pill text-text-muted hover:text-text"
          >
            <X size={22} aria-hidden="true" />
          </button>
          <p className="min-w-0 flex-1 truncate text-[0.9rem] font-bold whitespace-nowrap" aria-live="polite">
            {count === 0 ? 'Pick books' : `${count} selected`}
          </p>
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
            <Button type="button" variant="quiet" onClick={onExport} disabled={count === 0} className="min-h-11 gap-1.5 px-2 sm:gap-2 sm:px-3">
              <Export size={18} aria-hidden="true" className="shrink-0" />
              Export
            </Button>
            <Button type="button" variant="quiet" onClick={() => setMerging(true)} disabled={count < 2 || busy} className="min-h-11 gap-1.5 px-2 sm:gap-2 sm:px-3">
              <ArrowsMerge size={18} aria-hidden="true" className="shrink-0" />
              Merge
            </Button>
            {/* Delete reads as it does in the book sheet: the note colour, not the teal that means "go". */}
            <Button type="button" variant="quiet" onClick={onDelete} disabled={count === 0 || busy} className="min-h-11 gap-1.5 px-2 text-note-ink sm:gap-2 sm:px-3">
              <Trash size={18} aria-hidden="true" className="shrink-0" />
              Delete
            </Button>
          </div>
        </div>
      </div>
      {merging && (
        <MergeDialog
          books={selected}
          onCancel={() => setMerging(false)}
          onConfirm={(keep) => {
            setMerging(false);
            onMerge(keep, selected.filter((book) => book.id !== keep.id));
          }}
        />
      )}
    </>
  );
}

/** Picks which copy survives a manual merge. The best-sourced copy with a cover is suggested. */
function MergeDialog({ books, onCancel, onConfirm }: { books: Book[]; onCancel: () => void; onConfirm: (keep: Book) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const suggested = [...books].sort((a, b) => Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl)) || b.sources.length - a.sources.length)[0]!;
  const [keepId, setKeepId] = useState(suggested.id);
  const name = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      aria-labelledby="merge-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[24px] bg-ground-raised p-0 text-text shadow-[var(--elev-lift),inset_0_0_0_1px_var(--rule-accent)] backdrop:bg-[rgb(31_28_36/0.6)]"
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(books.find((book) => book.id === keepId)!);
        }}
        className="p-5"
      >
        <h2 id="merge-title" className="font-display text-[1.4rem] leading-tight">
          Merge into one book
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Choose the copy to keep. The others’ posts, shelves and notes move onto it, then they’re removed.
        </p>
        <fieldset className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
          <legend className="sr-only">Book to keep</legend>
          {books.map((book) => (
            <label
              key={book.id}
              className={`flex cursor-pointer items-center gap-3 rounded-[16px] p-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                keepId === book.id ? 'bg-surface shadow-[inset_0_0_0_1px_var(--accent)]' : 'hover:bg-surface'
              }`}
            >
              <input type="radio" name={name} checked={keepId === book.id} onChange={() => setKeepId(book.id)} className="accent-[var(--accent)]" />
              <CoverPlate book={book} className="w-10" tabs={false} />
              <span className="min-w-0">
                <span className="block truncate font-display">{book.title}</span>
                <span className="block truncate text-sm text-text-muted">
                  {book.author ?? 'Author unknown'}, {book.sources.length} {book.sources.length === 1 ? 'post' : 'posts'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Merge {books.length}</Button>
        </div>
      </form>
    </dialog>
  );
}
