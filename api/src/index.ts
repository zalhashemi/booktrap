import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { FREE_VIDEOS_PER_COLLECTION, LIMITS } from '@booktrap/shared';
import { purgeIdleGuests } from './account';
import { createSessionVerifier, type SessionVerifier } from './auth/session-auth';
import { loadConfig } from './config';
import { loadTestMode } from './load-test';
import { processItem } from './pipeline/process';
import { JobQueue } from './pipeline/queue';
import { buildApp } from './server';
import { createMemoryLibraryStore } from './store/memory';
import { createSupabaseLibraryStore } from './store/supabase';
import { createMemoryUserDirectory } from './users/memory';
import { createSupabaseUserDirectory } from './users/supabase';

const config = loadConfig();

const db =
  config.storage === 'supabase'
    ? createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
const users = db ? createSupabaseUserDirectory(db) : createMemoryUserDirectory();
const store = db ? createSupabaseLibraryStore(db) : createMemoryLibraryStore();
// Load-test mode (never in production): the load script's own session key and stubbed paid services.
const load = config.LOAD_TEST
  ? await loadTestMode({ supabaseUrl: config.SUPABASE_URL!, jwksFile: config.LOAD_TEST_JWKS_FILE!, timeScale: config.LOAD_TEST_TIME_SCALE })
  : null;
// Sign-in is Supabase Auth: without a project, no token can be checked, so every request is refused.
const verifySession: SessionVerifier = load
  ? load.verifySession
  : config.SUPABASE_URL
  ? createSessionVerifier({ supabaseUrl: config.SUPABASE_URL })
  : async () => {
      throw new Error('Supabase is not configured');
    };

// The queue needs the app's logger, and the app needs the queue: wire through a holder.
let runItem: (itemId: string) => Promise<void> = async () => {};
const queue = new JobQueue((itemId) => runItem(itemId), config.JOB_CONCURRENCY);

const app = await buildApp({ config, verifySession, users, store, queue, verifyBook: load?.verifyBook });
const pipelineLog = app.log.child({ component: 'pipeline' });

runItem = (itemId) =>
  processItem(itemId, {
    store,
    log: pipelineLog,
    settings: {
      // Load-test mode stubs both, so no real key is needed (or sent anywhere).
      apifyToken: load ? 'load-test' : config.APIFY_TOKEN,
      anthropic: load ? ({} as Anthropic) : config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : undefined,
      googleBooksApiKey: config.GOOGLE_BOOKS_API_KEY,
      model: config.EXTRACTION_MODEL,
      effort: config.EXTRACTION_EFFORT,
      includeBackgroundBooks: config.INCLUDE_BACKGROUND_BOOKS,
      monthlyBudgetUsd: config.MONTHLY_BUDGET_USD,
      killSwitch: config.GLOBAL_SPEND_KILL_SWITCH,
      // The shared constant, which the web app shows too; MAX_VIDEOS_PER_COLLECTION is the ceiling for a future paid tier.
      videosPerCollection: Math.min(FREE_VIDEOS_PER_COLLECTION, config.MAX_VIDEOS_PER_COLLECTION),
      dailyCapPerUser: config.DAILY_LINK_CAP_PER_USER,
      dailyCapGuest: config.DAILY_LINK_CAP_GUEST,
      dailyCapPerIp: config.DAILY_LINK_CAP_PER_IP,
    },
    isGuest: (userId) => users.isGuest(userId),
    enqueue: (childId, userId) => queue.enqueue(childId, userId),
    ...load?.stubs,
  });

if (load) app.log.warn({ timeScale: config.LOAD_TEST_TIME_SCALE }, 'LOAD TEST MODE: test sessions and stubbed Apify, Claude and catalogue');
if (config.storage === 'memory') {
  app.log.warn('SUPABASE_URL is not set: using in-memory storage, and no one can sign in.');
}
if (!load && (!config.APIFY_TOKEN || !config.ANTHROPIC_API_KEY)) {
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

// Every 6 hours: purge books deleted over 30 days ago (Undo only needs the recent ones), and expire
// what the privacy policy says we stop keeping: old cached posts, hashed networks past their day, jobs
// finished over 30 days ago, and guest shelves nobody has visited for 30 days.
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const purge = () =>
  Promise.all([
    store.purgeDeletedBooks().then(
      (count) => count && app.log.info({ count }, 'purged deleted books'),
      (error: unknown) => app.log.warn({ err: error }, 'purge of deleted books failed'),
    ),
    store
      .expireRetention({ postCacheBefore: new Date(Date.now() - config.POST_CACHE_DAYS * DAY_MS), ipHashBefore: new Date(Date.now() - 2 * DAY_MS) })
      .then(
        (expired) => (expired.posts || expired.ipHashes) && app.log.info(expired, 'expired retained data'),
        (error: unknown) => app.log.warn({ err: error }, 'data expiry failed'),
      ),
    store.purgeOldJobs(new Date(Date.now() - LIMITS.jobHistoryDays * DAY_MS)).then(
      (count) => count && app.log.info({ count }, 'purged old jobs'),
      (error: unknown) => app.log.warn({ err: error }, 'purge of old jobs failed'),
    ),
    purgeIdleGuests({ store, users, queue }).then(
      (count) => count && app.log.info({ count }, 'deleted idle guest shelves'),
      (error: unknown) => app.log.warn({ err: error }, 'idle guest purge failed'),
    ),
  ]);
void purge();
setInterval(() => void purge(), PURGE_EVERY_MS).unref();

// Resume work that was queued or mid-flight when the process last stopped (free hosting sleeps).
// Mid-flight items restart from the top; the post cache makes a repeated step free.
try {
  const unfinished = await store.unfinishedItems();
  for (const item of unfinished) queue.enqueue(item.id, item.userId);
  if (unfinished.length) app.log.info({ count: unfinished.length }, 'resumed unfinished job items');
} catch (error) {
  app.log.error({ err: error }, 'could not resume unfinished job items');
}
