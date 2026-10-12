import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FREE_DATABASE_BYTES, STATS_RANGES, STATS_RANGE_LABELS, type AdminStats, type StatsRange } from '@booktrap/shared';
import type { AdminClient } from '../api/admin';
import { ApiRequestError } from '../api/client';

const whole = new Intl.NumberFormat('en');
const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });
const dollars = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 3 });
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLabel = (day: string) => shortDay.format(new Date(`${day}T00:00:00Z`));
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Chart fills: paid reads in the deep teal, free cache hits in a pale one (both themes, via tokens). */
const PAID = 'bg-accent-ink';
const CACHED = 'bg-[color-mix(in_srgb,var(--accent)_45%,var(--surface-sunk))]';

/**
 * The admin Stats view (user's pick, option B "Tiles and chart"): four headline numbers, posts read per
 * day, then spend and the most-shelved books. Counts and totals only, never a reader's shelf or links.
 */
export function AdminStatsView({ client, onLocked }: { client: AdminClient; onLocked: () => void }) {
  const [range, setRange] = useState<StatsRange>('30d');
  const stats = useQuery({ queryKey: ['admin', 'stats', range], queryFn: () => client.stats(range), placeholderData: (previous) => previous });

  useEffect(() => {
    if (stats.error instanceof ApiRequestError && stats.error.status === 401) onLocked();
  }, [stats.error, onLocked]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-[2.2rem] leading-[1.05] md:text-[3.1rem]">Stats</h1>
        <div role="group" aria-label="Range" className="inline-flex gap-1 rounded-pill bg-surface p-1 shadow-[inset_0_0_0_1.5px_var(--rule)]">
          {STATS_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className="h-11 rounded-pill px-4 text-[0.92rem] font-bold text-text-muted transition-colors duration-200 hover:text-text aria-pressed:bg-accent aria-pressed:text-on-tab"
            >
              {STATS_RANGE_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 max-w-[60ch] text-[1.05rem] text-text-muted">Counts and totals only. Days follow this browser’s time zone.</p>

      <div className="mt-6" aria-live="polite" aria-busy={stats.isFetching}>
        {stats.data ? (
          <div className={`grid gap-4 transition-opacity duration-200 ${stats.isPlaceholderData ? 'opacity-60' : ''}`}>
            <Tiles stats={stats.data} />
            <PerDay stats={stats.data} />
            <div className="grid gap-4 md:grid-cols-2">
              <Spend stats={stats.data} />
              <TopBooks stats={stats.data} />
            </div>
          </div>
        ) : stats.isError ? (
          <p role="alert" className="text-note-ink">
            Couldn’t load the stats.{' '}
            <button type="button" onClick={() => void stats.refetch()} className="inline-flex min-h-11 items-center font-bold text-accent-ink underline underline-offset-4">
              Try again
            </button>
          </p>
        ) : (
          <Skeleton />
        )}
      </div>
    </>
  );
}

function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-card bg-surface p-5 shadow-[inset_0_0_0_1.5px_var(--rule)] ${className}`}>
      {title && <h2 className="font-display text-[1.25rem] leading-snug">{title}</h2>}
      {children}
    </section>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Card>
      <p className="text-[0.75rem] font-extrabold tracking-[0.1em] text-text-faint uppercase">{label}</p>
      {/* Nunito, not Young Serif: its old-style figures bob, and these are read as numbers. */}
      <p className="mt-1 text-[2.1rem] leading-tight font-extrabold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[0.9rem] text-text-muted">{children}</p>
    </Card>
  );
}

function Tiles({ stats }: { stats: AdminStats }) {
  const { readers, posts, spend } = stats;
  const read = posts.done;
  const over = spend.forecastUsd > spend.budgetUsd;
  const rangeName = stats.range === 'month' ? 'this month' : `in ${STATS_RANGE_LABELS[stats.range]}`;
  return (
    <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
      <Tile label="Readers" value={whole.format(readers.total)}>
        <b className="text-accent-ink tabular-nums">+{whole.format(readers.newInRange)}</b> {rangeName} · {whole.format(readers.accounts)} saved
      </Tile>
      <Tile label="Here this week" value={whole.format(stats.active7d)}>
        {readers.total ? percent.format(stats.active7d / readers.total) : '0%'} of readers
      </Tile>
      <Tile label={`Posts read, ${stats.range === 'month' ? 'this month' : STATS_RANGE_LABELS[stats.range]}`} value={whole.format(read)}>
        {read ? `${percent.format((read - posts.paid) / read)} free from the cache` : 'Nothing read yet'}
      </Tile>
      <Tile label="Spent this month" value={dollars.format(spend.month.total)}>
        of {dollars.format(spend.budgetUsd)} · on track for{' '}
        <b className={`tabular-nums ${over ? 'text-note-ink' : 'text-accent-ink'}`}>{dollars.format(spend.forecastUsd)}</b>
        {over && ' (over budget)'}
      </Tile>
    </div>
  );
}

function PerDay({ stats }: { stats: AdminStats }) {
  const days = stats.perDay;
  const peak = Math.max(1, ...days.map((entry) => entry.paid + entry.cached));
  // Three gridlines at round numbers under the peak.
  const step = niceStep(peak / 3);
  const top = Math.max(peak, step * 3);
  const lines = [step, step * 2, step * 3].filter((value) => value <= top);
  const middle = days[Math.floor(days.length / 2)];
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[1.25rem] leading-snug">Posts read per day</h2>
        <div className="flex flex-wrap gap-4 text-[0.85rem] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <i className={`inline-block size-2.5 rounded-[3px] ${PAID}`} aria-hidden="true" />
            Read new (paid)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className={`inline-block size-2.5 rounded-[3px] ${CACHED}`} aria-hidden="true" />
            From the cache (free)
          </span>
        </div>
      </div>
      <div className="relative mt-5 flex h-44 items-end gap-[3px] border-b-[1.5px] border-rule" aria-hidden="true">
        {lines.map((value) => (
          <div key={value} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-rule" style={{ bottom: `${(value / top) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[0.7rem] text-text-faint tabular-nums">{value}</span>
          </div>
        ))}
        {days.map((entry) => {
          const total = entry.paid + entry.cached;
          return (
            <div key={entry.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex flex-col gap-[2px]" style={{ height: `${(total / top) * 100}%` }}>
                {entry.cached > 0 && <i className={`block rounded-t-[3px] ${CACHED}`} style={{ flexGrow: entry.cached }} />}
                {entry.paid > 0 && <i className={`block ${entry.cached ? '' : 'rounded-t-[3px]'} ${PAID}`} style={{ flexGrow: entry.paid }} />}
              </div>
              <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 hidden -translate-x-1/2 rounded-[8px] bg-text px-2 py-1 text-[0.75rem] whitespace-nowrap text-ground group-hover:block">
                {dayLabel(entry.day)}: {entry.paid} new, {entry.cached} cached
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.75rem] text-text-faint" aria-hidden="true">
        <span>{days[0] && dayLabel(days[0].day)}</span>
        {days.length > 2 && middle && <span>{dayLabel(middle.day)}</span>}
        <span>{days.at(-1) && dayLabel(days.at(-1)!.day)}</span>
      </div>
      <table className="sr-only">
        <caption>Posts read per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Read new</th>
            <th>From the cache</th>
          </tr>
        </thead>
        <tbody>
          {days.map((entry) => (
            <tr key={entry.day}>
              <td>{dayLabel(entry.day)}</td>
              <td>{entry.paid}</td>
              <td>{entry.cached}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** 1, 2 or 5 times a power of ten, at least `value`. */
function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= value) ?? power * 10;
}

function Spend({ stats }: { stats: AdminStats }) {
  const { spend, posts } = stats;
  const share = (usd: number) => `${Math.min(100, (usd / Math.max(spend.budgetUsd, spend.month.total, 0.01)) * 100)}%`;
  const attempted = posts.done + posts.failed;
  const failure = stats.topFailures[0];
  return (
    <Card title="Spend this month">
      <div
        className="mt-4 flex h-3 gap-[2px] overflow-hidden rounded-pill bg-surface-sunk"
        role="img"
        aria-label={`${dollars.format(spend.month.total)} of a ${dollars.format(spend.budgetUsd)} budget`}
      >
        <i className={`block h-full ${PAID}`} style={{ width: share(spend.month.anthropic) }} />
        <i className="block h-full bg-tag" style={{ width: share(spend.month.apify) }} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4 text-[0.85rem] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className={`inline-block size-2.5 rounded-[3px] ${PAID}`} aria-hidden="true" />
          Claude {dollars.format(spend.month.anthropic)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-[3px] bg-tag" aria-hidden="true" />
          Apify {dollars.format(spend.month.apify)}
        </span>
        <span>Budget {dollars.format(spend.budgetUsd)}</span>
      </div>
      <dl className="mt-3 divide-y divide-dashed divide-rule">
        <Row label="Average per new post">{spend.perNewPostUsd === null ? 'None read yet' : cents.format(spend.perNewPostUsd)}</Row>
        <Row label="Failed posts">
          {whole.format(posts.failed)}
          {attempted ? ` (${percent.format(posts.failed / attempted)})` : ''}
        </Row>
        {failure && <Row label="Most common failure">{failure.error}</Row>}
        <Row label="TikTok / Instagram">
          {whole.format(posts.tiktok)} / {whole.format(posts.instagram)}
        </Row>
        <Row label="Database">
          {megabytes(stats.databaseBytes)} of {megabytes(FREE_DATABASE_BYTES)}
        </Row>
      </dl>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-bold tabular-nums">{children}</dd>
    </div>
  );
}

function TopBooks({ stats }: { stats: AdminStats }) {
  return (
    <Card title="Most caught">
      {stats.topBooks.length ? (
        <ol className="mt-3 divide-y divide-dashed divide-rule">
          {stats.topBooks.map((book) => (
            <li key={`${book.title}:${book.author ?? ''}`} className="flex items-baseline justify-between gap-4 py-2">
              <span className="min-w-0">
                <span className="block truncate font-bold">{book.title}</span>
                {book.author && <span className="block truncate text-[0.85rem] text-text-muted">{book.author}</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                <b>{whole.format(book.shelves)}</b> {book.shelves === 1 ? 'shelf' : 'shelves'}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-text-muted">No books shelved in this range.</p>
      )}
    </Card>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-4" aria-label="Loading the stats">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[124px] animate-pulse rounded-card bg-surface-sunk" />
        ))}
      </div>
      <div className="h-[280px] animate-pulse rounded-card bg-surface-sunk" />
    </div>
  );
}
