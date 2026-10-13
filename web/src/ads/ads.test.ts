import { describe, expect, it } from 'vitest';
import { adsEnabled } from './ads';

describe('adsEnabled', () => {
  it('shows ads only on the live site', () => {
    expect(adsEnabled('booktrap.app')).toBe(true);
    expect(adsEnabled('www.booktrap.app')).toBe(true);
    expect(adsEnabled('localhost')).toBe(false);
    expect(adsEnabled('abc123.booktrap.pages.dev')).toBe(false);
  });
});
