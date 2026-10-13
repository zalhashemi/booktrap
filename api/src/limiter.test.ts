import { describe, expect, it } from 'vitest';
import { createLimiter } from './limiter';

describe('createLimiter', () => {
  it('never runs more than its limit, even when a newcomer arrives as a slot frees up', async () => {
    const limiter = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
      });
    const first = Array.from({ length: 5 }, task);
    // Joins just as the first ones finish.
    await first[0];
    const late = Array.from({ length: 5 }, task);
    await Promise.all([...first, ...late]);
    expect(peak).toBe(2);
    expect(limiter.size).toBe(0);
  });

  it('frees the slot when a task throws', async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await limiter.run(async () => 'ok')).toBe('ok');
  });
});
