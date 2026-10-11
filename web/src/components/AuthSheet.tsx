import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { EnvelopeSimple, Eye, EyeSlash, Password, X } from '@phosphor-icons/react';
import { AccountError, useAccount, type LoginResult } from '../account/account-context';
import { useBooks } from '../library/hooks';
import { AuthSheetContext, type AuthSheetMode } from './auth-sheet-context';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { useToast } from './toast-context';

const MIN_PASSWORD = 8;
const RESEND_AFTER_S = 60;

/** Where the sheet is: an email first, then a password or a code, then (after a reset) a new password. */
type Step =
  | { name: 'email' }
  | { name: 'password' }
  | { name: 'code'; purpose: 'save' | 'login' | 'reset'; password?: string; sentAt: number }
  | { name: 'new-password' };

export function AuthSheetProvider({ children }: { children: ReactNode }) {
  const { user } = useAccount();
  const [mode, setMode] = useState<AuthSheetMode | null>(null);
  const openAuth = useCallback((next: AuthSheetMode) => setMode(next), []);
  const value = useMemo(() => ({ openAuth }), [openAuth]);
  return (
    <AuthSheetContext.Provider value={value}>
      {children}
      <Sheet open={mode !== null && user !== null} onClose={() => setMode(null)} labelledBy="auth-sheet-title">
        {mode && user && <AuthFlow key={mode} initialMode={mode} onClose={() => setMode(null)} />}
      </Sheet>
    </AuthSheetContext.Provider>
  );
}

function plural(count: number) {
  return `${count} ${count === 1 ? 'book' : 'books'}`;
}

