import { describe, expect, it } from 'vitest';
import { aboutWait } from './wait';

describe('aboutWait', () => {
  it('rounds a wait the way a person would say it', () => {
    expect(aboutWait(25)).toBe('under a minute');
    expect(aboutWait(75)).toBe('about a minute');
    expect(aboutWait(230)).toBe('about 4 minutes');
    expect(aboutWait(3400)).toBe('about 57 minutes');
    expect(aboutWait(3700)).toBe('about an hour');
    expect(aboutWait(9000)).toBe('about 3 hours');
  });
});
