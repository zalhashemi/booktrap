import { describe, expect, it } from 'vitest';
import { buildAdminStats } from './stats';
import type { AdminStatsRaw } from './store/types';

const raw = (overrides: Partial<AdminStatsRaw> = {}): AdminStatsRaw => ({
  from: '2026-10-06',
  today: '2026-10-12',
  monthStart: '2026-09-30T21:00:00Z',
  monthEnd: '2026-10-31T21:00:00Z',
  now: '2026-10-11T21:00:00Z',
  readers: { total: 3, accounts: 2, guests: 1, newInRange: 2 },
  active7d: 1,
  posts: { done: 3, paid: 2, failed: 1, tiktok: 3, instagram: 1 },
  perDay: [{ day: '2026-10-09', paid: 1, cached: 2 }],
  topFailures: [],
  spendInRange: 0.1,
  spendMonth: { anthropic: 8, apify: 2 },
  topBooks: [],
  databaseBytes: 1,
  ...overrides,
});

describe('buildAdminStats', () => {
  it('fills every day of the range, zeros included', () => {
    const stats = buildAdminStats(raw(), '7d', 20);
    expect(stats.perDay.map((entry) => entry.day)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
    expect(stats.perDay[3]).toEqual({ day: '2026-10-09', paid: 1, cached: 2 });
    expect(stats.perDay[0]).toEqual({ day: '2026-10-06', paid: 0, cached: 0 });
  });

  it('carries this month’s spend to the month’s end at its pace, and averages a new post', () => {
    // $10 in 11 of October's 31 days.
    const stats = buildAdminStats(raw(), '7d', 20);
    expect(stats.spend.month).toEqual({ anthropic: 8, apify: 2, total: 10 });
    expect(stats.spend.forecastUsd).toBeCloseTo((10 / 11) * 31, 2);
    expect(stats.spend.perNewPostUsd).toBe(0.05);
  });

  it('doesn’t forecast wildly in a month’s first hours, or average with no paid posts', () => {
    const stats = buildAdminStats(raw({ now: '2026-09-30T22:00:00Z', posts: { done: 1, paid: 0, failed: 0, tiktok: 1, instagram: 0 } }), 'month', 20);
    expect(stats.spend.forecastUsd).toBeCloseTo(10 * 31, 1);
    expect(stats.spend.perNewPostUsd).toBeNull();
  });
});
