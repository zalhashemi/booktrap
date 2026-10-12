import { useEffect, useState, type ReactNode } from 'react';
import { AccountError, useAccount } from '../account/account-context';
import { Button } from './Button';
import { CaptchaSlot } from './CaptchaSlot';

/** After this long, say it's taking longer than usual. */
const SLOW_AFTER_MS = 4000;

/** `open` pages (the privacy policy and terms) render whatever the shelf's state. */
export function ConnectionGate({ open = false, children }: { open?: boolean; children: ReactNode }) {
  const { status, error, retry } = useAccount();

  if (open || status === 'ready') return <>{children}</>;
  if (status === 'loading') return <Opening />;

  const copy = describe(error);
  return (
    <section role="alert" className="max-w-[34rem] pt-10">
      <h1 className="font-display text-[2rem] leading-tight">{copy.title}</h1>
      <p className="mt-3 text-text-muted">{copy.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={retry}>Try again</Button>
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
    <section aria-live="polite" aria-busy="true" className="group max-w-[34rem] pt-10">
      <p className="font-display text-[1.6rem] leading-tight">Opening your shelf</p>
      <div className="mt-5 h-[2px] w-full overflow-hidden rounded-full bg-rule" aria-hidden="true">
        <div className="h-full w-1/3 animate-[shelf-sweep_1.4s_ease-in-out_infinite] bg-accent" />
      </div>
      {/* Cloudflare wants a click: say so in place of "taking longer", with the checkbox right below. */}
      <p className="mt-5 hidden text-text-muted group-has-[[data-captcha-shown]]:block">One quick check first. Tick the box to open your shelf.</p>
      <CaptchaSlot className="data-[captcha-shown]:mt-4" />
      {slow && (
        <p className="mt-5 text-text-muted group-has-[[data-captcha-shown]]:hidden">
          This is taking longer than usual. Hang on a moment.
        </p>
      )}
    </section>
  );
}

function describe(error: Error | null): { title: string; body: string } {
  if (error instanceof AccountError && error.code === 'network') {
    return {
      title: 'Can’t reach BookTrap',
      body: 'Check your connection and try again.',
    };
  }
  if (error instanceof AccountError && error.code === 'captcha') {
    return { title: 'Couldn’t check this browser', body: error.message };
  }
  if (error instanceof AccountError && error.code === 'rate_limited') {
    return { title: 'Too many new shelves from this network', body: 'Wait a few minutes, then try again.' };
  }
  return {
    title: 'Something went wrong on our side',
    body: 'Your shelf is safe. Try again in a moment.',
  };
}
