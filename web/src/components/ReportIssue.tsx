import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, EnvelopeSimple, X } from '@phosphor-icons/react';
import { useAccount } from '../account/account-context';
import { ISSUE_EMAIL } from '../legal';
import { issueDetails, issueMailto, issueReport, type IssueContext } from '../report/issue-report';
import { ReportIssueContext } from '../report/report-issue-context';
import { Button } from './Button';

/** Holds the one "Report an issue" sheet; anything inside opens it with `useReportIssue()`. */
export function ReportIssueProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<IssueContext | null>(null);
  // The control that opened it gets focus back on close (a toast's button is gone by then).
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((given: IssueContext = {}) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setContext(given);
  }, []);
  return (
    <ReportIssueContext.Provider value={open}>
      {children}
      {context && (
        <ReportIssueDialog
          context={context}
          onClose={() => {
            setContext(null);
            if (opener.current?.isConnected) opener.current.focus();
          }}
        />
      )}
    </ReportIssueContext.Provider>
  );
}

function accountLabel(user: ReturnType<typeof useAccount>['user']): string {
  if (!user) return 'Not loaded';
  return `${user.isGuest ? 'Guest' : 'Signed in'} (user ${user.id})`;
}

/**
 * "Report an issue" (user's pick: the reader's own mail app sends it). The error and the page are
 * filled in; the reader adds what happened and what they did. "Open email" writes it all into a new
 * email to the operator; "Copy report" is there for a computer with no mail app set up.
 */
export function ReportIssueDialog({ context, onClose }: { context: IssueContext; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { user } = useAccount();
  const [what, setWhat] = useState(context.error ?? '');
  const [steps, setSteps] = useState('');
  const [copied, setCopied] = useState<'yes' | 'blocked' | null>(null);
  const [opened, setOpened] = useState(false);
  // Fixed when the sheet opens, so the time is when the problem happened, not when Send was pressed.
  const [at] = useState(() => new Date());
  const ids = { title: useId(), what: useId(), steps: useId() };

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const meta = { context, page: window.location.pathname + window.location.search, browser: navigator.userAgent, account: accountLabel(user), at };
  const report = issueReport({ ...meta, what, steps });
  const details = issueDetails(meta);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${ISSUE_EMAIL}\nSubject: ${report.subject}\n\n${report.body}`);
      setCopied('yes');
    } catch {
      setCopied('blocked');
    }
  };

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={ids.title}
      onCancel={(event) => {
        // Esc closes this sheet only, never a sheet under it.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="report-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[480px] overflow-y-auto rounded-[24px] bg-ground-raised p-0 text-text shadow-[var(--elev-lift)] backdrop:bg-[rgb(31_28_36/0.6)]"
    >
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id={ids.title} className="font-display text-[1.4rem] leading-tight text-balance">
              Report an issue
            </h3>
            <p className="mt-1 text-[0.9rem] text-text-muted">Tell us what happened. It goes to the people who run BookTrap, and we read every one.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-pill text-text-muted hover:text-text">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div>
          <label htmlFor={ids.what} className="block text-[0.92rem] font-bold">
            What went wrong?
          </label>
          <textarea
            id={ids.what}
            value={what}
            onChange={(event) => setWhat(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="e.g. The shelf won’t load, or a book is missing"
            className="field mt-1.5 min-h-20 resize-y"
          />
        </div>

        <div>
          <label htmlFor={ids.steps} className="block text-[0.92rem] font-bold">
            What were you doing? <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <textarea
            id={ids.steps}
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="e.g. I pasted a TikTok link and pressed Find books"
            className="field mt-1.5 min-h-20 resize-y"
          />
        </div>

        <details className="rounded-[14px] bg-surface px-3.5 py-2.5 text-[0.85rem] shadow-[inset_0_0_0_1.5px_var(--rule)]">
          <summary className="cursor-pointer font-bold">Details added to the email</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-muted">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-bold">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </details>

        <div className="flex flex-wrap gap-2.5">
          <a
            href={issueMailto(report)}
            onClick={() => setOpened(true)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-action px-5 text-[0.92rem] font-bold text-on-action shadow-[inset_0_1px_0_rgb(255_255_255/0.12),var(--elev-soft)] transition-[background-color,transform] duration-200 ease-snappy hover:bg-action-hover active:scale-[0.97]"
          >
            <EnvelopeSimple size={18} weight="bold" aria-hidden="true" />
            Open email
          </a>
          <Button type="button" variant="quiet" onClick={() => void copy()} className="px-5 text-[0.92rem]">
            <Copy size={18} weight="bold" aria-hidden="true" />
            {copied === 'yes' ? 'Copied' : 'Copy report'}
          </Button>
        </div>

        <p role="status" className="text-[0.85rem] text-text-muted">
          {copied === 'blocked'
            ? `Your browser kept the clipboard closed. Select the details above and email them to ${ISSUE_EMAIL}.`
            : copied === 'yes'
              ? `Copied. Paste it into an email to ${ISSUE_EMAIL}.`
              : opened
                ? `No email app opened? Copy the report and send it to ${ISSUE_EMAIL}.`
                : `Opens your email app with everything filled in, addressed to ${ISSUE_EMAIL}.`}
        </p>
      </div>
    </dialog>,
    document.body,
  );
}
