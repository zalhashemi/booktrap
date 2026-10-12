import { toExportJson, type ExportStatus } from '@booktrap/shared';
import type { LibraryStore } from './store/types';

/** One export per user this often: asking again sooner gets the one already made (or being made). */
export const EXPORT_COOLDOWN_MS = 10 * 60 * 1000;
/** A finished file is kept this long, then dropped (the reader can ask for a fresh one by then). */
export const EXPORT_KEEP_MS = 15 * 60 * 1000;

interface ExportJob {
  status: ExportStatus['status'];
  requestedAt: number;
  readyAt: number | null;
  file: string | null;
}

export interface ExportJobs {
  /** Queues an export, or hands back the user's recent one. Never waits for the export itself. */
  request(userId: string): ExportStatus;
  /** The user's export, or null when there's none (never asked, or dropped). */
  status(userId: string): ExportStatus | null;
  /** The finished JSON, or null when it isn't ready. */
  file(userId: string): string | null;
  /** A deleted account's export goes too, queued or done. */
  forgetUser(userId: string): void;
  /** Resolves once nothing is queued or running (tests and shutdown). */
  idle(): Promise<void>;
}

/**
 * "Download my data", made off the request path: one export at a time in the background, so a big
 * shelf never holds up the API, and the reader polls until the file is ready. Kept in memory: the
 * API runs as one instance, and an export lost to a restart is simply asked for again.
 */
export function createExportJobs({ store, now = () => Date.now(), log }: { store: LibraryStore; now?: () => number; log?: (error: unknown) => void }): ExportJobs {
  const jobs = new Map<string, ExportJob>();
  const queue: string[] = [];
  let running: Promise<void> | null = null;

  const toStatus = (job: ExportJob): ExportStatus => ({
    status: job.status,
    requestedAt: new Date(job.requestedAt).toISOString(),
    readyAt: job.readyAt === null ? null : new Date(job.readyAt).toISOString(),
    nextAt: new Date(job.requestedAt + EXPORT_COOLDOWN_MS).toISOString(),
  });

  /** Drops finished files past their keep time, so memory holds only recent exports. */
  const sweep = () => {
    const at = now();
    for (const [userId, job] of jobs) {
      const done = job.status === 'ready' || job.status === 'failed';
      if (done && at - (job.readyAt ?? job.requestedAt) > EXPORT_KEEP_MS) jobs.delete(userId);
    }
  };

  const work = async () => {
    for (let userId = queue.shift(); userId !== undefined; userId = queue.shift()) {
      const job = jobs.get(userId);
      if (!job || job.status !== 'queued') continue;
      job.status = 'running';
      try {
        const books = await store.listBooks(userId);
        // Turning a big shelf into JSON is the one heavy step: let waiting requests go first.
        await new Promise((resolve) => setImmediate(resolve));
        const file = toExportJson(books, new Date(now()));
        // Deleted while it ran: nothing is kept.
        if (jobs.get(userId) !== job) continue;
        Object.assign(job, { status: 'ready', file, readyAt: now() });
      } catch (error) {
        log?.(error);
        Object.assign(job, { status: 'failed', readyAt: now() });
      }
    }
  };

  const pump = () => {
    running ??= new Promise<void>((resolve) => setImmediate(resolve))
      .then(work)
      .finally(() => {
        running = null;
        if (queue.length) pump();
      });
  };

  return {
    request(userId) {
      sweep();
      const existing = jobs.get(userId);
      // A failed export can be tried again straight away; any other recent one is reused.
      if (existing && existing.status !== 'failed' && now() - existing.requestedAt < EXPORT_COOLDOWN_MS) return toStatus(existing);
      const job: ExportJob = { status: 'queued', requestedAt: now(), readyAt: null, file: null };
      jobs.set(userId, job);
      queue.push(userId);
      pump();
      return toStatus(job);
    },
    status(userId) {
      sweep();
      const job = jobs.get(userId);
      return job ? toStatus(job) : null;
    },
    file(userId) {
      sweep();
      return jobs.get(userId)?.file ?? null;
    },
    forgetUser(userId) {
      jobs.delete(userId);
    },
    async idle() {
      while (running) await running;
    },
  };
}
