import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowBendLeftUp, LockSimple, ShieldCheck, Sparkle, X } from '@phosphor-icons/react';
import { Link } from 'react-router';
import {
  FREE_VIDEOS_PER_COLLECTION,
  PLATFORM_LABELS,
  PRIVATE_COLLECTION_MESSAGE,
  extractSourceLinks,
  linkKey,
  type SourceLink,
} from '@booktrap/shared';
import { ApiRequestError, NetworkError } from '../api/client';
import { Button } from '../components/Button';
import { JobPanel } from '../components/JobPanel';
import { backupSaved } from '../device/backupPrompt';
import { useCreateJob, useJobs } from '../library/hooks';
import { PlatformIcon } from '../components/PlatformIcon';
import { describeKind, summarize } from '../library/links';

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof NetworkError) return 'Can’t reach BookTrap right now. Your links are still here, try again in a moment.';
  return 'Something went wrong. Try again.';
}

export function AddPage() {
  const fieldId = useId();
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
  const createJob = useCreateJob();

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
        <h1 className="font-display text-[2.3rem] leading-[1.06] md:text-[3.1rem]">
          Paste a post.
          <br />
          Catch every book in it.
        </h1>
        <p className="mt-4 max-w-[48ch] text-[1.05rem] text-text-muted">
          TikTok videos, photo carousels and public collections, and Instagram posts, carousels and reels. BookTrap
          reads the covers, spines, captions and speech, then shelves each book for you.
        </p>

        <form
          className="mt-8 rounded-card bg-surface p-4 shadow-[var(--elev-soft),inset_0_0_0_1.5px_var(--rule)] md:p-6"
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
          <textarea
            id={fieldId}
            name="links"
            rows={4}
            value={text}
            onChange={(event) => {
              latestText.current = event.target.value;
              setText(event.target.value);
              if (!event.target.value.trim()) setRemoved(new Set());
              if (createJob.isError) createJob.reset();
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby={`${helpId}${createJob.isError ? ` ${errorId}` : ''}`}
            aria-invalid={createJob.isError || undefined}
            placeholder="Paste one link per line, or a whole message"
            className="field mt-3 resize-y leading-relaxed"
          />
          <p
            id={helpId}
            className={`mt-2.5 flex min-h-6 items-center gap-1.5 text-sm ${links.length ? 'font-bold text-success-ink' : 'text-text-muted'}`}
            aria-live="polite"
          >
            {links.length > 0 && <Sparkle size={16} weight="fill" aria-hidden="true" />}
            {status ?? 'BookTrap picks the links out of anything you paste.'}
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
            <p id={errorId} role="alert" className="mt-3 text-sm text-note-ink">
              {errorMessage(createJob.error)}
            </p>
          )}
        </form>
      </div>

      <div className="lg:pt-2">
        <BackupReminder />
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

/**
 * After the first import that found books (brief §3): the shelf now holds something worth keeping,
 * and a cleared browser would lose it without the backup code.
 */
function BackupReminder() {
  const jobs = useJobs();
  const foundBooks = (jobs.data ?? []).some((job) => job.items.some((item) => item.status === 'done' && item.booksFound > 0));
  if (!foundBooks || backupSaved()) return null;
  return (
    <div className="mb-6 rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--rule-accent)]">
      <p className="flex items-start gap-2.5 font-bold">
        <ShieldCheck size={22} weight="fill" className="mt-0.5 shrink-0 text-accent-ink" aria-hidden="true" />
        Save your backup code so you can never lose your list.
      </p>
      <p className="mt-1 pl-[2.1rem] text-sm text-text-muted">
        BookTrap has no accounts. If this browser’s data is cleared, the code is the only way back to your shelf.
      </p>
      <Link
        to="/settings#backup"
        className="mt-3 ml-[2.1rem] inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-accent px-4 text-sm font-bold text-on-tab transition-transform duration-200 ease-snappy active:scale-[0.97]"
      >
        Get my backup code
        <ArrowBendLeftUp size={16} weight="bold" className="rotate-90" aria-hidden="true" />
      </Link>
    </div>
  );
}
