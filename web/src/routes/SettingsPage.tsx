import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useDevice } from '../device/DeviceProvider';
import { BackupSection, Section, ShelvesSection } from '../components/SettingsSections';
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
      <DeviceSection />
      <BackupSection />
      <ShelvesSection />
      <AppearanceSection />
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
  if (!session) return null;

  const storage = !session.durable
    ? { text: 'Not saved. This browser is blocking storage.', tone: 'text-note-ink' }
    : persisted
      ? { text: 'Kept on this device', tone: 'text-success-ink' }
      : { text: 'Saved, but the browser may clear it if space runs low', tone: 'text-text' };

  return (
    <Section title="This device">
      <p className="mt-2 max-w-[52ch] text-sm text-text-muted">
        BookTrap has no accounts. Your shelf belongs to this browser, identified by a private key that never
        leaves it except to talk to BookTrap.
      </p>
      <dl className="mt-4">
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
