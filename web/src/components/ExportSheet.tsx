import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowSquareOut, BracketsCurly, Books, CaretRight, Check, ClipboardText, FilePdf, Table, X } from '@phosphor-icons/react';
import { toExportJson, toGenericCsv, toGoodreadsCsv, toPlainText, type Book, type PlainTextOptions } from '@booktrap/shared';
import { api } from '../api/client';
import { useDevice } from '../device/device-context';
import { downloadFile, exportFileName } from '../library/export';
import { Sheet } from './Sheet';
import { useToast } from './toast-context';

export type ExportScope = 'all' | 'view' | 'selected';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The whole shelf, the books the current filters show, and the books ticked in select mode. */
  all: Book[];
  view: Book[];
  /** Only offered when filters are actually narrowing the shelf. */
  filtered: boolean;
  selected: Book[] | null;
  initialScope: ExportScope;
}

const TEXT_PREFS_KEY = 'booktrap.export.text';

function loadTextPrefs(): PlainTextOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(TEXT_PREFS_KEY) ?? '{}') as Partial<PlainTextOptions>;
    return { status: saved.status === true, numbering: saved.numbering === true };
  } catch {
    return { status: false, numbering: false };
  }
}

function saveTextPrefs(prefs: PlainTextOptions) {
  try {
    localStorage.setItem(TEXT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: the toggles simply aren't remembered.
  }
}

const plural = (count: number) => `${count} ${count === 1 ? 'book' : 'books'}`;

/** Export (brief §8): Goodreads CSV, PDF, plain text, CSV and JSON, for the whole shelf, this view or the selection. */
export function ExportSheet({ open, onClose, ...rest }: Props) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="export-title">
      {open && <ExportBody onClose={onClose} {...rest} />}
    </Sheet>
  );
}

