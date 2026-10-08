import { useEffect, useId, useRef, useState } from 'react';
import { ArrowsMerge, Trash, X } from '@phosphor-icons/react';
import type { Book } from '@booktrap/shared';
import { CoverPlate } from './BookRow';
import { Button } from './Button';

interface Props {
  selected: Book[];
  onDelete: () => void;
  onMerge: (keep: Book, others: Book[]) => void;
  onCancel: () => void;
  busy: boolean;
}

/** Bulk actions for select mode: sits above the tab bar on phones, at the bottom on desktop. */
export function SelectionBar({ selected, onDelete, onMerge, onCancel, busy }: Props) {
  const [merging, setMerging] = useState(false);
  const count = selected.length;

  return (
    <>
      <div
        role="region"
        aria-label="Selected books"
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-rule-gold bg-ground-raised md:bottom-0"
      >
        <div className="mx-auto flex max-w-[1080px] items-center gap-2 px-2 py-2.5 md:px-8">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Stop selecting"
            className="flex size-11 shrink-0 items-center justify-center rounded-board text-text-muted hover:text-text"
          >
            <X size={22} aria-hidden="true" />
          </button>
          <p className="mr-auto min-w-0 text-[0.9rem] whitespace-nowrap" aria-live="polite">
            {count === 0 ? 'Tap books to select' : `${count} selected`}
          </p>
          <Button type="button" variant="quiet" onClick={() => setMerging(true)} disabled={count < 2 || busy} className="min-h-11 px-3">
            <ArrowsMerge size={18} aria-hidden="true" />
            Merge
          </Button>
          <Button type="button" onClick={onDelete} disabled={count === 0 || busy} className="min-h-11 px-3">
            <Trash size={18} aria-hidden="true" />
            Delete
          </Button>
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

/** Picks which copy survives a manual merge. The best-sourced, verified copy is suggested. */
function MergeDialog({ books, onCancel, onConfirm }: { books: Book[]; onCancel: () => void; onConfirm: (keep: Book) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const suggested = [...books].sort((a, b) => Number(b.verified) - Number(a.verified) || b.sources.length - a.sources.length)[0]!;
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
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-board bg-ground-raised p-0 text-text shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8),inset_0_0_0_1px_var(--rule-gold)] backdrop:bg-[rgb(10_9_7/0.66)]"
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
          Choose the copy to keep. The others’ TikToks, shelves and notes move onto it, then they’re removed.
        </p>
        <fieldset className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
          <legend className="sr-only">Book to keep</legend>
          {books.map((book) => (
            <label
              key={book.id}
              className={`flex cursor-pointer items-center gap-3 rounded-board p-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${
                keepId === book.id ? 'bg-surface shadow-[inset_0_0_0_1px_var(--gold)]' : 'hover:bg-surface'
              }`}
            >
              <input type="radio" name={name} checked={keepId === book.id} onChange={() => setKeepId(book.id)} className="accent-[var(--gold)]" />
              <CoverPlate book={book} className="w-9" />
              <span className="min-w-0">
                <span className="block truncate font-serif">{book.title}</span>
                <span className="block truncate text-sm text-text-muted">
                  {book.author ?? 'Author unknown'}, {book.sources.length} {book.sources.length === 1 ? 'TikTok' : 'TikToks'}
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
