import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { PencilSimple, Trash } from '@phosphor-icons/react';
import { LIMITS } from '@booktrap/shared';
import { ApiRequestError } from '../api/client';
import { useCreateTag, useDeleteTag, useRenameTag, useTags } from '../library/hooks';
import { Button } from './Button';
import { useToast } from './toast-context';

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="mt-6 scroll-mt-24 rounded-card bg-surface p-5 shadow-[inset_0_0_0_1.5px_var(--rule)] md:p-6">
      <h2 id={headingId} className="font-display text-[1.5rem]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ShelvesSection() {
  const tags = useTags();
  const createTag = useCreateTag();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const add = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createTag.mutate(trimmed, {
      onSuccess: () => {
        setName('');
        setError(null);
      },
      onError: (failure) => setError(failure instanceof ApiRequestError ? failure.message : 'Couldn’t add that shelf. Try again.'),
    });
  };

  return (
    <Section title="Shelves">
      <p className="mt-2 max-w-[56ch] text-sm text-text-muted">
        Group books your own way, like “Dark academia” or “Summer reads”. Add books to shelves from each book’s page. They
        become Goodreads shelves when you export.
      </p>
      {tags.data && tags.data.length > 0 && (
        <ul className="mt-4 divide-y divide-rule">
          {tags.data.map((tag) => (
            <TagRow key={tag.id} id={tag.id} name={tag.name} onError={(message) => toast(message)} />
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2" noValidate>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={inputId} className="block text-[0.95rem] font-bold">
            New shelf
          </label>
          <input
            id={inputId}
            value={name}
            maxLength={LIMITS.shelfNameChars}
            onChange={(event) => setName(event.target.value)}
            placeholder="Shelf name"
            className="field mt-2"
          />
        </div>
        <Button type="submit" variant="quiet" disabled={!name.trim() || createTag.isPending}>
          Add shelf
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-note-ink">
          {error}
        </p>
      )}
    </Section>
  );
}

function TagRow({ id, name, onError }: { id: string; name: string; onError: (message: string) => void }) {
  const rename = useRenameTag();
  const remove = useDeleteTag();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputId = useId();

  const save = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return setEditing(false);
    rename.mutate(
      { id, name: trimmed },
      {
        onSuccess: () => setEditing(false),
        onError: (failure) => onError(failure instanceof ApiRequestError ? failure.message : 'Couldn’t rename that shelf.'),
      },
    );
  };

  return (
    <li className="flex min-h-14 items-center gap-2 py-1.5">
      {editing ? (
        <form onSubmit={save} className="flex flex-1 items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            Shelf name
          </label>
          <input
            id={inputId}
            autoFocus
            value={value}
            maxLength={LIMITS.shelfNameChars}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setValue(name);
                setEditing(false);
              }
            }}
            className="field flex-1"
          />
          <Button type="submit" variant="quiet" disabled={rename.isPending} className="min-h-11 px-4">
            Save
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 text-[0.95rem]">{name}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Rename ${name}`}
            className="flex size-11 items-center justify-center rounded-pill text-text-muted hover:text-text"
          >
            <PencilSimple size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete the shelf “${name}”? Books on it stay on your shelf.`)) {
                remove.mutate(id, { onError: () => onError('Couldn’t delete that shelf.') });
              }
            }}
            aria-label={`Delete ${name}`}
            className="flex size-11 items-center justify-center rounded-pill text-text-muted hover:text-note-ink"
          >
            <Trash size={18} aria-hidden="true" />
          </button>
        </>
      )}
    </li>
  );
}