function ExportBody({ onClose, all, view, filtered, selected, initialScope }: Omit<Props, 'open'>) {
  const { session } = useDevice();
  const toast = useToast();
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [textPrefs, setTextPrefs] = useState(loadTextPrefs);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStep, setPdfStep] = useState('');
  const scopeName = useId();
  // Closing the sheet abandons a PDF in progress: its cover requests stop and nothing downloads later.
  const pdfAbort = useRef<AbortController | null>(null);
  useEffect(() => () => pdfAbort.current?.abort(), []);

  const scopes: { value: ExportScope; label: string; books: Book[] }[] = [
    { value: 'all', label: 'Whole shelf', books: all },
    ...(filtered ? [{ value: 'view' as const, label: 'This view', books: view }] : []),
    ...(selected ? [{ value: 'selected' as const, label: 'Selected', books: selected }] : []),
  ];
  const books = (scopes.find((option) => option.value === scope) ?? scopes[0]!).books;
  const empty = books.length === 0;

  // The row that just finished says so on its own button for a moment, right where the reader tapped.
  const [done, setDone] = useState<string | null>(null);
  const doneTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(doneTimer.current), []);
  const markDone = (row: string) => {
    setDone(row);
    window.clearTimeout(doneTimer.current);
    doneTimer.current = window.setTimeout(() => setDone(null), 2200);
  };

  const save = (row: string, kind: string, extension: string, content: string, type: string) => {
    downloadFile(exportFileName(kind, extension), content, type);
    // The row's own "Saved" is the confirmation: a toast would sit over the sheet's controls.
    markDone(row);
  };

  const makePdf = async () => {
    if (!session || pdfBusy) return;
    const controller = new AbortController();
    pdfAbort.current = controller;
    const { signal } = controller;
    setPdfBusy(true);
    setPdfStep('Opening…');
    try {
      const { renderReadingListPdf } = await import('../library/pdf/renderPdf');
      const blob = await renderReadingListPdf(books, (bookId, version) => api.bookCover(session.credentials, bookId, version, signal), {
        signal,
        onProgress: (done, total) => setPdfStep(done < total ? `Covers ${done}/${total}` : 'Binding…'),
      });
      if (signal.aborted) return;
      downloadFile(exportFileName('reading-list', 'pdf'), blob);
      markDone('pdf');
    } catch {
      if (!signal.aborted) toast('Couldn’t make the PDF. Check your connection and try again.');
    } finally {
      if (!signal.aborted) setPdfBusy(false);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(books, textPrefs));
      markDone('text');
      toast(`Copied ${plural(books.length)}`);
    } catch {
      toast('Couldn’t copy. Your browser blocked the clipboard; try the CSV instead.');
    }
  };

  const toggleText = (key: keyof PlainTextOptions) => {
    const next = { ...textPrefs, [key]: !textPrefs[key] };
    setTextPrefs(next);
    saveTextPrefs(next);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-5 pb-4">
        <div>
          <h2 id="export-title" className="font-display text-[1.7rem] leading-tight">
            Export
          </h2>
          <p className="marginalia mt-1">take your shelf anywhere</p>
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

      <div className="flex-1 space-y-8 overflow-y-auto overscroll-contain px-5 py-6">
        {scopes.length === 1 ? (
          <div>
            <p className="font-bold">Your whole shelf, {plural(all.length)}</p>
            <p className="mt-1 text-sm text-text-muted">To export fewer, filter the shelf or select books first.</p>
          </div>
        ) : (
          <fieldset>
            <legend className="text-[0.95rem] font-bold">Which books</legend>
            <div className={`mt-2 grid rounded-pill bg-surface p-1 shadow-[inset_0_0_0_1.5px_var(--rule)] ${['grid-cols-1', 'grid-cols-2', 'grid-cols-3'][scopes.length - 1]}`}>
              {scopes.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-11 cursor-pointer flex-wrap items-center justify-center gap-x-1.5 rounded-pill px-2 text-center text-[0.88rem] leading-tight font-bold transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                    scope === option.value ? 'bg-accent text-on-tab' : 'text-text-muted hover:text-text'
                  }`}
                >
                  <input type="radio" name={scopeName} value={option.value} checked={scope === option.value} onChange={() => setScope(option.value)} className="sr-only" />
                  {option.label}
                  <span className="font-normal tabular-nums opacity-80">{option.books.length}</span>
                </label>
              ))}
            </div>
            {empty && <p className="mt-3 text-sm text-note-ink">No books here to export. Pick another set above.</p>}
          </fieldset>
        )}

        <Group title="For Goodreads and Fable">
          <FormatRow
            icon={<Books size={22} weight="duotone" aria-hidden="true" />}
            name="Goodreads CSV"
            hint="Statuses become Goodreads shelves, and your shelves come too."
            action="Download"
            done={done === 'goodreads' ? 'Saved' : null}
            disabled={empty}
            primary
            onRun={() => save('goodreads', 'goodreads', 'csv', toGoodreadsCsv(books), 'text/csv;charset=utf-8')}
          />
          <ImportNote />
        </Group>

        <Group title="To read or share">
          <FormatRow
            icon={<FilePdf size={22} weight="duotone" aria-hidden="true" />}
            name="PDF"
            hint="Your covers on a printable shelf, grouped by status."
            action={pdfBusy ? pdfStep : 'Download'}
            done={done === 'pdf' ? 'Saved' : null}
            busy={pdfBusy}
            disabled={empty || pdfBusy || !session}
            onRun={() => void makePdf()}
          />
          <div>
            <FormatRow
              icon={<ClipboardText size={22} weight="duotone" aria-hidden="true" />}
              name="Copy as text"
              hint="“Title by Author”, one per line."
              action="Copy"
              done={done === 'text' ? 'Copied' : null}
              disabled={empty}
              onRun={() => void copyText()}
            />
            <div className="mt-2 flex flex-wrap gap-2 pl-[3.75rem]" role="group" aria-label="Text options">
              <Toggle on={textPrefs.numbering} onClick={() => toggleText('numbering')}>
                Numbered
              </Toggle>
              <Toggle on={textPrefs.status} onClick={() => toggleText('status')}>
                With status
              </Toggle>
            </div>
          </div>
        </Group>

        <Group title="Your data">
          <FormatRow
            icon={<Table size={22} weight="duotone" aria-hidden="true" />}
            name="CSV"
            hint="Every detail, with the post each book came from."
            action="Download"
            done={done === 'csv' ? 'Saved' : null}
            disabled={empty}
            onRun={() => save('csv', 'books', 'csv', toGenericCsv(books), 'text/csv;charset=utf-8')}
          />
          <FormatRow
            icon={<BracketsCurly size={22} weight="duotone" aria-hidden="true" />}
            name="JSON"
            hint="The same, as a backup file for apps and scripts."
            action="Download"
            done={done === 'json' ? 'Saved' : null}
            disabled={empty}
            onRun={() => save('json', 'books', 'json', toExportJson(books), 'application/json')}
          />
        </Group>

        <p className="sr-only" aria-live="polite">
          {pdfBusy ? 'Making your PDF. It downloads when it’s ready.' : ''}
        </p>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="font-display text-[1.15rem]">
        {title}
      </h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function FormatRow({
  icon,
  name,
  hint,
  action,
  onRun,
  disabled,
  busy = false,
  done = null,
  primary = false,
}: {
  icon: ReactNode;
  name: string;
  hint: string;
  action: string;
  onRun: () => void;
  disabled: boolean;
  busy?: boolean;
  /** A short past-tense word ("Saved") shown on the button for a moment after it finishes. */
  done?: string | null;
  /** The sheet's one primary action (the Goodreads file, the main reason people export). */
  primary?: boolean;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-surface text-accent-ink shadow-[inset_0_0_0_1.5px_var(--rule)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{name}</span>
        <span className="block text-sm text-text-muted">{hint}</span>
      </span>
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        aria-busy={busy}
        aria-label={`${action} ${name}`}
        className={`min-h-11 min-w-26 shrink-0 rounded-pill px-4 text-[0.88rem] font-bold tabular-nums transition-[background-color,box-shadow,transform] duration-200 ease-snappy active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${
          primary && !done
            ? 'bg-action text-on-action shadow-[var(--elev-soft)] hover:bg-action-hover disabled:bg-surface-strong disabled:text-text-faint disabled:shadow-none'
            : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--rule)] hover:shadow-[inset_0_0_0_1.5px_var(--rule-accent)] disabled:text-text-faint'
        }`}
      >
        {done ? (
          <span className="inline-flex items-center gap-1 text-success-ink">
            <Check size={16} weight="bold" aria-hidden="true" />
            {done}
          </span>
        ) : (
          action
        )}
      </button>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-11 rounded-pill px-4 text-[0.85rem] font-bold transition-[background-color,transform] duration-200 ease-snappy active:scale-[0.97] ${
        on ? 'bg-accent text-on-tab' : 'text-text-muted shadow-[inset_0_0_0_1.5px_var(--rule)] hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

/** How to take the Goodreads file in (brief §8). BookTrap never signs in anywhere for the reader. */
function ImportNote() {
  return (
    <details className="group ml-[3.75rem]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[0.92rem] font-bold text-accent-ink">
        <CaretRight size={14} weight="bold" className="transition-transform group-open:rotate-90" aria-hidden="true" />
        How to bring it into Goodreads or Fable
      </summary>
      <ol className="mt-2 list-decimal space-y-3 pl-5 text-[0.92rem] text-text-muted marker:font-bold marker:text-accent-ink">
        <li>
          <span className="font-bold text-text">Goodreads:</span> on a computer, open{' '}
          <ExternalLink href="https://www.goodreads.com/review/import">Import and export</ExternalLink> (My Books, then Tools), choose the file and press
          Import books.
        </li>
        <li>
          <span className="font-bold text-text">Fable:</span> its import is in beta on the website. Sign in at{' '}
          <ExternalLink href="https://fable.co/goodreads-import">fable.co/goodreads-import</ExternalLink> with your app account and upload the same file.
          Fable emails you when it’s done.
        </li>
      </ol>
      <p className="mt-3 text-[0.92rem] text-text-muted">Upload the file as it is. Opening and saving it in Excel can scramble the ISBNs.</p>
    </details>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="py-3 font-bold text-accent-ink underline underline-offset-4 [box-decoration-break:clone]">
      {children}
      <ArrowSquareOut size={14} className="ml-1 inline align-[-2px]" aria-label="(opens in a new tab)" />
    </a>
  );
}
