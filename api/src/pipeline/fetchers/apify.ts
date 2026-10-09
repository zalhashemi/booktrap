import { PipelineError } from '../errors';
import type { FetchDeps } from './types';

/** What a platform fetcher tells the shared Apify runner about itself. */
export interface ActorSpec {
  /** e.g. "clockworks~tiktok-scraper". */
  actor: string;
  /** "TikTok" or "Instagram", used in reader-facing messages. */
  label: string;
  /** Billed per run that reaches Apify, success or not (per GB of run memory: see memoryMb). */
  startUsd: number;
  /** Run memory. Apify bills "actor start" once per GB, so a pinned 1 GB keeps it to one charge. */
  memoryMb?: number;
}

/**
 * Runs an Apify actor synchronously and returns its dataset items. Retries network errors,
 * timeouts and 5xx with backoff. Every attempt that reaches Apify is billed (the run start at
 * least), so the spend so far rides along on any error it throws.
 */
export async function runActor<T>(spec: ActorSpec, input: unknown, deps: FetchDeps): Promise<{ items: T[]; spent: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let spent = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    // Counted up front: a request that times out on our side may still have started a billed run.
    spent += spec.startUsd;
    try {
      const memory = spec.memoryMb ? `&memory=${spec.memoryMb}` : '';
      const response = await fetchImpl(`https://api.apify.com/v2/acts/${spec.actor}/run-sync-get-dataset-items?timeout=180${memory}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(200_000),
      });
      if (response.status === 401 || response.status === 402 || response.status === 403) {
        spent -= spec.startUsd; // Refused before any run started.
      }
      if (response.status === 401 || response.status === 403) {
        throw new PipelineError('scraper_failed', `BookTrap’s ${spec.label} reader isn’t configured correctly. We’ve logged it.`, false, {
          costUsd: spent,
        });
      }
      if (response.status === 402) {
        throw new PipelineError('budget_exhausted', `BookTrap has used up its ${spec.label} reading allowance for now. Try again later.`, false, {
          costUsd: spent,
        });
      }
      if (!response.ok) throw new Error(`Apify responded ${response.status}`);
      const body: unknown = await response.json();
      // An error envelope or an empty object from a timed-out run: treated like a 5xx and retried.
      if (!Array.isArray(body)) throw new Error('Apify answered without a list of items');
      return { items: body as T[], spent };
    } catch (error) {
      if (error instanceof PipelineError) throw error;
      // Network error, timeout or 5xx: retry with backoff.
    }
  }
  throw new PipelineError('scraper_failed', `${spec.label} took too long to answer. Try this link again in a minute.`, true, {
    costUsd: spent,
  });
}
