import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowSquareOut, CaretRight, Check, Plus, Question, Trash, X } from '@phosphor-icons/react';
import { BOOK_STATUSES, type Book, type BookStatus, type UpdateBookRequest } from '@booktrap/shared';
import { ApiRequestError } from '../api/client';
import { STATUS_LABELS } from '../library/filters';
import { useCreateTag, useTags, useUpdateBook } from '../library/hooks';
import { BookFlags, CoverPlate } from './BookRow';
import { Button } from './Button';
import { useToast } from './toast-context';

const EVIDENCE_LABELS: Record<string, string> = {
  cover: 'cover shown',
  spine: 'spine shown',
  text_overlay: 'on-screen text',
  caption: 'in the caption',
  spoken: 'mentioned out loud',
  other: 'seen in the post',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

interface Draft {
  title: string;
  author: string;
  status: BookStatus;
  notes: string;
  isbn13: string;
  isbn10: string;
  tagIds: string[];
}

const draftOf = (book: Book): Draft => ({
  title: book.title,
  author: book.author ?? '',
  status: book.status,
  notes: book.notes ?? '',
  isbn13: book.isbn13 ?? '',
  isbn10: book.isbn10 ?? '',
  tagIds: book.tags.map((tag) => tag.id),
});

/** Only the fields the reader actually changed, so the server re-verifies only when it must. */
function changes(book: Book, draft: Draft): UpdateBookRequest {
  const before = draftOf(book);
  const patch: UpdateBookRequest = {};
  if (draft.title.trim() !== before.title) patch.title = draft.title;
  if (draft.author.trim() !== before.author) patch.author = draft.author;
  if (draft.status !== before.status) patch.status = draft.status;
  if (draft.notes.trim() !== before.notes) patch.notes = draft.notes;
  if (draft.isbn13.trim() !== before.isbn13) patch.isbn13 = draft.isbn13;
  if (draft.isbn10.trim() !== before.isbn10) patch.isbn10 = draft.isbn10;
  if ([...draft.tagIds].sort().join() !== [...before.tagIds].sort().join()) patch.tagIds = draft.tagIds;
  return patch;
}

interface Props {
  book: Book | null;
  onClose: () => void;
  onDelete: (book: Book) => void;
}

export function BookSheet({ book, onClose, onDelete }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (book && !element.open) element.showModal();
    if (!book && element.open) element.close();
  }, [book]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Clicking the dimmed backdrop (the dialog element itself) closes the sheet.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="book-sheet-title"
      className="sheet m-0 mt-auto h-[calc(100dvh-1.5rem)] max-h-none w-full max-w-none overflow-hidden rounded-t-[26px] bg-ground-raised p-0 text-text shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.7)] backdrop:bg-[rgb(10_9_7/0.66)] md:mt-0 md:mr-0 md:ml-auto md:h-dvh md:w-[480px] md:rounded-l-[26px] md:rounded-r-none"
    >
      {book && <SheetBody key={book.id} book={book} onClose={onClose} onDelete={onDelete} />}
    </dialog>
  );
}

