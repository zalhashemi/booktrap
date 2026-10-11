import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowBendLeftUp, ClipboardText, CloudSlash, LockSimple, Sparkle, X } from '@phosphor-icons/react';
import {
  ERROR_CODES,
  FREE_VIDEOS_PER_COLLECTION,
  PLATFORM_LABELS,
  PRIVATE_COLLECTION_MESSAGE,
  countUnreadableLinks,
  extractSourceLinks,
  linkKey,
  type SourceLink,
} from '@booktrap/shared';
import { ApiRequestError, NetworkError } from '../api/client';
import { Button } from '../components/Button';
import { JobPanel } from '../components/JobPanel';
import { ReadingRoomStrip } from '../components/LibraryBackdrop';
import { useUser } from '../account/account-context';
import { useAuthSheet } from '../components/auth-sheet-context';
import { useBooks, useCreateJob } from '../library/hooks';
import { PlatformIcon } from '../components/PlatformIcon';
import { describeKind, summarize } from '../library/links';

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof NetworkError) return 'Can’t reach BookTrap right now. Your links are still here, try again in a moment.';
  return 'Something went wrong. Try again.';
}

/** Reading the clipboard needs the async Clipboard API (and a secure page); older browsers just paste by hand. */
const canReadClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

export function AddPage() {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const helpId = useId();
  const errorId = useId();
  const [text, setText] = useState('');
  // The latest text, read when a send finishes (kept in step from the change handler, never during render).
  const latestText = useRef('');
  // Links the reader took out of the preview; they stay in the text box but aren't sent.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const found = useMemo(() => extractSourceLinks(text), [text]);
  const links = found.filter((link) => link.kind !== 'private_collection' && !removed.has(linkKey(link)));
  const privateCollections = found.filter((link) => link.kind === 'private_collection');
  const unreadable = useMemo(() => countUnreadableLinks(text), [text]);
  const createJob = useCreateJob();
  const user = useUser();
  const { openAuth } = useAuthSheet();

  const changeText = (value: string) => {
    latestText.current = value;
    setText(value);
    setPasteNote(null);
    if (!value.trim()) setRemoved(new Set());
    if (createJob.isError) createJob.reset();
  };

  /** The phone shortcut: one tap pastes what the reader just copied from TikTok or Instagram. */
  const pasteFromClipboard = async () => {
    try {
      const copied = (await navigator.clipboard.readText()).trim();
      if (!copied) {
        setPasteNote('Nothing copied yet. Copy a link in TikTok or Instagram first.');
        return;
      }
      changeText(copied);
    } catch {
      setPasteNote('Your browser kept the clipboard private. Tap the box and paste.');
      field.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (links.length === 0 || createJob.isPending) return;
    const submitted = text;
    createJob.mutate(
      links.map((link) => link.url),
      // Clear only what was sent: anything typed while the request was in flight is kept.
      {
        onSuccess: () => {
          // Typed more while it was sending: keep the text and the reader's set-asides.
          if (latestText.current !== submitted) return;
          latestText.current = '';
          setText('');
          setRemoved(new Set());
        },
      },
    );
  };

  const status =
    text.trim() && found.length === 0
      ? 'No TikTok or Instagram links in this text yet.'
      : links.length
        ? summarize(links)
        : found.some((link) => link.kind !== 'private_collection')
          ? 'Every link is set aside. Put one back to send it.'
          : null;

  return (
    // Desktop: paste on the left, progress alongside it, so you can watch links you just pasted.
    <div className="grid gap-10 lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)] lg:gap-12">
      <div>
        {/* Below 1240px there are no side wings, so a slice of the reading room sits above the headline. */}
        <ReadingRoomStrip className="mb-4 min-[1240px]:hidden" />
        <h1 className="font-display text-[2.3rem] leading-[1.06] md:text-[3.1rem]">
          Paste a post.
          <br />
          Catch every book in it.
        </h1>
        <p className="mt-3 max-w-[48ch] text-[1.05rem] text-text-muted md:mt-4">
          TikTok or Instagram: videos, carousels, reels and collections.
          <span className="hidden md:inline"> BookTrap reads the covers, spines, captions and speech, then shelves each book for you.</span>
        </p>

        <SaveShelfCard />

        <form
          className="mt-6 rounded-card md:mt-8 bg-surface p-4 shadow-[var(--elev-soft),inset_0_0_0_1.5px_var(--rule)] md:p-6"
          onSubmit={onSubmit}
          noValidate
        >
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={fieldId} className="text-[1rem] font-bold">
              TikTok or Instagram links
            </label>
            <span className="marginalia hidden text-[0.95rem] sm:inline" aria-hidden="true">
              share links work too!
            </span>
          </div>
          <div className="relative mt-3">
            <textarea
              ref={field}
              id={fieldId}
              name="links"
              rows={4}
              value={text}
              onChange={(event) => changeText(event.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby={`${helpId}${createJob.isError ? ` ${errorId}` : ''}`}
              aria-invalid={createJob.isError || undefined}
              placeholder={canReadClipboard ? '' : 'Paste one link per line, or a whole message'}
              className="field min-h-32 resize-y leading-relaxed"
            />
            {canReadClipboard && !text && (
              // Sits over the empty field; the field itself still takes typing and a long-press paste.
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void pasteFromClipboard()}
                  className="pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-pill bg-action px-5 font-bold text-on-action shadow-[var(--elev-soft)] transition-[background-color,transform] duration-200 ease-snappy hover:bg-action-hover active:scale-[0.97]"
                >
                  <ClipboardText size={20} weight="bold" aria-hidden="true" />
                  Paste what you copied
                </button>
                <span className="marginalia text-[0.98rem] sm:hidden" aria-hidden="true">
                  share links work too!
                </span>
              </div>
            )}
          </div>
          <p
            id={helpId}
            className={`mt-2.5 flex min-h-6 items-center gap-1.5 text-sm ${links.length ? 'font-bold text-success-ink' : 'text-text-muted'}`}
            aria-live="polite"
          >
            {links.length > 0 && <Sparkle size={16} weight="fill" aria-hidden="true" />}
            {pasteNote ?? status ?? 'BookTrap picks the links out of anything you paste.'}
          </p>

          {found.length > 0 && (
            <LinkPreview
              links={found}
              removed={removed}
              onToggle={(link) =>
                setRemoved((current) => {
                  const next = new Set(current);
                  if (!next.delete(linkKey(link))) next.add(linkKey(link));
                  return next;
                })
              }
            />
          )}
          {links.some((link) => link.kind === 'collection') && (
            <p className="marginalia mt-3 text-[0.95rem]">reads up to {FREE_VIDEOS_PER_COLLECTION} videos per collection</p>
          )}
          {unreadable > 0 && (
            <p className="mt-3 text-sm text-text-muted">
              {unreadable === 1 ? '1 TikTok or Instagram link isn’t a post' : `${unreadable} TikTok or Instagram links aren’t posts`} BookTrap can read
              (a profile or a search page, say), so {unreadable === 1 ? 'it’s' : 'they’re'} left out.
            </p>
          )}
          {privateCollections.length > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-field bg-surface-sunk px-3.5 py-3 text-sm">
              <LockSimple size={18} weight="bold" className="mt-0.5 shrink-0 text-note-ink" aria-hidden="true" />
              {PRIVATE_COLLECTION_MESSAGE}
            </p>
          )}

          <Button type="submit" disabled={links.length === 0 || createJob.isPending} className="mt-4 h-14 w-full text-[1.05rem]">
            {createJob.isPending ? 'Sending…' : links.length > 1 ? `Catch books from ${links.length} links` : 'Catch books'}
          </Button>
          {createJob.isError && (
            <div id={errorId} role="alert" className="mt-3 text-sm text-note-ink">
              <p>{errorMessage(createJob.error)}</p>
              {user.isGuest && createJob.error instanceof ApiRequestError && createJob.error.code === ERROR_CODES.limitReached && (
                <button
                  type="button"
                  onClick={() => openAuth('save')}
                  className="-my-1 inline-flex min-h-11 items-center font-bold text-accent-ink underline-offset-4 hover:underline"
                >
                  Save my shelf
                </button>
              )}
            </div>
          )}
        </form>
      </div>

      <div className="lg:pt-2">
        <JobPanel />
      </div>
    </div>
  );
}

/** The parsed links, one chip each, with the platform shown and a way to set a link aside before sending. */
function LinkPreview({ links, removed, onToggle }: { links: SourceLink[]; removed: Set<string>; onToggle: (link: SourceLink) => void }) {
  return (
    <ul aria-label="Links found" className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
      {links.map((link) => {
        const key = linkKey(link);
        const off = removed.has(key);
        const locked = link.kind === 'private_collection';
        const name = `${PLATFORM_LABELS[link.platform]} ${describeKind(link).toLowerCase()}${link.handle ? ` by @${link.handle}` : ''}`;
        return (
          <li
            key={key}
            className={`inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-pill py-1 pr-1 pl-3 text-[0.85rem] shadow-[inset_0_0_0_1.5px_var(--rule)] ${
              off || locked ? 'text-text-faint' : 'bg-surface-sunk'
            }`}
          >
            <PlatformIcon platform={link.platform} size={16} />
            <span className={`truncate font-bold ${off ? 'line-through' : ''}`}>{describeKind(link)}</span>
            {link.handle && <span className={`truncate text-text-muted ${off ? 'line-through' : ''}`}>@{link.handle}</span>}
            {locked ? (
              <LockSimple size={16} weight="bold" className="mr-2 shrink-0 text-note-ink" aria-label="Private" />
            ) : (
              <button
                type="button"
                onClick={() => onToggle(link)}
                aria-label={off ? `Put back ${name}` : `Set aside ${name}`}
                className="flex size-8 shrink-0 items-center justify-center rounded-pill text-text-muted hover:bg-surface hover:text-text"
              >
                {off ? <ArrowBendLeftUp size={15} weight="bold" aria-hidden="true" /> : <X size={15} weight="bold" aria-hidden="true" />}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Not now" holds per guest until the shelf has more books than when it was said. */
const dismissedKey = (userId: string) => `booktrap.save-prompt.dismissed.${userId}`;

function readDismissed(userId: string): number {
  try {
    return Number(localStorage.getItem(dismissedKey(userId)) ?? 0);
  } catch {
    return 0;
  }
}

/**
 * A guest's books live only in this browser (and a guest shelf is deleted after 30 days without a
 * visit): once the shelf has books, offer to save it with an email.
 */
function SaveShelfCard() {
  const user = useUser();
  const shelf = useBooks();
  const { openAuth } = useAuthSheet();
  const [dismissed, setDismissed] = useState(() => readDismissed(user.id));
  const books = shelf.data?.length ?? 0;
  if (!user.isGuest || books === 0 || books <= dismissed) return null;

  const notNow = () => {
    setDismissed(books);
    try {
      localStorage.setItem(dismissedKey(user.id), String(books));
    } catch {
      // Private mode: the card may come back on the next visit, which is harmless.
    }
  };

  return (
    <section aria-labelledby="save-shelf-title" className="mt-6 rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--rule-accent)] md:mt-8 md:p-5">
      <p id="save-shelf-title" className="flex items-start gap-2.5 text-[1.05rem] font-bold">
        <CloudSlash size={22} weight="bold" className="mt-0.5 shrink-0 text-note-ink" aria-hidden="true" />
        Your {books === 1 ? 'book is' : `${books} books are`} only in this browser.
      </p>
      <p className="mt-1 pl-[2.15rem] text-[0.92rem] text-text-muted">
        Save your shelf with an email to keep it on any device. Guest shelves are deleted after 30 days without a visit.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 pl-[2.15rem]">
        <Button type="button" onClick={() => openAuth('save')} className="min-h-11 px-5 text-[0.92rem]">
          Save my shelf
        </Button>
        <Button type="button" variant="ghost" onClick={notNow} className="min-h-11 px-4 text-[0.92rem]">
          Not now
        </Button>
      </div>
    </section>
  );
}
