import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useDevice } from '../device/device-context';
import { Button } from '../components/Button';
import { BackupSection, Section, ShelvesSection } from '../components/SettingsSections';
import { useToast } from '../components/toast-context';
import { CONTACT_EMAIL, OPERATOR, contactHref } from '../legal';
import { NetworkError } from '../api/client';
import { useTheme, type Theme } from '../theme';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function SettingsPage() {
  const { hash } = useLocation();
  // Deep links like /settings#backup land on that section.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div className="max-w-[640px]">
      <h1 className="font-display text-[2.4rem] leading-[1.05] md:text-[3.1rem]">Settings</h1>
      <BackupSection />
      <ShelvesSection />
      <AppearanceSection />
      <DeviceSection />
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

function DeviceSection() {
  const { session, persisted } = useDevice();
  const usage = useQuery({
    queryKey: ['usage', session?.credentials.deviceId],
    queryFn: ({ signal }) => api.usage(session!.credentials, signal),
    enabled: Boolean(session),
  });
  if (!session) return null;

  const storage = !session.durable
    ? { text: 'Not saved. This browser is blocking storage.', tone: 'text-note-ink' }
    : persisted
      ? { text: 'Kept on this device', tone: 'text-success-ink' }
      : { text: 'Saved, but the browser may clear it if space runs low', tone: 'text-text' };

  return (
    <Section title="About this device">
      <p className="mt-2 max-w-[52ch] text-sm text-text-muted">
        BookTrap has no accounts. Your shelf belongs to this browser, identified by a private key that never
        leaves it except to talk to BookTrap.
      </p>
      <dl className="mt-4">
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
        <Row label="Device">
          <span className="font-medium tabular-nums">{session.me.deviceId.slice(0, 8)}</span>
        </Row>
        <Row label="Shelf started">{dateFormat.format(new Date(session.me.createdAt))}</Row>
        <Row label="Storage">
          <span className={storage.tone}>{storage.text}</span>
        </Row>
      </dl>
    </Section>
  );
}

/** Privacy (the right to erasure) and the brief's "clear data": deletes the shelf from the server, not just this browser. */
function DataSection() {
  const { session, deleteShelf } = useDevice();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  // Opening the confirmation moves focus to the safe choice.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  if (!session) return null;

  const onDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteShelf();
      toast('Your shelf is deleted. This is a new, empty one.');
    } catch (failure) {
      // A lost answer may hide a delete that went through; trying again is safe either way.
      setError(
        failure instanceof NetworkError
          ? 'Couldn’t reach BookTrap, so your shelf may not be deleted yet. Try again in a moment.'
          : 'Couldn’t delete your shelf just now. Nothing was removed. Try again in a moment.',
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

      <h3 className="mt-6 text-[0.95rem] font-bold">Delete my shelf</h3>
      <p className="mt-0.5 max-w-[56ch] text-sm text-text-muted">
        Removes every book, shelf, note and paste history from BookTrap&rsquo;s servers for good, and your backup code stops working.
        To keep a copy, export your shelf first from the{' '}
        <Link to="/shelf" className="underline">
          Shelf
        </Link>{' '}
        page.
      </p>

      {confirming ? (
        <div role="group" aria-labelledby="delete-confirm" className="mt-4 rounded-[16px] bg-surface-sunk p-4 shadow-[inset_0_0_0_1.5px_var(--note)]">
          <p id="delete-confirm" className="font-bold">
            Delete this shelf and everything on it? This can&rsquo;t be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button ref={keepRef} type="button" onClick={() => setConfirming(false)} disabled={deleting}>
              Keep my shelf
            </Button>
            <Button type="button" variant="quiet" onClick={() => void onDelete()} disabled={deleting} className="text-note-ink">
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-note-ink">
              {error}
            </p>
          )}
        </div>
      ) : (
        <Button type="button" variant="quiet" onClick={() => setConfirming(true)} className="mt-4 text-note-ink">
          Delete my shelf
        </Button>
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
