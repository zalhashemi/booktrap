import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config';
import { processItem } from './pipeline/process';
import { JobQueue } from './pipeline/queue';
import { createMemoryDeviceRepo } from './repo/memory';
import { createSupabaseDeviceRepo } from './repo/supabase';
import { buildApp } from './server';
import { createMemoryLibraryStore } from './store/memory';
import { createSupabaseLibraryStore } from './store/supabase';

const config = loadConfig();

const db =
  config.storage === 'supabase'
    ? createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
const devices = db ? createSupabaseDeviceRepo(db) : createMemoryDeviceRepo();
const store = db ? createSupabaseLibraryStore(db) : createMemoryLibraryStore();

// The queue needs the app's logger, and the app needs the queue: wire through a holder.
let runItem: (itemId: string) => Promise<void> = async () => {};
const queue = new JobQueue((itemId) => runItem(itemId), config.JOB_CONCURRENCY);

const app = await buildApp({ config, devices, store, queue });
const pipelineLog = app.log.child({ component: 'pipeline' });

runItem = (itemId) =>
  processItem(itemId, {
    store,
    log: pipelineLog,
    settings: {
      apifyToken: config.APIFY_TOKEN,
      anthropic: config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : undefined,
      googleBooksApiKey: config.GOOGLE_BOOKS_API_KEY,
      model: config.EXTRACTION_MODEL,
      effort: config.EXTRACTION_EFFORT,
      includeBackgroundBooks: config.INCLUDE_BACKGROUND_BOOKS,
      unsureBelowConfidence: config.UNSURE_BELOW_CONFIDENCE,
      monthlyBudgetUsd: config.MONTHLY_BUDGET_USD,
      killSwitch: config.GLOBAL_SPEND_KILL_SWITCH,
    },
  });

if (config.storage === 'memory') {
  app.log.warn('SUPABASE_URL is not set: using in-memory storage. Data is lost on restart.');
}
if (!config.APIFY_TOKEN || !config.ANTHROPIC_API_KEY) {
  app.log.warn('APIFY_TOKEN or ANTHROPIC_API_KEY is missing: new links are refused as "paused".');
}

/** Render sends SIGTERM and waits ~30s: let in-flight items finish (so paid work gets cached) first. */
const SHUTDOWN_GRACE_MS = 25_000;
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await Promise.race([queue.drain(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))]);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });

// Resume work that was queued or mid-flight when the process last stopped (free hosting sleeps).
// Mid-flight items restart from the top; the post cache makes a repeated step free.
try {
  const unfinished = await store.unfinishedItems();
  for (const item of unfinished) queue.enqueue(item.id, item.deviceId);
  if (unfinished.length) app.log.info({ count: unfinished.length }, 'resumed unfinished job items');
} catch (error) {
  app.log.error({ err: error }, 'could not resume unfinished job items');
}
