import { useEffect, useState, type ReactNode } from 'react';
import { ERROR_CODES } from '@booktrap/shared';
import { ApiRequestError, NetworkError } from '../api/client';
import { useDevice } from '../device/device-context';
import { Button } from './Button';

/** After this long, explain that the free server may be waking up. */
const SLOW_AFTER_MS = 4000;

/** `open` pages (the privacy policy and terms) render whatever the shelf's state. */
export function ConnectionGate({ open = false, children }: { open?: boolean; children: ReactNode }) {
  const { status, error, retry, startFresh } = useDevice();

  if (open || status === 'ready') return <>{children}</>;
  if (status === 'loading') return <Opening />;

  const copy = describe(error);
  return (
    <section role="alert" className="max-w-[34rem] pt-10">
      <h1 className="font-display text-[2rem] leading-tight">{copy.title}</h1>
      <p className="mt-3 text-text-muted">{copy.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {copy.fresh ? (
          <Button onClick={startFresh}>Start a fresh shelf</Button>
        ) : (
          <Button onClick={retry}>Try again</Button>
        )}
      </div>
    </section>
  );
}

function Opening() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section aria-live="polite" aria-busy="true" className="max-w-[34rem] pt-10">
      <p className="font-display text-[1.6rem] leading-tight">Opening your shelf</p>
      <div className="mt-5 h-[2px] w-full overflow-hidden rounded-full bg-rule" aria-hidden="true">
        <div className="h-full w-1/3 animate-[shelf-sweep_1.4s_ease-in-out_infinite] bg-accent" />
      </div>
      {slow && (
        <p className="mt-5 text-text-muted">
          The BookTrap server naps when it&rsquo;s quiet. Waking it can take up to a minute.
        </p>
      )}
    </section>
  );
}

function describe(error: Error | null): { title: string; body: string; fresh?: boolean } {
  if (error instanceof NetworkError) {
    return {
      title: 'Can’t reach BookTrap',
      body: 'Check your connection and try again. If the server was asleep, it may need another moment to wake up.',
    };
  }
  if (error instanceof ApiRequestError) {
    if (error.code === ERROR_CODES.deviceExists || error.status === 401) {
      return {
        title: 'This device’s key was rejected',
        body: 'This shelf may have been deleted, or the key saved in this browser doesn’t match our records, so it can’t be opened here. You can start a fresh, empty shelf on this device.',
        fresh: true,
      };
    }
    if (error.code === ERROR_CODES.rateLimited) {
      return { title: 'Too many tries', body: 'Wait a minute, then try again.' };
    }
  }
  return {
    title: 'Something went wrong on our side',
    body: 'Your shelf is safe. Try again in a moment.',
  };
}
