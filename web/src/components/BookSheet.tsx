import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowSquareOut, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { BOOK_STATUSES, LIMITS, PLATFORM_LABELS, type Book, type UpdateBookRequest } from '@booktrap/shared';
import { ApiRequestError } from '../api/client';
import { STATUS_LABELS } from '../library/filters';
import { useCreateTag, useTags, useUpdateBook } from '../library/hooks';
import { sourceHeading } from '../library/links';
import { PlatformIcon } from './PlatformIcon';
import { SourceMenu } from './ReportPost';
import { BookFlags, CoverPlate } from './BookRow';
import { Button } from './Button';
import { Sheet } from './Sheet';
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

/** The details behind "Edit details". Status and shelves aren't here: they save the moment they're tapped. */
interface Draft {
  title: string;
  author: string;
  notes: string;
  isbn13: string;
  isbn10: string;
}

const draftOf = (book: Book): Draft => ({
  title: book.title,
  author: book.author ?? '',
  notes: book.notes ?? '',
  isbn13: book.isbn13 ?? '',
  isbn10: book.isbn10 ?? '',
});

/** Only the fields the reader actually changed, so the server re-verifies only when it must. */
function changes(book: Book, draft: Draft): UpdateBookRequest {
  const before = draftOf(book);
  const patch: UpdateBookRequest = {};
  if (draft.title.trim() !== before.title) patch.title = draft.title;
  if (draft.author.trim() !== before.author) patch.author = draft.author;
  if (draft.notes.trim() !== before.notes) patch.notes = draft.notes;
  if (draft.isbn13.trim() !== before.isbn13) patch.isbn13 = draft.isbn13;
  if (draft.isbn10.trim() !== before.isbn10) patch.isbn10 = draft.isbn10;
  return patch;
}

interface Props {
  book: Book | null;
  onClose: () => void;
  onDelete: (book: Book) => void;
}

export function BookSheet({ book, onClose, onDelete }: Props) {
  // The open body can hold back a close (Esc, backdrop, X) while edits are unsaved.
  const canClose = useRef<() => boolean>(() => true);
  const setCloseGuard = useCallback((guard: () => boolean) => {
    canClose.current = guard;
  }, []);
  const requestClose = () => {
    if (canClose.current()) onClose();
  };
  return (
    <Sheet open={book !== null} onClose={requestClose} labelledBy="book-sheet-title">
      {book && <SheetBody key={book.id} book={book} onClose={onClose} requestClose={requestClose} setCloseGuard={setCloseGuard} onDelete={onDelete} />}
    </Sheet>
  );
}

interface BodyProps {
  book: Book;
  onClose: () => void;
  requestClose: () => void;
  setCloseGuard: (guard: () => boolean) => void;
  onDelete: (book: Book) => void;
}

/**
 * View first: the book's status and where it was seen come before any form. Status and shelves save
 * on tap; title, author, notes and ISBNs sit behind "Edit details" with an explicit Save.
 */
