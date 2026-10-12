import { z } from 'zod';

/**
 * The admin page's Stats view (Phase 10, option B): counts and totals only, never one reader's shelf or
 * links. Ranges run in the operator's time zone: the last 7 days or 30 days including today, or this month.
 */
export const STATS_RANGES = ['7d', '30d', 'month'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const STATS_RANGE_LABELS: Record<StatsRange, string> = { '7d': '7 days', '30d': '30 days', month: 'This month' };

/** Supabase's free plan database limit, which the storage line is measured against. */
export const FREE_DATABASE_BYTES = 500 * 1024 * 1024;

const count = z.number().int().nonnegative();
const usd = z.number().nonnegative();

export const AdminStatsSchema = z.object({
  range: z.enum(STATS_RANGES),
  /** First and last day shown, as YYYY-MM-DD in the operator's time zone. */
  from: z.string(),
  today: z.string(),
  readers: z.object({ total: count, accounts: count, guests: count, newInRange: count }),
  active7d: count,
  posts: z.object({ done: count, paid: count, failed: count, tiktok: count, instagram: count }),
  /** One entry per day from `from` to `today`, days without posts included. */
  perDay: z.array(z.object({ day: z.string(), paid: count, cached: count })),
  topFailures: z.array(z.object({ error: z.string(), count })),
  spend: z.object({
    /** This calendar month, whatever the range. */
    month: z.object({ anthropic: usd, apify: usd, total: usd }),
    budgetUsd: usd,
    /** This month's spend at its pace so far, carried to the month's end. */
    forecastUsd: usd,
    /** Spend in the range over the posts read new (paid) in it; null without any. */
    perNewPostUsd: usd.nullable(),
  }),
  topBooks: z.array(z.object({ title: z.string(), author: z.string().nullable(), shelves: count })),
  databaseBytes: count,
});
export type AdminStats = z.infer<typeof AdminStatsSchema>;
