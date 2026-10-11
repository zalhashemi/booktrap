import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CloudCheck, CloudSlash, DownloadSimple, Eye, EyeSlash, Key, SignOut, Trash } from '@phosphor-icons/react';
import { toExportJson } from '@booktrap/shared';
import { AccountError, useAccount, useUser } from '../account/account-context';
import { api, NetworkError } from '../api/client';
import { useAuthSheet } from '../components/auth-sheet-context';
import { Button } from '../components/Button';
import { Section, ShelvesSection } from '../components/SettingsSections';
import { useToast } from '../components/toast-context';
import { downloadFile, exportFileName } from '../library/export';
import { useBooks } from '../library/hooks';
import { CONTACT_EMAIL, OPERATOR, contactHref } from '../legal';
import { useTheme, type Theme } from '../theme';

export function SettingsPage() {
  const { hash } = useLocation();
  // Deep links like /settings#backup land on that section.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div className="max-w-[640px]">
      <h1 className="font-display text-[2.4rem] leading-[1.05] md:text-[3.1rem]">Settings</h1>
      <AccountSection />
      <ShelvesSection />
      <AppearanceSection />
      <DataSection />
      <ServerSection />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 md:grid-cols-[11rem_1fr] md:gap-6">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Account first: for a guest, that the shelf isn't saved yet; signed in, the email, password and sign out. */
function AccountSection() {
  const user = useUser();
  const { signOut } = useAccount();
  const { openAuth } = useAuthSheet();
  const toast = useToast();
  const books = useBooks();
  const [changing, setChanging] = useState(false);
  const usage = useQuery({ queryKey: ['usage', user.id], queryFn: ({ signal }) => api.usage(signal) });
  const count = books.data?.length ?? 0;

  const today = (
    <Row label="Today">
      {usage.data ? (
        <span>
          <span className="font-bold tabular-nums">
            {usage.data.postsToday} of {usage.data.dailyLimit}
          </span>{' '}
          posts read. The count resets at midnight UTC.
        </span>
      ) : (
        <span className="text-text-muted">{usage.isError ? 'Couldn’t check just now.' : 'Checking…'}</span>
      )}
    </Row>
  );

  if (user.isGuest) {
    return (
      <Section id="account" title="Account">
        <p className="mt-2 inline-flex items-center gap-1.5 font-bold text-note-ink">
          <CloudSlash size={20} weight="bold" aria-hidden="true" />
          Guest shelf, not saved
        </p>
        <p className="mt-1.5 max-w-[52ch] text-text-muted">
          {count > 0 ? `Your ${count === 1 ? 'book lives' : `${count} books live`} in this browser only.` : 'Your shelf lives in this browser only.'} A guest
          shelf is deleted after 30 days without a visit. Saving it with an email also raises your daily limit.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => openAuth('save')}>
            Save my shelf
          </Button>
          <Button type="button" variant="quiet" onClick={() => openAuth('login')}>
            Log in
          </Button>
        </div>
        <dl className="mt-4">{today}</dl>
      </Section>
    );
  }

  const onSignOut = async () => {
    try {
      await signOut();
      toast('Signed out. This browser now has a new, empty guest shelf.');
    } catch (failure) {
      toast(failure instanceof AccountError ? failure.message : 'Couldn’t sign out just now. Try again.');
    }
  };

  return (
    <Section id="account" title="Account">
      <p className="mt-2 inline-flex items-center gap-1.5 font-bold text-success-ink">
        <CloudCheck size={20} weight="fill" aria-hidden="true" />
        Shelf saved to your account
      </p>
      <dl className="mt-3 divide-y-[1.5px] divide-rule">
        <Row label="Email">
          <span className="font-bold break-all">{user.email}</span>
        </Row>
        <Row label="Password">
          {changing ? (
            <PasswordForm onDone={() => setChanging(false)} />
          ) : (
            <Button type="button" variant="quiet" onClick={() => setChanging(true)} className="min-h-11 px-4 text-[0.92rem]">
              <Key size={18} weight="bold" aria-hidden="true" />
              Set a new password
            </Button>
          )}
        </Row>
        <Row label="This browser">
          <Button type="button" variant="quiet" onClick={() => void onSignOut()} className="min-h-11 px-4 text-[0.92rem]">
            <SignOut size={18} weight="bold" aria-hidden="true" />
            Sign out
          </Button>
        </Row>
        {today}
      </dl>
    </Section>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { setPassword } = useAccount();
  const toast = useToast();
  const id = useId();
  const hintId = useId();
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setPassword(value);
      toast('Your new password is set.');
      onDone();
    } catch (failure) {
      setError(failure instanceof AccountError ? failure.message : 'Couldn’t save the password. Try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="max-w-[22rem] space-y-3">
      <label htmlFor={id} className="sr-only">
        New password
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={hintId}
          className="field pr-12"
        />
        <button
          type="button"
          onClick={() => setShown((now) => !now)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute top-0.5 right-1 flex size-11 items-center justify-center rounded-pill text-text-muted hover:text-text"
        >
          {shown ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
      <p id={hintId} className="text-sm text-text-muted">
        At least 8 characters.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-11 px-5 text-[0.92rem]">
          {busy ? 'Saving…' : 'Save password'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy} className="min-h-11 px-4 text-[0.92rem]">
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-note-ink">
          {error}
        </p>
      )}
    </form>
  );
}

/** Privacy (the right to erasure and to a copy) and the brief's "clear data": deletes on the server, not just this browser. */
function DataSection() {
  const user = useUser();
  const { deleteAccount } = useAccount();
  const books = useBooks();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const count = books.data?.length ?? 0;
  const thing = user.isGuest ? 'shelf' : 'account';

  // Opening the confirmation moves focus to the safe choice.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  const download = () => {
    if (!books.data) return;
    downloadFile(exportFileName('booktrap-my-data', 'json'), toExportJson(books.data), 'application/json');
  };

  const onDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      toast(user.isGuest ? 'Your shelf is deleted. This is a new, empty one.' : 'Your account is deleted. This browser has a new, empty guest shelf.');
    } catch (failure) {
      // A lost answer may hide a delete that went through; trying again is safe either way.
      setError(
        failure instanceof NetworkError
          ? `Couldn’t reach BookTrap, so your ${thing} may not be deleted yet. Try again in a moment.`
          : `Couldn’t delete your ${thing} just now. Nothing was removed. Try again in a moment.`,
      );
      setDeleting(false);
    }
  };

  return (
    <Section id="your-data" title="Your data">
      <p className="mt-2 max-w-[56ch] text-sm text-text-muted">
        Read how BookTrap handles your data in the{' '}
        <Link to="/privacy" className="underline">
          privacy policy
        </Link>{' '}
        and the{' '}
        <Link to="/terms" className="underline">
          terms
        </Link>
        . Questions or removal requests go to {OPERATOR} at{' '}
        <a href={contactHref()} className="underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="quiet" onClick={download} disabled={!books.data}>
          <DownloadSimple size={18} weight="bold" aria-hidden="true" />
          Download my data
        </Button>
        {!confirming && (
          <Button type="button" variant="quiet" onClick={() => setConfirming(true)} className="text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
            <Trash size={18} weight="bold" aria-hidden="true" />
            {user.isGuest ? 'Delete my shelf' : 'Delete account'}
          </Button>
        )}
      </div>
      <p className="mt-2 max-w-[56ch] text-sm text-text-muted">
        The download is every book with its sources, shelves and notes, as JSON.
      </p>

      {confirming && (
        <div role="group" aria-labelledby="delete-confirm" className="mt-4 rounded-[16px] bg-surface-sunk p-4 shadow-[inset_0_0_0_1.5px_var(--note)]">
          <p id="delete-confirm" className="font-display text-[1.2rem] leading-snug">
            {user.isGuest ? 'Delete this shelf' : 'Delete your account'}
            {count > 0 ? ` and all ${count} ${count === 1 ? 'book' : 'books'}?` : '?'}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {user.isGuest
              ? 'Every book, shelf, note and paste history goes for good. This can’t be undone.'
              : 'Your shelf, shelves and history go for good, on every device. This can’t be undone.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button ref={keepRef} type="button" variant="quiet" onClick={() => setConfirming(false)} disabled={deleting}>
              {user.isGuest ? 'Keep my shelf' : 'Keep my account'}
            </Button>
            <Button type="button" variant="quiet" onClick={() => void onDelete()} disabled={deleting} className="text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
              <Trash size={18} weight="bold" aria-hidden="true" />
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-note-ink">
              {error}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <Section title="Appearance">
      <fieldset className="mt-4">
        <legend className="sr-only">Theme</legend>
        <div className="inline-grid grid-cols-2 rounded-pill bg-surface-sunk p-1 shadow-[inset_0_0_0_1.5px_var(--rule)]">
          {options.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-11 min-w-[7rem] cursor-pointer items-center justify-center rounded-pill px-5 text-[0.95rem] font-bold transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                theme === option.value ? 'bg-accent text-on-tab' : 'text-text-muted hover:text-text'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    </Section>
  );
}

function ServerSection() {
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), retry: false });

  let status: ReactNode;
  if (health.isPending) status = <span className="text-text-muted">Checking</span>;
  else if (health.isError) status = <span className="text-note-ink">Unreachable right now</span>;
  else
    status = (
      <span className="text-success-ink">
        Connected
        {health.data.storage === 'memory' && (
          <span className="text-text-muted"> (development storage, wiped on restart)</span>
        )}
      </span>
    );

  return (
    <Section title="Server">
      <dl className="mt-4">
        <Row label="Status">{status}</Row>
      </dl>
    </Section>
  );
}