function SheetBody({ book, onClose, onDelete }: { book: Book; onClose: () => void; onDelete: (book: Book) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(book));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateBook();
  const toast = useToast();
  const ids = { title: useId(), author: useId(), notes: useId(), isbn13: useId(), isbn10: useId(), status: useId() };
  const patch = useMemo(() => changes(book, draft), [book, draft]);
  const dirty = Object.keys(patch).length > 0;

  // Opening a book counts as seeing it: its "New" ribbon clears (brief §7).
  const markedSeen = useRef(false);
  useEffect(() => {
    if (book.isNew && !markedSeen.current) {
      markedSeen.current = true;
      update.mutate({ id: book.id, patch: { isNew: false } });
    }
  }, [book.id, book.isNew, update]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || update.isPending) return;
    setError(null);
    const recheck = patch.title !== undefined || patch.author !== undefined;
    update.mutate(
      { id: book.id, patch },
      {
        onSuccess: (saved) => {
          toast(recheck && !saved.verified ? 'Saved. BookTrap couldn’t find it in the catalogues, so it’s marked Unsure.' : 'Saved');
          onClose();
        },
        onError: (failure) => setError(failure instanceof ApiRequestError ? failure.message : 'Couldn’t save. Check your connection and try again.'),
      },
    );
  };

  const confirm = () =>
    update.mutate(
      { id: book.id, patch: { unsure: false } },
      { onSuccess: () => toast('Marked as confirmed'), onError: () => setError('Couldn’t confirm. Try again.') },
    );

  return (
    <form onSubmit={save} className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-5 pb-4">
        <div className="flex min-w-0 gap-4">
          <CoverPlate book={book} className="w-16" />
          <div className="min-w-0 pt-1">
            <h2 id="book-sheet-title" className="font-display text-[1.55rem] leading-tight">
              {book.title}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{book.author ?? 'Author unknown'}</p>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.8rem]">
              <BookFlags book={book} />
              {book.publishedYear && <span className="text-text-faint">{book.publishedYear}</span>}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-pill text-text-muted hover:text-text"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-6">
        {book.unsure && (
          <div className="rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--unsure)]">
            <p className="flex items-start gap-2 text-[0.95rem]">
              <Question size={20} weight="bold" className="mt-0.5 shrink-0 text-unsure-ink" aria-hidden="true" />
              BookTrap isn’t sure it read this one right. Check the title and author, then confirm or fix them.
            </p>
            <Button type="button" variant="quiet" onClick={confirm} disabled={update.isPending} className="mt-3 w-full md:w-auto">
              <Check size={18} aria-hidden="true" />
              Looks right
            </Button>
          </div>
        )}

        <Field id={ids.title} label="Title">
          <input
            id={ids.title}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            required
            maxLength={500}
            className="field"
          />
        </Field>
        <Field id={ids.author} label="Author">
          <input
            id={ids.author}
            value={draft.author}
            onChange={(event) => setDraft({ ...draft, author: event.target.value })}
            maxLength={300}
            placeholder="Unknown"
            className="field"
          />
        </Field>
        {(patch.title !== undefined || patch.author !== undefined) && (
          <p className="-mt-4 text-sm text-text-muted">Saving re-checks the book against Google Books and Open Library.</p>
        )}

        <fieldset>
          <legend className="text-[0.95rem] font-medium">Status</legend>
          <div className="mt-2 grid grid-cols-3 rounded-pill bg-surface p-1 shadow-[inset_0_0_0_1.5px_var(--rule)]">
            {BOOK_STATUSES.map((status) => (
              <label
                key={status}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-pill px-2 text-center text-[0.9rem] font-bold transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  draft.status === status ? 'bg-accent text-on-tab' : 'text-text-muted hover:text-text'
                }`}
              >
                <input
                  type="radio"
                  name={ids.status}
                  value={status}
                  checked={draft.status === status}
                  onChange={() => setDraft({ ...draft, status })}
                  className="sr-only"
                />
                {STATUS_LABELS[status]}
              </label>
            ))}
          </div>
        </fieldset>

        <TagPicker selected={draft.tagIds} onChange={(tagIds) => setDraft({ ...draft, tagIds })} />

        <Field id={ids.notes} label="Notes">
          <textarea
            id={ids.notes}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            rows={3}
            maxLength={5000}
            placeholder="Who recommended it, why it caught your eye…"
            className="field resize-y"
          />
        </Field>

        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-[0.95rem] font-medium text-text-muted hover:text-text">
            <CaretRight size={16} className="mr-2 transition-transform group-open:rotate-90" aria-hidden="true" />
            ISBNs
          </summary>
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            <Field id={ids.isbn13} label="ISBN-13">
              <input id={ids.isbn13} value={draft.isbn13} onChange={(event) => setDraft({ ...draft, isbn13: event.target.value })} inputMode="numeric" className="field tabular-nums" />
            </Field>
            <Field id={ids.isbn10} label="ISBN-10">
              <input id={ids.isbn10} value={draft.isbn10} onChange={(event) => setDraft({ ...draft, isbn10: event.target.value })} className="field tabular-nums" />
            </Field>
          </div>
        </details>

        <section aria-labelledby="sources-heading">
          <h3 id="sources-heading" className="text-[0.95rem] font-medium">
            {book.sources.length === 1 ? 'Found in 1 TikTok' : `Seen in ${book.sources.length} TikToks`}
          </h3>
          <ul className="mt-2 divide-y divide-rule">
            {book.sources.map((source) => (
              <li key={source.id}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm hover:text-accent-ink"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">@{source.creatorHandle ?? 'TikTok'}</span>
                    <span className="block text-text-muted">
                      {source.evidence ? EVIDENCE_LABELS[source.evidence] : 'seen in the post'}, {dateFormat.format(new Date(source.createdAt))}
                    </span>
                    </span>
                  <ArrowSquareOut size={18} className="shrink-0 text-text-faint" aria-label="Opens TikTok in a new tab" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="border-t border-rule bg-ground-raised px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mb-3 text-sm text-unsure-ink">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onDelete(book)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-2 text-sm text-unsure-ink hover:underline"
          >
            <Trash size={18} aria-hidden="true" />
            Delete
          </button>
          <Button type="submit" disabled={!dirty || update.isPending} className="min-w-32">
            {update.isPending && dirty ? (patch.title !== undefined || patch.author !== undefined ? 'Checking…' : 'Saving…') : 'Save'}
          </Button>
        </div>
      </footer>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[0.95rem] font-medium">
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TagPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const tags = useTags();
  const createTag = useCreateTag();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const inputId = useId();

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((tagId) => tagId !== id) : [...selected, id]);
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createTag.mutate(trimmed, {
      onSuccess: (tag) => {
        if (!selected.includes(tag.id)) onChange([...selected, tag.id]);
        setName('');
        setAdding(false);
      },
    });
  };

  return (
    <fieldset>
      <legend className="text-[0.95rem] font-medium">Shelves</legend>
      <p className="mt-0.5 text-sm text-text-muted">Your own groupings. They become Goodreads shelves when you export.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(tags.data ?? []).map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag.id)}
              className={`min-h-11 rounded-pill px-4 text-[0.9rem] font-bold transition-[background-color,transform] duration-200 ease-snappy active:scale-[0.97] ${
                on ? 'bg-tag text-on-tab' : 'text-text-muted shadow-[inset_0_0_0_1.5px_var(--rule)] hover:text-text'
              }`}
            >
              {tag.name}
            </button>
          );
        })}
        {adding ? (
          <span className="flex items-center gap-2">
            <label htmlFor={inputId} className="sr-only">
              New shelf name
            </label>
            <input
              id={inputId}
              autoFocus
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setAdding(false);
                }
              }}
              placeholder="Shelf name"
              className="field h-11 w-40 py-0"
            />
            <Button type="button" variant="quiet" onClick={add} disabled={!name.trim() || createTag.isPending} className="min-h-11 px-4">
              Add
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 text-[0.9rem] text-accent-ink hover:underline"
          >
            <Plus size={16} aria-hidden="true" />
            New shelf
          </button>
        )}
      </div>
    </fieldset>
  );
}
