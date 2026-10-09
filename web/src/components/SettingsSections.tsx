import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, DownloadSimple, PencilSimple, Trash } from '@phosphor-icons/react';
import { ApiRequestError } from '../api/client';
import { decodeBackupCode, encodeBackupCode } from '../device/backupCode';
import { markBackupSaved } from '../device/backupPrompt';
import { useDevice } from '../device/DeviceProvider';
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

/** Backup code (brief §3): the only way back to this shelf if the browser's storage is cleared. */
export function BackupSection() {
  const { session, restore } = useDevice();
  const toast = useToast();
  const [shown, setShown] = useState(false);
  const [input, setInput] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const inputId = useId();
  const helpId = useId();
  if (!session) return null;

  const code = encodeBackupCode(session.credentials);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      markBackupSaved();
      toast('Backup code copied. Keep it somewhere safe, like a password manager.');
    } catch {
      toast('Couldn’t copy. Select the code and copy it by hand.');
    }
  };

  const download = () => {
    const text = `BookTrap backup code\n\n${code}\n\nEnter it in BookTrap under Settings, "Restore from a backup code", to open this shelf on another browser.\nAnyone with this code can open your shelf, so keep it private.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'booktrap-backup-code.txt';
    link.click();
    URL.revokeObjectURL(url);
    markBackupSaved();
  };

  const onRestore = async (event: FormEvent) => {
    event.preventDefault();
    setRestoreError(null);
    const decoded = decodeBackupCode(input);
    if (!decoded.ok) return setRestoreError(decoded.reason);
    if (decoded.credentials.deviceId === session.credentials.deviceId) {
      return setRestoreError('That’s the code for the shelf you’re already on.');
    }
    if (!window.confirm('Switch this browser to the shelf in the backup code? The shelf open here now stays reachable only with its own code.')) {
      return;
    }
    setRestoring(true);
    try {
      await restore(decoded.credentials);
      markBackupSaved();
      setInput('');
      toast('Shelf restored');
    } catch (error) {
      setRestoreError(
        error instanceof ApiRequestError && error.status === 401
          ? 'BookTrap doesn’t recognise that code. Check it against your saved copy.'
          : 'Couldn’t reach BookTrap. Try again in a moment.',
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Section id="backup" title="Backup code">
      <p className="mt-2 max-w-[56ch] text-sm text-text-muted">
        If this browser’s data is cleared, your shelf can only come back with this code. Save it somewhere safe. It also
        opens your shelf on another phone or computer. Anyone who has it can see and change your shelf.
      </p>

      {shown ? (
        <div className="mt-4">
          <p
            className="rounded-[16px] bg-surface-sunk px-4 py-3 font-mono text-[0.95rem] leading-relaxed tracking-[0.04em] break-all shadow-[inset_0_0_0_1px_var(--rule-accent)] select-all"
            aria-label="Your backup code"
          >
            {code}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void copy()}>
              <Copy size={18} aria-hidden="true" />
              Copy code
            </Button>
            <Button type="button" variant="quiet" onClick={download}>
              <DownloadSimple size={18} aria-hidden="true" />
              Download as a file
            </Button>
            <Button type="button" variant="quiet" onClick={() => setShown(false)}>
              Hide
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="quiet" onClick={() => setShown(true)} className="mt-4">
          Show my backup code
        </Button>
      )}

      <form onSubmit={(event) => void onRestore(event)} className="mt-8" noValidate>
        <label htmlFor={inputId} className="block text-[0.95rem] font-medium">
          Restore from a backup code
        </label>
        <p id={helpId} className="mt-0.5 text-sm text-text-muted">
          Opens the shelf the code belongs to on this browser.
        </p>
        <textarea
          id={inputId}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setRestoreError(null);
          }}
          rows={2}
          spellCheck={false}
          autoCapitalize="characters"
          aria-describedby={helpId}
          aria-invalid={restoreError ? true : undefined}
          placeholder="BT1X-XXXX-XXXX-…"
          className="field mt-2 font-mono"
        />
        {restoreError && (
          <p role="alert" className="mt-2 text-sm text-note-ink">
            {restoreError}
          </p>
        )}
        <Button type="submit" variant="quiet" disabled={!input.trim() || restoring} className="mt-3">
          {restoring ? 'Checking…' : 'Restore shelf'}
        </Button>
      </form>
    </Section>
  );
}

/** Custom shelves (tags): create, rename, delete. They export as Goodreads bookshelves. */
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
          <label htmlFor={inputId} className="block text-[0.95rem] font-medium">
            New shelf
          </label>
          <input
            id={inputId}
            value={name}
            maxLength={60}
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
            maxLength={60}
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