function AuthFlow({ initialMode, onClose }: { initialMode: AuthSheetMode; onClose: () => void }) {
  const account = useAccount();
  const toast = useToast();
  const books = useBooks();
  const [mode, setMode] = useState<AuthSheetMode>(initialMode);
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountError | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const count = books.data?.length ?? 0;
  const isGuest = account.user?.isGuest ?? true;

  // Each step starts on its first field, so the keyboard (and a screen reader) lands where the work is.
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('input, button[data-autofocus]')?.focus();
  }, [step.name, mode]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof AccountError ? failure : new AccountError('unknown', 'Something went wrong on our side. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: AuthSheetMode) => {
    setMode(next);
    setStep({ name: 'email' });
    setPassword('');
    setCode('');
    setError(null);
  };

  const loggedIn = ({ merged, mergeFailed }: LoginResult) => {
    onClose();
    if (mergeFailed) {
      toast('You’re logged in, but the books from this browser couldn’t be added to your shelf yet.', {
        duration: 20_000,
        action: { label: 'Try again', run: () => void account.retryGuestMerge().then((result) => !result.mergeFailed && toast('The books from this browser joined your shelf.')) },
      });
    }
    else if (merged && merged.added + merged.folded > 0) {
      toast(`You’re logged in. ${plural(merged.added + merged.folded)} from this browser joined your shelf.`);
    } else toast('You’re logged in.');
  };

  const sendCode = (purpose: 'save' | 'login' | 'reset', withPassword?: string) =>
    run(async () => {
      if (purpose === 'save') await account.sendSaveCode(email.trim());
      else await account.sendLoginCode(email.trim());
      setCode('');
      setStep({ name: 'code', purpose, password: withPassword, sentAt: Date.now() });
    });

  const onEmail = (event: FormEvent, choice: 'code' | 'password') => {
    event.preventDefault();
    const form = (event.target as HTMLElement).closest('form');
    if (form && !form.reportValidity()) return;
    setError(null);
    if (choice === 'password') setStep({ name: 'password' });
    else void sendCode(mode === 'save' ? 'save' : 'login');
  };

  const onPassword = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'save') void sendCode('save', password);
    else void run(async () => loggedIn(await account.logInWithPassword(email.trim(), password)));
  };

  const onCode = (event: FormEvent) => {
    event.preventDefault();
    if (step.name !== 'code') return;
    const token = code.replace(/\s/g, '');
    if (step.purpose === 'save') {
      void run(async () => {
        await account.confirmSaveCode(email.trim(), token, step.password);
        onClose();
        toast(`Your shelf is saved. Log in with ${email.trim()} on any device.`);
      });
    } else {
      void run(async () => {
        const result = await account.confirmLoginCode(email.trim(), token);
        if (step.purpose === 'reset') {
          // Signed in by the code: the books (if any) already joined, now the new password.
          if (result.mergeFailed) toast('The books from this browser couldn’t be added to your shelf.');
          setPassword('');
          setStep({ name: 'new-password' });
        } else loggedIn(result);
      });
    }
  };

  const onNewPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await account.setPassword(password);
      onClose();
      toast('Your new password is set.');
    });
  };

  const back = () => {
    setError(null);
    setStep({ name: 'email' });
  };

  let title: string;
  let sub: string;
  if (step.name === 'code') {
    title = 'Check your email';
    sub = step.purpose === 'save' ? 'We sent a code to confirm it’s your email.' : 'We sent a code to log you in.';
  } else if (step.name === 'new-password') {
    title = 'Set a new password';
    sub = 'You’re logged in. Choose the password to use next time.';
  } else if (mode === 'save') {
    title = count > 0 ? `Keep your ${plural(count)}` : 'Save your shelf';
    sub = 'Add an email and BookTrap keeps this shelf for you, on any device.';
  } else {
    title = 'Welcome back';
    sub = 'Log in to open your saved shelf.';
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-2 md:px-8 md:pt-7">
        <div>
          <h2 id="auth-sheet-title" className="font-display text-[1.55rem] leading-tight text-balance">
            {title}
          </h2>
          <p className="mt-1.5 max-w-[40ch] text-text-muted">{sub}</p>
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

      <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pt-4 pb-8 md:px-8">
        {step.name === 'email' && (
          <form onSubmit={(event) => onEmail(event, 'code')} className="space-y-5">
            {mode === 'login' && isGuest && count > 0 && (
              <p className="rounded-[16px] bg-surface-sunk px-4 py-3 text-[0.92rem] shadow-[inset_0_0_0_1.5px_var(--rule-accent)]">
                The {plural(count)} on this browser join your account’s shelf when you log in.
              </p>
            )}
            <EmailField value={email} onChange={setEmail} />
            <div className="space-y-2.5">
              <p className="text-[0.92rem] font-bold text-text-muted">
                {mode === 'save' ? 'How do you want to sign in next time?' : 'How do you want to log in?'}
              </p>
              <Button type="submit" disabled={busy} className="w-full">
                <EnvelopeSimple size={20} weight="bold" aria-hidden="true" />
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
              <Button type="button" variant="quiet" disabled={busy} className="w-full" onClick={(event) => onEmail(event, 'password')}>
                <Password size={20} weight="bold" aria-hidden="true" />
                Use a password
              </Button>
            </div>
            <Problem error={error} onLogIn={mode === 'save' ? () => switchMode('login') : undefined} />
            {mode === 'save' && <Terms onNavigate={onClose} />}
            <p className="text-[0.88rem] text-text-muted">
              {mode === 'save' ? (
                <>
                  Already have an account?{' '}
                  <InlineButton onClick={() => switchMode('login')}>Log in</InlineButton>
                </>
              ) : isGuest ? (
                <>
                  New here?{' '}
                  <InlineButton onClick={() => switchMode('save')}>Save your shelf</InlineButton>
                </>
              ) : null}
            </p>
          </form>
        )}

        {step.name === 'password' && (
          <form onSubmit={onPassword} className="space-y-5">
            <EmailChip email={email} onChange={back} />
            <PasswordField
              label={mode === 'save' ? 'Create a password' : 'Password'}
              value={password}
              onChange={setPassword}
              hint={mode === 'save' ? `At least ${MIN_PASSWORD} characters.` : undefined}
              isNew={mode === 'save'}
            />
            {mode === 'login' && (
              <div className="-mt-2">
                <InlineButton onClick={() => void sendCode('reset')} disabled={busy}>
                  Forgot password?
                </InlineButton>
              </div>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? (mode === 'save' ? 'Sending…' : 'Logging in…') : mode === 'save' ? 'Continue' : 'Log in'}
            </Button>
            {mode === 'save' && <p className="text-[0.88rem] text-text-muted">Next, we’ll email you a code to confirm it’s your address.</p>}
            <Problem error={error} onLogIn={mode === 'save' ? () => switchMode('login') : undefined} />
            {mode === 'save' && <Terms onNavigate={onClose} />}
          </form>
        )}

        {step.name === 'code' && (
          <form onSubmit={onCode} className="space-y-5">
            <EmailChip email={email} onChange={back} />
            <CodeField value={code} onChange={setCode} />
            <Button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6} className="w-full">
              {busy ? 'Checking…' : step.purpose === 'save' ? 'Save my shelf' : 'Log in'}
            </Button>
            <Problem error={error} onLogIn={step.purpose === 'save' ? () => switchMode('login') : undefined} />
            <Resend sentAt={step.sentAt} disabled={busy} onResend={() => void sendCode(step.purpose, step.password)} />
          </form>
        )}

        {step.name === 'new-password' && (
          <form onSubmit={onNewPassword} className="space-y-5">
            <PasswordField label="New password" value={password} onChange={setPassword} hint={`At least ${MIN_PASSWORD} characters.`} isNew />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Saving…' : 'Save password'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
              Not now
            </Button>
            <Problem error={error} />
          </form>
        )}
      </div>
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.92rem] font-bold">
        Email
      </label>
      <input
        id={id}
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field"
      />
    </div>
  );
}

