import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowSquareOut, Copy, DotsThreeVertical, Flag, WarningCircle, X } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { LIMITS, PLATFORM_LABELS, REPORT_REASONS, REPORT_REASON_LABELS, type BookSource, type ReportReason } from '@booktrap/shared';
import { ApiRequestError, api } from '../api/client';
import { Button } from './Button';
import { useToast } from './toast-context';

const whoOf = (source: BookSource) => (source.creatorHandle ? `@${source.creatorHandle}` : `this ${PLATFORM_LABELS[source.platform]}`);

/**
 * The "more" button on a source in the book sheet (user's pick, option C): Open post, Copy link and
 * Report this post. Arrow keys move between items; Esc closes the menu, not the sheet.
 */
export function SourceMenu({ source }: { source: BookSource }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const toast = useToast();

  // Opening puts focus on the first item; a tap anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      // The sheet is a modal dialog: without this, Esc would close the whole sheet.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const copy = async () => {
    close();
    try {
      await navigator.clipboard.writeText(source.url);
      toast('Link copied');
    } catch {
      toast('Your browser kept the clipboard closed. Open the post and copy its link there.');
    }
  };

  const itemClass =
    'flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[0.92rem] font-bold outline-none hover:bg-surface-sunk focus-visible:bg-surface-sunk focus-visible:outline-2 focus-visible:outline-[var(--focus)]';

  return (
    <div ref={wrap} className="relative shrink-0" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={button}
        type="button"
        aria-label={`More for ${whoOf(source)}’s post`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`flex size-11 items-center justify-center rounded-pill text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text ${open ? 'bg-surface text-text' : ''}`}
      >
        <DotsThreeVertical size={20} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`${whoOf(source)}’s post`}
          className="absolute top-0 right-12 z-10 grid w-56 gap-0.5 rounded-[16px] bg-surface p-1.5 shadow-[inset_0_0_0_1.5px_var(--rule),var(--elev-lift)]"
        >
          <a role="menuitem" href={source.url} target="_blank" rel="noreferrer" onClick={() => close(false)} className={itemClass}>
            <ArrowSquareOut size={18} aria-hidden="true" />
            Open post
          </a>
          <button role="menuitem" type="button" onClick={() => void copy()} className={itemClass}>
            <Copy size={18} aria-hidden="true" />
            Copy link
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              close(false);
              setReporting(true);
            }}
            className={`${itemClass} text-note-ink`}
          >
            <Flag size={18} aria-hidden="true" />
            Report this post
          </button>
        </div>
      )}
      {reporting && (
        <ReportDialog
          source={source}
          onClose={(sent) => {
            setReporting(false);
            button.current?.focus();
            if (sent) toast('Reported. Thanks, we’ll take a look.');
          }}
        />
      )}
    </div>
  );
}

/**
 * Why the post is reported, and an optional note (needed for Other). A modal over the book sheet,
 * rendered into the body: the sheet is itself a form, and forms can't nest. As the newest modal
 * dialog it is on top, and everything under it (the sheet included) is inert.
 */
function ReportDialog({ source, onClose }: { source: BookSource; onClose: (sent: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  // Shown next to what it's about: the reasons, the note, or (sending failed) above the buttons.
  const [error, setError] = useState<{ on: 'reason' | 'note' | 'send'; message: string } | null>(null);
  const ids = { title: useId(), note: useId(), noteHelp: useId(), error: useId() };
  const send = useMutation({ mutationFn: () => api.reportPost({ platform: source.platform, postId: source.postId, reason: reason!, note: note.trim() || null }) });
  const needsNote = reason === 'other';

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // React events bubble through portals: this form's submit must not reach the book sheet's form.
    event.stopPropagation();
    if (!reason) return setError({ on: 'reason', message: 'Choose what’s wrong with the post.' });
    if (needsNote && !note.trim()) return setError({ on: 'note', message: 'Tell us what’s wrong in the note.' });
    setError(null);
    send.mutate(undefined, {
      onSuccess: () => onClose(true),
      onError: (failure) =>
        setError({ on: 'send', message: failure instanceof ApiRequestError ? failure.message : 'Couldn’t send the report. Check your connection and try again.' }),
    });
  };

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={ids.title}
      onCancel={(event) => {
        // Esc closes this dialog only, never the book sheet under it.
        event.preventDefault();
        event.stopPropagation();
        onClose(false);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose(false);
      }}
      className="report-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[440px] overflow-y-auto rounded-[24px] bg-ground-raised p-0 text-text shadow-[var(--elev-lift)] backdrop:bg-[rgb(31_28_36/0.6)]"
    >
      <form onSubmit={submit} noValidate className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 id={ids.title} className="font-display text-[1.4rem] leading-tight text-balance">
            Report {whoOf(source)}’s post
          </h3>
          <button type="button" onClick={() => onClose(false)} aria-label="Close" className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-pill text-text-muted hover:text-text">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <fieldset className="grid gap-2" aria-describedby={error?.on === 'reason' ? ids.error : undefined}>
          <legend className="mb-2 text-[0.95rem] font-bold">What’s wrong with it?</legend>
          {error?.on === 'reason' && <FieldError id={ids.error} message={error.message} />}
          {REPORT_REASONS.map((value) => (
            <label
              key={value}
              className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-[14px] bg-surface px-3.5 py-2.5 transition-shadow duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                reason === value ? 'shadow-[inset_0_0_0_2px_var(--accent-ink)]' : 'shadow-[inset_0_0_0_1.5px_var(--rule)] hover:shadow-[inset_0_0_0_1.5px_var(--text-faint)]'
              }`}
            >
              <input
                type="radio"
                name="reason"
                value={value}
                checked={reason === value}
                onChange={() => {
                  setReason(value);
                  setError(null);
                }}
                className="mt-1 size-[18px] shrink-0 accent-[var(--accent-ink)]"
              />
              <span>
                <span className="block text-[0.95rem] font-bold">{REPORT_REASON_LABELS[value].label}</span>
                <span className="block text-[0.85rem] leading-snug text-text-muted">{REPORT_REASON_LABELS[value].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div>
          <label htmlFor={ids.note} className="block text-[0.92rem] font-bold">
            Note {needsNote ? null : <span className="font-normal text-text-muted">(optional)</span>}
          </label>
          <textarea
            id={ids.note}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError(null);
            }}
            rows={3}
            maxLength={LIMITS.reportNoteChars}
            required={needsNote}
            aria-describedby={error?.on === 'note' ? `${ids.error} ${ids.noteHelp}` : ids.noteHelp}
            aria-invalid={error?.on === 'note' || undefined}
            placeholder={reason === 'mine' ? 'Your handle, so we know it’s you' : 'Anything that helps us check it'}
            className="field mt-1.5 min-h-20 resize-y aria-invalid:border-[var(--note-ink)]"
          />
          {error?.on === 'note' && <FieldError id={ids.error} message={error.message} />}
          <p id={ids.noteHelp} className="mt-1.5 text-[0.85rem] text-text-muted">
            Only BookTrap sees reports. The creator isn’t told who sent it.
          </p>
        </div>

        {error?.on === 'send' && <FieldError id={ids.error} message={error.message} />}

        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" disabled={send.isPending} className="px-5 text-[0.92rem]">
            <Flag size={18} weight="bold" aria-hidden="true" />
            {send.isPending ? 'Sending…' : 'Send report'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onClose(false)} className="px-5 text-[0.92rem]">
            Cancel
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm font-bold text-note-ink">
      <WarningCircle size={18} weight="fill" className="mt-px shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
