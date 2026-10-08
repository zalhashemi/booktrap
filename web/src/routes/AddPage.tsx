import { useId, useMemo, useState, type FormEvent } from 'react';
import { extractTikTokLinks, type TikTokLink } from '@booktrap/shared';
import { ApiRequestError, NetworkError } from '../api/client';
import { Button } from '../components/Button';
import { JobPanel } from '../components/JobPanel';
import { ShieldCheck } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { backupSaved } from '../device/backupPrompt';
import { useCreateJob, useJobs } from '../library/hooks';

function summarize(links: TikTokLink[]): string {
  if (links.length === 0) return 'One per line, or paste a whole message. BookTrap picks out the links.';
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

  return (
    // Desktop: paste on the left, progress alongside it, so you can watch links you just pasted.
    <div className="grid gap-16 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] lg:gap-14">
      <div>
        <h1 className="font-display text-[2.15rem] leading-[1.08] tracking-[-0.01em] md:text-[2.9rem]">
          Paste a TikTok. Shelve every book in it.
        </h1>
        <p className="mt-4 max-w-[52ch] text-text-muted">
          Videos, photo carousels or a whole public collection. BookTrap reads the covers, spines, captions and
          speech, then adds each book to your shelf.
        </p>

        <form className="mt-10" onSubmit={onSubmit} noValidate>
          <label htmlFor={fieldId} className="block text-[0.95rem] font-medium">
            TikTok links
          </label>
          <textarea
            id={fieldId}
            name="links"
            rows={5}
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
            placeholder="https://www.tiktok.com/@reader/video/7301234567890123456"
            className="mt-2 block w-full resize-y rounded-board border border-rule bg-surface px-4 py-3 text-base leading-relaxed transition-[border-color,box-shadow] duration-200 hover:border-rule-gold focus:border-gold focus:shadow-[0_0_0_3px_var(--rule-gold)] focus:outline-none"
          />
          <p id={helpId} className={`mt-2 text-sm ${links.length ? 'text-text' : 'text-text-muted'}`} aria-live="polite">
            {text.trim() && links.length === 0 ? 'No TikTok links in this text yet.' : summarize(links)}
          </p>

          <div className="mt-6">
            <Button type="submit" disabled={links.length === 0 || createJob.isPending} className="w-full md:w-auto">
              {createJob.isPending ? 'Sending…' : links.length > 1 ? `Catch books from ${links.length} links` : 'Catch books'}
            </Button>
            {createJob.isError && (
              <p id={errorId} role="alert" className="mt-3 text-sm text-rose-ink">
                {errorMessage(createJob.error)}
              </p>
            )}
          </div>
        </form>
      </div>

      <div className="border-t border-rule pt-6 lg:mt-3 lg:self-start lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
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
    <div className="mb-8 rounded-board bg-surface p-4 shadow-[inset_0_0_0_1px_var(--rule-gold)]">
      <p className="flex items-start gap-2.5 text-[0.95rem]">
        <ShieldCheck size={22} className="mt-0.5 shrink-0 text-gold-ink" aria-hidden="true" />
        Save your backup code so you can never lose your list.
      </p>
      <p className="mt-1 pl-[2.1rem] text-sm text-text-muted">
        BookTrap has no accounts. If this browser’s data is cleared, the code is the only way back to your shelf.
      </p>
      <Link to="/settings#backup" className="mt-2 ml-[2.1rem] inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline-offset-4 hover:underline">
        Get my backup code
      </Link>
    </div>
  );
}