function SheetBody({ book, onClose, requestClose, setCloseGuard, onDelete }: BodyProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(book));
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The status the reader just tapped, so its tab drops onto the cover.
  const [dropTab, setDropTab] = useState<'reading' | 'read' | null>(null);
  const update = useUpdateBook();
  const quick = useUpdateBook();
  const toast = useToast();
  const ids = { title: useId(), author: useId(), notes: useId(), isbn13: useId(), isbn10: useId(), status: useId() };
  const patch = useMemo(() => changes(book, draft), [book, draft]);
  const dirty = editing && Object.keys(patch).length > 0;
  const reverifies = patch.title !== undefined || patch.author !== undefined;

  // Closing with unsaved edits asks first instead of silently dropping them.
  useEffect(() => {
    setCloseGuard(() => {
      if (!dirty) return true;
      setConfirmDiscard(true);
      return false;
    });
    return () => setCloseGuard(() => true);
  }, [dirty, setCloseGuard]);

  // Opening a book counts as seeing it: its "New" ribbon clears (brief §7).
  const markedSeen = useRef(false);
  useEffect(() => {
    if (book.isNew && !markedSeen.current) {
      markedSeen.current = true;
      quick.mutate({ id: book.id, patch: { isNew: false } });
    }
  }, [book.id, book.isNew, quick]);

  /** One-tap changes (status, shelves): shown at once, rolled back with a message if the save fails. */
  const saveNow = (change: UpdateBookRequest) => {
    setError(null);
    // mutateAsync: every tap gets its own outcome, even when taps overlap.
    quick.mutateAsync({ id: book.id, patch: change }).catch(() => setError('Couldn’t save that change. Check your connection and try again.'));
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || update.isPending) return;
    setError(null);
    update.mutate(
      { id: book.id, patch },
      {
        onSuccess: (updated) => {
          toast('Saved');
          // Re-verification can change the ISBNs: the next edit starts from what the server kept.
          setDraft(draftOf(updated));
          setEditing(false);
        },
        onError: (failure) => setError(failure instanceof ApiRequestError ? failure.message : 'Couldn’t save. Check your connection and try again.'),
      },
    );
  };

  const stopEditing = () => {
    setDraft(draftOf(book));
    setEditing(false);
    setConfirmDiscard(false);
    setError(null);
  };

  return (
    <form onSubmit={save} className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-5 pb-4">
        <div className="flex min-w-0 gap-4">
          <CoverPlate book={book} className="w-20" dropTab={dropTab} />
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
          onClick={requestClose}
          aria-label="Close"
          className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-pill text-text-muted hover:text-text"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-6">
        <fieldset>
          <legend className="text-[0.95rem] font-bold">Status</legend>
          <div className="mt-2 grid grid-cols-3 rounded-pill bg-surface p-1 shadow-[inset_0_0_0_1.5px_var(--rule)]">
            {BOOK_STATUSES.map((status) => (
              <label
                key={status}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-pill px-2 text-center text-[0.9rem] font-bold transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] ${
                  book.status === status ? 'bg-accent text-on-tab' : 'text-text-muted hover:text-text'
                }`}
              >
                <input type="radio" name={ids.status} value={status} checked={book.status === status} onChange={() => {
                    setDropTab(status === 'want_to_read' ? null : status);
                    saveNow({ status });
                  }} className="sr-only" />
                {STATUS_LABELS[status]}
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby="sources-heading">
          <h3 id="sources-heading" className="text-[0.95rem] font-bold">
            {sourceHeading(book.sources)}
          </h3>
          <ul className="mt-1 divide-y divide-rule">
            {book.sources.map((source) => (
              <li key={source.id} className="flex items-center gap-1">
                <a href={source.url} target="_blank" rel="noreferrer" className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 py-2 text-sm hover:text-accent-ink">
                  <PlatformIcon platform={source.platform} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">@{source.creatorHandle ?? PLATFORM_LABELS[source.platform]}</span>
                    <span className="block text-text-muted">
                      {source.evidence ? EVIDENCE_LABELS[source.evidence] : 'seen in the post'}, {dateFormat.format(new Date(source.createdAt))}
                    </span>
                  </span>
                  <ArrowSquareOut size={18} className="shrink-0 text-text-faint" aria-label={`Opens ${PLATFORM_LABELS[source.platform]} in a new tab`} />
                </a>
                <SourceMenu source={source} />
              </li>
            ))}
          </ul>
        </section>

        <TagPicker selected={book.tags.map((tag) => tag.id)} onChange={(tagIds) => saveNow({ tagIds })} />

        {!editing && book.notes && (
          <section aria-labelledby="notes-heading">
            <h3 id="notes-heading" className="text-[0.95rem] font-bold">
              Notes
            </h3>
            <p className="mt-2 text-[0.95rem] whitespace-pre-line text-text-muted">{book.notes}</p>
          </section>
        )}

        {editing ? (
          <section aria-label="Edit details" className="space-y-6 border-t border-rule pt-6">
            <Field id={ids.title} label="Title">
              <input id={ids.title} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required maxLength={LIMITS.titleChars} className="field" />
            </Field>
            <Field id={ids.author} label="Author">
              <input
                id={ids.author}
                value={draft.author}
                onChange={(event) => setDraft({ ...draft, author: event.target.value })}
                maxLength={LIMITS.authorChars}
                placeholder="Unknown"
                className="field"
              />
            </Field>
            {reverifies && <p className="-mt-3 text-sm text-text-muted">Saving re-checks the book against Google Books and Open Library.</p>}
            <Field id={ids.notes} label="Notes">
              <textarea
                id={ids.notes}
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                rows={3}
                maxLength={LIMITS.notesChars}
                placeholder="Who recommended it, why it caught your eye…"
                className="field resize-y"
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id={ids.isbn13} label="ISBN-13">
                <input id={ids.isbn13} value={draft.isbn13} onChange={(event) => setDraft({ ...draft, isbn13: event.target.value })} inputMode="numeric" className="field tabular-nums" />
              </Field>
              <Field id={ids.isbn10} label="ISBN-10">
                <input id={ids.isbn10} value={draft.isbn10} onChange={(event) => setDraft({ ...draft, isbn10: event.target.value })} className="field tabular-nums" />
              </Field>
            </div>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => {
              // Start from the book as it is now (another device or a re-check may have changed it).
              setDraft(draftOf(book));
              setEditing(true);
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-pill px-1 text-[0.95rem] font-bold text-accent-ink hover:underline"
          >
            <PencilSimple size={18} weight="bold" aria-hidden="true" />
            {book.notes ? 'Edit details and notes' : 'Edit details, or add a note'}
          </button>
        )}
      </div>

      <footer className="border-t border-rule bg-ground-raised px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mb-3 text-sm text-note-ink">
            {error}
          </p>
        )}
        {confirmDiscard ? (
          <div className="flex flex-wrap items-center justify-between gap-3" role="alert">
            <p className="text-sm font-bold">Discard your changes to this book?</p>
            {/* Right-aligned, so the filled choice sits where Save and Done do. */}
            <div className="ml-auto flex gap-2">
              {/* The safe choice is the filled one; discarding is quiet, like Delete. */}
              <button
                type="button"
                onClick={() => {
                  stopEditing();
                  onClose();
                }}
                className="inline-flex min-h-11 items-center rounded-pill px-3 text-sm font-bold text-note-ink hover:underline"
              >
                Discard
              </button>
              <Button type="button" onClick={() => setConfirmDiscard(false)} className="min-h-11 px-4">
                Keep editing
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onDelete(book)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-2 text-sm text-note-ink hover:underline"
            >
              <Trash size={18} aria-hidden="true" />
              Delete
            </button>
            {editing ? (
              <div className="flex gap-2">
                <Button type="button" variant="quiet" onClick={stopEditing} className="min-h-11 px-4">
                  Cancel
                </Button>
                <Button type="submit" disabled={!dirty || update.isPending} className="min-h-11 min-w-28">
                  {update.isPending ? (reverifies ? 'Checking…' : 'Saving…') : 'Save'}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="quiet" onClick={onClose} className="min-h-11 px-5">
                Done
              </Button>
            )}
          </div>
        )}
      </footer>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[0.95rem] font-bold">
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
      <legend className="text-[0.95rem] font-bold">Shelves</legend>
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
              maxLength={LIMITS.shelfNameChars}
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
