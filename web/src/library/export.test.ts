import { describe, expect, it } from 'vitest';
import { exportFileName } from './export';

describe('exportFileName', () => {
  it('dates the file in local time', () => {
    expect(exportFileName('goodreads', 'csv', new Date(2026, 0, 5, 23, 30))).toBe('booktrap-goodreads-2026-01-05.csv');
  });
});
