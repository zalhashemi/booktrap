import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useDevice } from '../device/DeviceProvider';
import { useTheme, type Theme } from '../theme';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function SettingsPage() {
  return (
    <div className="max-w-[640px]">
      <h1 className="font-display text-[2.15rem] leading-[1.08] tracking-[-0.01em] md:text-[2.9rem]">Settings</h1>
      <DeviceSection />
      <AppearanceSection />
      <ServerSection />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-10 border-t border-rule pt-6">
      <h2 id={id} className="font-serif text-[1.3rem]">
        {title}
      </h2>
      {children}
    </section>
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
    ? { text: 'Not saved. This browser is blocking storage.', tone: 'text-rose-ink' }
    : persisted
      ? { text: 'Kept on this device', tone: 'text-emerald-ink' }
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
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];

  return (
    <Section title="Appearance">
      <fieldset className="mt-4">
        <legend className="sr-only">Theme</legend>
        <div className="inline-grid grid-cols-2 rounded-board p-1 shadow-[inset_0_0_0_1px_var(--rule)]">
          {options.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-11 min-w-[7rem] cursor-pointer items-center justify-center rounded-[2px] px-5 text-[0.95rem] transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${
                theme === option.value ? 'bg-surface-strong text-text' : 'text-text-muted hover:text-text'
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
  else if (health.isError) status = <span className="text-rose-ink">Unreachable right now</span>;
  else
    status = (
      <span className="text-emerald-ink">
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
