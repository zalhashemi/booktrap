/**
 * Runs at most `concurrency` tasks at once; the rest wait their turn, first come first served. The
 * API runs on a small instance, so work that holds big buffers or starts ffmpeg goes through one.
 */
export function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      // A finished task hands its slot straight to the next in line, so a newcomer can't slip in between.
      if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    },
    /** Tasks running or waiting. */
    get size() {
      return active + waiting.length;
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
