import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EnvelopeSimple, Trash, X } from '@phosphor-icons/react';
import { AccountError, useAccount } from '../account/account-context';
import { NetworkError } from '../api/client';
import { CodeField, Resend } from './AuthSheet';
import { Button } from './Button';
import { CaptchaSlot } from './CaptchaSlot';
import { Sheet } from './Sheet';

/**
 * Deleting an account: a code emailed to the account confirms it, so someone holding only a stolen
 * sign-in (an unlocked phone, a copied token) can't delete it. Guests have no email and confirm in place.
 */
export function DeleteAccountSheet({ open, onClose, email, count, onDeleted }: { open: boolean; onClose: () => void; email: string; count: number; onDeleted: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="delete-sheet-title">
      {open && <DeleteFlow onClose={onClose} email={email} count={count} onDeleted={onDeleted} />}
    </Sheet>
  );
}

function DeleteFlow({ onClose, email, count, onDeleted }: { onClose: () => void; email: string; count: number; onDeleted: () => void }) {
  const { sendDeleteCode, deleteAccount } = useAccount();
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const step = sentAt === null ? 'confirm' : 'code';

  // Each step starts on its first control: the safe "Keep my account" first, then the code field.
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('input, button[data-autofocus]')?.focus();
  }, [step]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendDeleteCode();
      setCode('');
      setSentAt(Date.now());
    } catch (failure) {
      setError(failure instanceof AccountError ? failure.message : 'Couldn’t send the code just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(code.replace(/\s/g, ''));
      onDeleted();
    } catch (failure) {
      // A lost answer may hide a delete that went through; trying again is safe either way.
      setError(
        failure instanceof AccountError
          ? failure.message
          : failure instanceof NetworkError
            ? 'Couldn’t reach BookTrap, so your account may not be deleted yet. Try again in a moment.'
            : 'Couldn’t delete your account just now. Nothing was removed. Try again in a moment.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-2 md:px-8 md:pt-7">
        <div>
          <h2 id="delete-sheet-title" className="font-display text-[1.55rem] leading-tight text-balance">
            Delete your account{count > 0 ? ` and all ${count} ${count === 1 ? 'book' : 'books'}?` : '?'}
          </h2>
          <p className="mt-1.5 max-w-[40ch] text-text-muted">Your shelf, shelves and history go for good, on every device. This can’t be undone.</p>
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
        {step === 'confirm' ? (
          <div className="space-y-5">
            <p className="text-[0.92rem]">
              To make sure it’s you, we’ll email a code to <span className="font-bold">{email}</span>.
            </p>
            <div className="space-y-2.5">
              <Button type="button" variant="quiet" data-autofocus className="w-full" onClick={onClose} disabled={busy}>
                Keep my account
              </Button>
              <Button type="button" variant="quiet" className="w-full text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]" onClick={() => void send()} disabled={busy}>
                <EnvelopeSimple size={20} weight="bold" aria-hidden="true" />
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
            </div>
            <CaptchaSlot className="-mt-5 data-[captcha-shown]:mt-0" />
          </div>
        ) : (
          <form onSubmit={(event) => void onDelete(event)} className="space-y-5">
            <p className="text-[0.92rem]">
              We sent a code to <span className="font-bold">{email}</span>. Enter it to delete your account.
            </p>
            <CodeField value={code} onChange={setCode} />
            <Button
              type="submit"
              variant="quiet"
              disabled={busy || code.replace(/\s/g, '').length < 6}
              className="w-full text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]"
            >
              <Trash size={18} weight="bold" aria-hidden="true" />
              {busy ? 'Deleting…' : 'Delete everything'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={onClose} disabled={busy}>
              Keep my account
            </Button>
            <Resend sentAt={sentAt!} disabled={busy} onResend={() => void send()} />
            <CaptchaSlot className="-mt-5 data-[captcha-shown]:mt-0" />
          </form>
        )}
        {error && (
          <p role="alert" className="rounded-[16px] bg-surface-sunk px-4 py-3 text-[0.92rem] text-note-ink shadow-[inset_0_0_0_1.5px_var(--note)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
