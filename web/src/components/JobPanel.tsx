import { ArrowClockwise, CaretDown, CheckCircle, Images, Info, Playlist, Prohibit, VideoCamera, WarningCircle } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { BLOCKED_MESSAGES, PLATFORM_LABELS, parseSourceUrl, type Job, type JobItem, type SourceLink } from '@booktrap/shared';
import { useJobs, useRetryItem } from '../library/hooks';
import { describeKind } from '../library/links';
import { PlatformIcon } from './PlatformIcon';

const STAGES: Record<JobItem['status'], { label: string; step: number }> = {
  queued: { label: 'Waiting its turn', step: 0 },
  fetching: { label: 'Fetching the post', step: 1 },
  extracting: { label: 'Reading covers, spines and captions', step: 2 },
  verifying: { label: 'Checking each book', step: 3 },
  done: { label: 'Done', step: 4 },
  failed: { label: 'Failed', step: 4 },
};
const STEP_COUNT = 4;

/** The item's kind once fetched wins over what the link looked like (an Instagram /p/ post may be a video). */
function describeItem(item: JobItem) {
  const { platform } = item;
  const link = parseSourceUrl(item.inputUrl);
  const fetched: SourceLink['kind'] | null =
    item.kind === 'carousel' ? 'photo' : item.kind === 'video' ? 'video' : item.kind === 'collection' ? 'collection' : null;
  const kind = fetched ?? link?.kind ?? 'post';
  return {
    platform,
    who: link?.handle ? `@${link.handle}` : `${PLATFORM_LABELS[platform]} post`,
    what: describeKind({ platform, kind }),
    Icon: kind === 'photo' ? Images : kind === 'collection' ? Playlist : VideoCamera,
  };
}

