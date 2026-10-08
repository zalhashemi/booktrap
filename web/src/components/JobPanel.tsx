import { ArrowClockwise, CheckCircle, Images, VideoCamera, WarningCircle } from '@phosphor-icons/react';
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

function describeLink(url: string) {
  const link = parseTikTokUrl(url);
  return {
    who: link?.handle ? `@${link.handle}` : 'TikTok link',
    what: link?.kind === 'photo' ? 'Photos' : link?.kind === 'collection' ? 'Collection' : link?.kind === 'short' ? 'Short link' : 'Video',
    Icon: link?.kind === 'photo' ? Images : VideoCamera,
  };
}

function ItemCard({ job, item }: { job: Job; item: JobItem }) {
  const retry = useRetryItem();
  const stage = STAGES[item.status];
  const { who, what, Icon } = describeLink(item.inputUrl);
  const working = item.status !== 'done' && item.status !== 'failed';

  return (
    <li className="rounded-[16px] bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--rule)]">
      <div className="flex items-center justify-between gap-3">
        <a href={item.inputUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate font-bold underline-offset-4 hover:underline">
          {who}
        </a>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-sunk px-2.5 py-1 text-[0.78rem] font-bold text-text-muted">
          <Icon size={14} weight="bold" aria-hidden="true" />
          {what}
        </span>
      </div>

      {working && (
        <>
          <p className="mt-2 text-sm text-text-muted">{stage.label}</p>
          <div
            className="mt-2 grid grid-cols-4 gap-1.5"
            role="progressbar"
            aria-label={stage.label}
            aria-valuemin={0}
            aria-valuemax={STEP_COUNT}
            aria-valuenow={stage.step}
          >
            {Array.from({ length: STEP_COUNT }, (_, step) => (
              <span
                key={step}
                className={`h-1.5 rounded-pill transition-colors duration-500 ${
                  step < stage.step ? 'bg-accent' : step === stage.step ? 'animate-pulse bg-rule-accent' : 'bg-surface-strong'
                }`}
              />
            ))}
          </div>
        </>
      )}

      {item.status === 'done' && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
          {item.booksFound > 0 ? (
            <>
              <CheckCircle size={18} weight="fill" className="text-success-ink" aria-hidden="true" />
              <Link to="/shelf" className="text-success-ink underline-offset-4 hover:underline">
                {item.booksFound} {item.booksFound === 1 ? 'book' : 'books'} shelved
              </Link>
            </>
          ) : (
            <span className="font-normal text-text-muted">No books found in this post</span>
          )}
        </p>
      )}

      {item.status === 'failed' && (
        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="flex items-start gap-1.5 text-sm text-unsure-ink">
            <WarningCircle size={18} weight="fill" className="mt-px shrink-0" aria-hidden="true" />
            {item.error ?? 'Something went wrong.'}
          </p>
          <button
            type="button"
            onClick={() => retry.mutate({ jobId: job.id, itemId: item.id })}
            disabled={retry.isPending}
            className="-my-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill bg-surface-sunk px-4 text-sm font-bold transition-transform duration-200 ease-snappy active:scale-[0.97] disabled:text-text-faint"
          >
            <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
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
      <h2 id="in-progress" className="font-display text-[1.35rem]">
        Recent catches
      </h2>
      {jobs.isPending ? (
        <p className="mt-2 text-sm text-text-muted">Checking for recent links…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 max-w-[34ch] text-sm text-text-muted">Links you paste show up here while BookTrap reads them.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map(({ job, item }) => (
            <ItemCard key={item.id} job={job} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
