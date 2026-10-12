import type { AdminStats, StatsRange } from '@booktrap/shared';
import type { AdminStatsRaw } from './store/types';

const DAY_MS = 86_400_000;
const round = (usd: number) => Math.round(usd * 10_000) / 10_000;

/** Every day from `from` to `to` (YYYY-MM-DD), both included. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The Stats view from `admin_stats`: days without posts filled in as zeros, this (UTC) month's spend carried
 * to the month's end at its pace so far, and the average cost of a post read new.
 */
export function buildAdminStats(raw: AdminStatsRaw, range: StatsRange, budgetUsd: number): AdminStats {
  const counted = new Map(raw.perDay.map((entry) => [entry.day, entry]));
  const perDay = daysBetween(raw.from, raw.today).map((day) => ({ day, paid: counted.get(day)?.paid ?? 0, cached: counted.get(day)?.cached ?? 0 }));

  const total = raw.spendMonth.anthropic + raw.spendMonth.apify;
  const monthStart = Date.parse(raw.monthStart);
  const monthLength = Date.parse(raw.monthEnd) - monthStart;
  // At least a day in, so the first hours of a month don't forecast wildly from one post.
  const elapsed = Math.min(monthLength, Math.max(DAY_MS, Date.parse(raw.now) - monthStart));

  return {
    range,
    timeZone: raw.timeZone,
    from: raw.from,
    today: raw.today,
    clipped: raw.clipped,
    readers: raw.readers,
    active7d: raw.active7d,
    posts: raw.posts,
    perDay,
    topFailures: raw.topFailures,
    spend: {
      month: { anthropic: round(raw.spendMonth.anthropic), apify: round(raw.spendMonth.apify), total: round(total) },
      budgetUsd,
      forecastUsd: round((total / elapsed) * monthLength),
      perNewPostUsd: raw.posts.paid ? round(raw.paidPostsSpend / raw.posts.paid) : null,
    },
    topBooks: raw.topBooks,
    databaseBytes: raw.databaseBytes,
  };
}