function PasswordField({ label, value, onChange, hint, isNew }: { label: string; value: string; onChange: (value: string) => void; hint?: string; isNew?: boolean }) {
  const id = useId();
  const hintId = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.92rem] font-bold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          required
          minLength={isNew ? MIN_PASSWORD : undefined}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? hintId : undefined}
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
      {hint && (
        <p id={hintId} className="mt-1.5 text-sm text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** One field for the whole code, so pasting it and the phone's "from Messages/Mail" suggestion both work. */
function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const hintId = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.92rem] font-bold">
        Code
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,12}"
        maxLength={12}
        required
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9 ]/g, ''))}
        aria-describedby={hintId}
        className="field max-w-[16rem] text-center font-bold tracking-[0.4em] tabular-nums text-[1.35rem]"
      />
      <p id={hintId} className="mt-1.5 text-sm text-text-muted">
        It works for an hour. Check spam if it isn’t there in a minute.
      </p>
    </div>
  );
}

function EmailChip({ email, onChange }: { email: string; onChange: () => void }) {
  return (
    <p className="inline-flex max-w-full min-h-11 items-center gap-1 rounded-pill bg-surface pr-1 pl-4 text-[0.92rem] font-bold shadow-[inset_0_0_0_1.5px_var(--rule)]">
      <span className="truncate">{email.trim()}</span>
      <InlineButton onClick={onChange} className="px-2">
        Change
      </InlineButton>
    </p>
  );
}

function Resend({ sentAt, disabled, onResend }: { sentAt: number; disabled: boolean; onResend: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const wait = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));
  if (wait > 0) {
    return (
      <p className="text-[0.88rem] text-text-muted tabular-nums">
        You can send a new code in {Math.floor(wait / 60)}:{String(wait % 60).padStart(2, '0')}.
      </p>
    );
  }
  return (
    <InlineButton onClick={onResend} disabled={disabled}>
      Send a new code
    </InlineButton>
  );
}

function Problem({ error, onLogIn }: { error: AccountError | null; onLogIn?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-[16px] bg-surface-sunk px-4 py-3 text-[0.92rem] text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
      <p>{error.message}</p>
      {error.code === 'email_taken' && onLogIn && (
        <InlineButton onClick={onLogIn} className="mt-1">
          Log in instead
        </InlineButton>
      )}
    </div>
  );
}

function Terms({ onNavigate }: { onNavigate: () => void }) {
  return (
    <p className="text-[0.85rem] text-text-muted">
      By saving your shelf you agree to the{' '}
      <Link to="/terms" onClick={onNavigate} className="font-bold text-accent-ink underline underline-offset-3">
        Terms
      </Link>{' '}
      and the{' '}
      <Link to="/privacy" onClick={onNavigate} className="font-bold text-accent-ink underline underline-offset-3">
        Privacy policy
      </Link>
      .
    </p>
  );
}

function InlineButton({ children, onClick, disabled, className = '' }: { children: ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`-my-2.5 inline-flex min-h-11 items-center font-bold text-accent-ink underline-offset-4 hover:underline disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}
