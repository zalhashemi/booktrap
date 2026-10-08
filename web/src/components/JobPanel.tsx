import { ArrowClockwise } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { parseTikTokUrl, type Job, type JobItem } from '@booktrap/shared';
import { useJobs, useRetryItem } from '../library/hooks';

const STAGES: Record<JobItem['status'], { label: string; step: number }> = {
  queued: { label: 'Waiting its turn', step: 0 },
  fetching: { label: 'Fetching from TikTok', step: 1 },
  extracting: { label: 'Reading covers, spines and captions', step: 2 },
  verifying: { label: 'Checking each book', step: 3 },
  done: { label: 'Done', step: 4 },
  failed: { label: 'Failed', step: 4 },
};
const STEP_COUNT = 4;

function describeLink(url: string): { who: string; what: string } {
  const link = parseTikTokUrl(url);
  return {
    who: link?.handle ? `@${link.handle}` : 'TikTok link',
    what: link?.kind === 'photo' ? 'Photo post' : link?.kind === 'collection' ? 'Collection' : link?.kind === 'short' ? 'Short link' : 'Video',
  };
}

function ItemRow({ job, item }: { job: Job; item: JobItem }) {
  const retry = useRetryItem();
  const stage = STAGES[item.status];
  const { who, what } = describeLink(item.inputUrl);
  const working = item.status !== 'done' && item.status !== 'failed';

  return (
    <li className="py-4">
      <div className="flex items-baseline justify-between gap-4">
        <a
          href={item.inputUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
        >
          {who}
        </a>
        <span className="shrink-0 text-sm text-text-faint">{what}</span>
      </div>

      {working && (
        <>
          <p className="mt-1 text-sm text-text-muted">{stage.label}</p>
          <div
            className="mt-2 grid grid-cols-4 gap-1"
            role="progressbar"
            aria-label={stage.label}
            aria-valuemin={0}
            aria-valuemax={STEP_COUNT}
            aria-valuenow={stage.step}
          >
            {Array.from({ length: STEP_COUNT }, (_, step) => (
              <span
                key={step}
                className={`h-[3px] rounded-full transition-colors duration-500 ${
                  step < stage.step ? 'bg-gold' : step === stage.step ? 'animate-pulse bg-rule-gold' : 'bg-rule'
                }`}
              />
            ))}
          </div>
        </>
      )}

      {item.status === 'done' && (
        <p className="mt-1 text-sm">
          {item.booksFound > 0 ? (
            <Link to="/shelf" className="text-emerald-ink underline-offset-4 hover:underline">
              {item.booksFound} {item.booksFound === 1 ? 'book' : 'books'} shelved
            </Link>
          ) : (
            <span className="text-text-muted">No books found in this post</span>
          )}
        </p>
      )}

      {item.status === 'failed' && (
        <div className="mt-1 flex items-start justify-between gap-4">
          <p className="text-sm text-rose-ink">{item.error ?? 'Something went wrong.'}</p>
          <button
            type="button"
            onClick={() => retry.mutate({ jobId: job.id, itemId: item.id })}
            disabled={retry.isPending}
            className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-board px-3 text-sm text-text shadow-[inset_0_0_0_1px_var(--rule)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--rule-gold)] disabled:text-text-faint"
          >
            <ArrowClockwise size={16} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}
    </li>
  );
}

export function JobPanel() {
  const jobs = useJobs();
  const recent = (jobs.data ?? []).slice(0, 3);
  const items = recent.flatMap((job) => job.items.map((item) => ({ job, item })));

  return (
    <section aria-labelledby="in-progress" aria-live="polite">
      <h2 id="in-progress" className="font-serif text-[1.15rem]">
        In progress
      </h2>
      {jobs.isPending ? (
        <p className="mt-2 text-sm text-text-muted">Checking for recent links…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 max-w-[36ch] text-sm text-text-muted">Links you paste show up here while BookTrap reads them.</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {items.map(({ job, item }) => (
            <ItemRow key={item.id} job={job} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