function ItemCard({ job, item, videos = [] }: { job: Job; item: JobItem; videos?: JobItem[] }) {
  const retry = useRetryItem();
  const isCollection = item.kind === 'collection';
  const stage = isCollection && item.status === 'fetching' ? { label: 'Listing the collection’s videos', step: 1 } : STAGES[item.status];
  const { platform, who, what, Icon } = describeItem(item);
  const working = item.status !== 'done' && item.status !== 'failed';

  return (
    <li className="rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--rule)]">
      <div className="flex items-center justify-between gap-3">
        <a
          href={item.inputUrl}
          target="_blank"
          rel="noreferrer"
          className="-my-2.5 inline-flex min-h-11 min-w-0 items-center gap-2 font-bold underline-offset-4 hover:underline"
        >
          <PlatformIcon platform={platform} />
          <span className="truncate">{who}</span>
          <span className="sr-only">on {PLATFORM_LABELS[platform]}</span>
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

      {item.status === 'done' && isCollection && <CollectionProgress job={job} item={item} videos={videos} />}

      {item.status === 'done' && !isCollection && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
          {item.booksFound > 0 ? (
            <>
              <CheckCircle size={18} weight="fill" className="text-success-ink" aria-hidden="true" />
              <Link to="/shelf" className="-my-3 inline-flex min-h-11 items-center text-success-ink underline-offset-4 hover:underline">
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
          <p className="flex items-start gap-1.5 text-sm text-note-ink">
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

/**
 * Posts that were skipped (moderation or a takedown), folded into one quiet row so they never crowd
 * the books that did arrive (user's pick, option C). Opening it says which post and why.
 */
function SkippedFold({ items, noun }: { items: JobItem[]; noun: 'post' | 'video' }) {
  if (items.length === 0) return null;
  const moderated = items.some((item) => item.blocked !== 'removed');
  return (
    <details className="group rounded-card bg-surface-sunk px-4 py-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-bold text-text-muted [&::-webkit-details-marker]:hidden">
        <Prohibit size={18} weight="fill" aria-hidden="true" className="shrink-0" />
        {items.length} {items.length === 1 ? noun : `${noun}s`} skipped
        <CaretDown size={14} weight="bold" aria-hidden="true" className="transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 pb-3 pl-[26px] text-sm text-text-muted">
        {items.map((item) => {
          const { who, platform } = describeItem(item);
          return (
            <li key={item.id}>
              <a href={item.inputUrl} target="_blank" rel="noreferrer" className="font-bold text-text underline-offset-4 hover:underline">
                {who}
              </a>{' '}
              on {PLATFORM_LABELS[platform]}. {item.blocked ? BLOCKED_MESSAGES[item.blocked] : ''}
            </li>
          );
        })}
        {moderated && (
          <li className="pt-1">
            BookTrap reads posts about books, and book covers or talk about adult books are fine. A post is skipped only when it shows
            explicit or graphic content that isn’t a book.
          </li>
        )}
      </ul>
    </details>
  );
}

/**
 * A collection's videos, summed up inside its card: how many are read, the books they shelved, and any
 * that failed (each with its own Retry). A 25-video collection never floods the panel with 25 cards.
 */
function CollectionProgress({ job, item, videos }: { job: Job; item: JobItem; videos: JobItem[] }) {
  const finished = videos.filter((video) => video.status === 'done' || video.status === 'failed');
  const failed = videos.filter((video) => video.status === 'failed');
  const skipped = videos.filter((video) => video.blocked);
  const books = videos.reduce((sum, video) => sum + video.booksFound, 0);
  const reading = finished.length < videos.length;
  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-text-muted">
        {videos.length === 0
          ? 'No videos to read in this collection.'
          : reading
            ? `Read ${finished.length} of ${videos.length} videos`
            : `All ${videos.length} ${videos.length === 1 ? 'video' : 'videos'} read`}
      </p>
      {videos.length > 0 && (
        <div
          className="h-1.5 overflow-hidden rounded-pill bg-surface-strong"
          role="progressbar"
          aria-label="Videos read"
          aria-valuemin={0}
          aria-valuemax={videos.length}
          aria-valuenow={finished.length}
        >
          <span
            className="block h-full origin-left rounded-pill bg-accent transition-transform duration-500 ease-snappy"
            style={{ transform: `scaleX(${finished.length / videos.length})` }}
          />
        </div>
      )}
      {item.note && (
        <p className="flex items-start gap-1.5 text-sm text-note-ink">
          <Info size={18} weight="fill" className="mt-px shrink-0" aria-hidden="true" />
          {item.note}
        </p>
      )}
      {books === 0 && !reading && videos.length > 0 && <p className="text-sm text-text-muted">No books found in these videos</p>}
      {books > 0 && (
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <CheckCircle size={18} weight="fill" className="text-success-ink" aria-hidden="true" />
          <Link to="/shelf" className="-my-3 inline-flex min-h-11 items-center text-success-ink underline-offset-4 hover:underline">
            {books} {books === 1 ? 'book' : 'books'} found so far
          </Link>
        </p>
      )}
      {failed.length > 0 && (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-bold text-note-ink">
            <WarningCircle size={18} weight="fill" aria-hidden="true" />
            {failed.length} {failed.length === 1 ? 'video' : 'videos'} couldn’t be read
          </summary>
          <ul className="mt-2 space-y-2">
            {failed.map((video) => (
              <ItemCard key={video.id} job={job} item={video} />
            ))}
          </ul>
        </details>
      )}
      <SkippedFold items={skipped} noun="video" />
    </div>
  );
}

export function JobPanel() {
  const jobs = useJobs();
  const recent = (jobs.data ?? []).slice(0, 3);
  // A collection's videos are shown inside the collection's own card; skipped posts fold at the end.
  const all = recent.flatMap((job) =>
    job.items
      .filter((item) => !item.parentItemId)
      .map((item) => ({ job, item, videos: job.items.filter((child) => child.parentItemId === item.id) })),
  );
  const items = all.filter(({ item }) => !item.blocked);
  const skipped = all.filter(({ item }) => item.blocked).map(({ item }) => item);

  return (
    <section aria-labelledby="in-progress" aria-live="polite">
      <h2 id="in-progress" className="font-display text-[1.35rem]">
        Recent catches
      </h2>
      {jobs.isPending ? (
        <p className="mt-2 text-sm text-text-muted">Checking for recent links…</p>
      ) : all.length === 0 ? (
        <p className="mt-2 max-w-[34ch] text-sm text-text-muted">Links you paste show up here while BookTrap reads them.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map(({ job, item, videos }) => (
            <ItemCard key={item.id} job={job} item={item} videos={videos} />
          ))}
          {skipped.length > 0 && (
            <li>
              <SkippedFold items={skipped} noun="post" />
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
