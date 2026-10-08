import { useId, useMemo, useState, type FormEvent } from 'react';
import { ArrowBendLeftUp, ShieldCheck, Sparkle } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { extractTikTokLinks, type TikTokLink } from '@booktrap/shared';
import { ApiRequestError, NetworkError } from '../api/client';
import { Button } from '../components/Button';
import { JobPanel } from '../components/JobPanel';
import { backupSaved } from '../device/backupPrompt';
import { useCreateJob, useJobs } from '../library/hooks';

function summarize(links: TikTokLink[]): string {
  const counts = { video: 0, photo: 0, short: 0, collection: 0 };
  for (const link of links) counts[link.kind]++;
  const parts = [
    counts.video && `${counts.video} ${counts.video === 1 ? 'video' : 'videos'}`,
    counts.photo && `${counts.photo} photo ${counts.photo === 1 ? 'post' : 'posts'}`,
    counts.short && `${counts.short} short ${counts.short === 1 ? 'link' : 'links'}`,
    counts.collection && `${counts.collection} ${counts.collection === 1 ? 'collection' : 'collections'}`,
  ].filter(Boolean);
  return `${links.length} ${links.length === 1 ? 'link' : 'links'} found: ${parts.join(', ')}`;
}

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
  const links = useMemo(() => extractTikTokLinks(text), [text]);
  const createJob = useCreateJob();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (links.length === 0 || createJob.isPending) return;
    const submitted = text;
    createJob.mutate(
      links.map((link) => link.url),
      // Clear only what was sent: anything typed while the request was in flight is kept.
      { onSuccess: () => setText((current) => (current === submitted ? '' : current)) },
    );
  };

  const status = text.trim() && links.length === 0 ? 'No TikTok links in this text yet.' : links.length ? summarize(links) : null;

  return (
    // Desktop: paste on the left, progress alongside it, so you can watch links you just pasted.
    <div className="grid gap-10 lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)] lg:gap-12">
      <div>
        <h1 className="font-display text-[2.3rem] leading-[1.06] md:text-[3.1rem]">
          Paste a TikTok.
          <br />
          Catch every book in it.
        </h1>
        <p className="mt-4 max-w-[48ch] text-[1.05rem] text-text-muted">
          Videos, photo carousels or a public collection. BookTrap reads the covers, spines, captions and speech, then
          shelves each book for you.
        </p>

        <form
          className="mt-8 rounded-card bg-surface p-4 shadow-[var(--elev-soft),inset_0_0_0_1.5px_var(--rule)] md:p-6"
          onSubmit={onSubmit}
          noValidate
        >
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={fieldId} className="text-[1rem] font-bold">
              TikTok links
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
              setText(event.target.value);
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

          <Button type="submit" disabled={links.length === 0 || createJob.isPending} className="mt-4 h-14 w-full text-[1.05rem]">
            {createJob.isPending ? 'Sending…' : links.length > 1 ? `Catch books from ${links.length} links` : 'Catch books'}
          </Button>
          {createJob.isError && (
            <p id={errorId} role="alert" className="mt-3 text-sm text-unsure-ink">
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
