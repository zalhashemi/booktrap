/**
 * Phase 9 load test: simulated readers against the API running in load-test mode (see src/load-test.ts),
 * on the real Supabase project. Nothing is paid for: Apify, Claude and the catalogue are stubbed.
 *
 *   npx tsx --env-file=.env scripts/load/run.ts setup [readers=100]
 *       Makes the session key (api/.load/jwks.json), the API container's settings (api/.load/container.env:
 *       the Supabase URL and key, nothing else) and throwaway accounts. Then: scripts/load/start.sh.
 *   npx tsx --env-file=.env scripts/load/run.ts run <label> [links=1] [scale=0.25] [container=booktrap-load]
 *       Every reader at once: opens the app, pastes `links` posts, polls until read, opens the shelf and
 *       changes a book. Samples the container's memory and CPU. Writes api/.load/results-<label>.json.
 *       Timings are as measured: the stubbed waits were shortened by `scale`, ffmpeg and the database
 *       were not, so they can't simply be divided back. cpuSecondsPerPost is what scales to real plans.
 *   npx tsx --env-file=.env scripts/load/run.ts shelf <books> <label>
 *       Times opening one shelf of <books> books (seeded on the first reader).
 *   npx tsx --env-file=.env scripts/load/run.ts storage <books>
 *       Seeds one realistic shelf of <books> books and reports what it adds to the database (needs 0011).
 *   npx tsx --env-file=.env scripts/load/run.ts clean
 *       Deletes the accounts, their rows and the load test's cached posts.
 *
 * Prints counts and timings, never keys.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';

const DIR = join(import.meta.dirname, '../../.load');
const API = process.env.LOAD_API ?? 'http://localhost:8787';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (api/.env).');
const origin = new URL(url).origin;
const db = createClient(origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
const EMAIL_PREFIX = 'booktrap-load-';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Setup {
  privateJwk: JWK;
  users: string[];
}
const readSetup = (): Setup => JSON.parse(readFileSync(join(DIR, 'setup.json'), 'utf8')) as Setup;

async function tokenFor(privateJwk: JWK, userId: string) {
  const privateKey = await importJWK(privateJwk, 'ES256');
  return new SignJWT({ role: 'authenticated', is_anonymous: false })
    .setProtectedHeader({ alg: 'ES256', kid: 'load-test', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(`${origin}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('3h')
    .sign(privateKey);
}

// Timings ------------------------------------------------------------------------------------

const samples = new Map<string, number[]>();
const failures = new Map<string, number>();
function record(name: string, ms: number, status: number) {
  if (!samples.has(name)) samples.set(name, []);
  samples.get(name)!.push(ms);
  if (status >= 400 || status === 0) failures.set(`${name} ${status}`, (failures.get(`${name} ${status}`) ?? 0) + 1);
}
const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!) : 0;
};
const summary = (values: number[]) => ({ n: values.length, p50: pct(values, 50), p95: pct(values, 95), max: pct(values, 100) });

async function call(name: string, path: string, token: string, ip: string, init: { method?: string; body?: unknown } = {}) {
  const start = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        // Each simulated reader is on their own network, as real readers are (the API trusts 1 proxy hop here).
        'x-forwarded-for': ip,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    status = response.status;
    const body: unknown = await response.json().catch(() => null);
    return { status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    record(name, performance.now() - start, status);
  }
}

// Container sampling -------------------------------------------------------------------------

function toMiB(text: string) {
  const match = /([\d.]+)\s*([KMG]i?B)/.exec(text);
  if (!match) return 0;
  const factor = { KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[match[2] as 'MiB'] ?? 1;
  return Number(match[1]) * factor;
}

function sampleContainer(container: string) {
  const memory: number[] = [];
  const cpu: number[] = [];
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const { stdout } = await promisify(execFile)('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', container]);
        const [mem, cpuText] = stdout.trim().split('|');
        memory.push(toMiB(mem ?? ''));
        cpu.push(Number((cpuText ?? '0').replace('%', '')));
      } catch {
        // The container may be restarting (e.g. killed for memory): that shows up as a gap.
      }
      await sleep(1000);
    }
  })();
  return async () => {
    stop = true;
    await loop;
    // One sample a second, so the sum of CPU% / 100 is roughly the CPU-seconds used.
    const cpuSeconds = cpu.reduce((sum, value) => sum + value / 100, 0);
    return { memoryMiB: summary(memory), cpuPercent: summary(cpu), cpuSeconds: Math.round(cpuSeconds), samples: memory.length };
  };
}

// Commands -----------------------------------------------------------------------------------

async function setup(readers: number) {
  mkdirSync(DIR, { recursive: true });
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'load-test', alg: 'ES256', use: 'sig' };
  writeFileSync(join(DIR, 'jwks.json'), JSON.stringify({ keys: [publicJwk] }));
  // Only what the API needs to reach the database (gitignored, never printed).
  writeFileSync(join(DIR, 'container.env'), `SUPABASE_URL=${url}\nSUPABASE_SERVICE_ROLE_KEY=${key}\n`, { mode: 0o600 });
  const users: string[] = [];
  for (let i = 0; i < readers; i++) {
    const { data, error } = await db.auth.admin.createUser({ email: `${EMAIL_PREFIX}${String(i).padStart(3, '0')}@example.com`, email_confirm: true });
    if (error) throw new Error(`createUser ${i}: ${error.message}`);
    users.push(data.user.id);
  }
  writeFileSync(join(DIR, 'setup.json'), JSON.stringify({ privateJwk: await exportJWK(privateKey), users } satisfies Setup));
  console.log(`made ${users.length} throwaway accounts and the session key (api/.load/jwks.json)`);
}

/** A 19-digit TikTok-shaped id unique to this reader, run and link. */
const postId = (reader: number, run: number, link: number) => `79${String(run).padStart(6, '0')}${String(reader).padStart(4, '0')}${String(link).padStart(7, '0')}`;

async function run(label: string, links: number, scale: number, container: string) {
  const setupData = readSetup();
  const { privateJwk } = setupData;
  // LOAD_READERS runs fewer than were set up (a smoke test).
  const users = setupData.users.slice(0, Number(process.env.LOAD_READERS ?? setupData.users.length));
  const runId = Math.floor(Date.now() / 1000) % 1_000_000;
  const tokens = await Promise.all(users.map((id) => tokenFor(privateJwk, id)));
  const jobTimes: number[] = [];
  const queueWaits: number[] = [];
  let itemsFailed = 0;
  let itemsDone = 0;
  const stopSampling = sampleContainer(container);
  const started = performance.now();

  await Promise.all(
    users.map(async (_id, reader) => {
      // Readers arrive over the first 10 seconds, not all in the same millisecond.
      await sleep(Math.random() * 10_000);
      const token = tokens[reader]!;
      const ip = `10.${Math.floor(reader / 250)}.${reader % 250}.${(runId % 200) + 1}`;
      await call('GET /v1/me', '/v1/me', token, ip);
      await Promise.all([call('GET /v1/books', '/v1/books', token, ip), call('GET /v1/tags', '/v1/tags', token, ip), call('GET /v1/jobs', '/v1/jobs', token, ip)]);
      const urls = Array.from({ length: links }, (_, n) => `https://www.tiktok.com/@booktrap.load/video/${postId(reader, runId, n)}`);
      const pasted = performance.now();
      const created = await call('POST /v1/jobs', '/v1/jobs', token, ip, { method: 'POST', body: { urls } });
      const job = created.body as { id?: string; items?: { id: string; status: string }[] } | null;
      if (!job?.id) return;
      const firstDone = new Map<string, number>();
      // The app polls every 2 seconds while anything is being read.
      for (let polls = 0; polls < 2000; polls++) {
        await sleep(2000);
        const { body } = await call('GET /v1/jobs/:id', `/v1/jobs/${job.id}`, token, ip);
        const items = (body as { status?: string; items?: { id: string; status: string }[] } | null)?.items ?? [];
        for (const item of items) {
          if (!firstDone.has(item.id) && item.status !== 'queued') firstDone.set(item.id, performance.now() - pasted);
        }
        const status = (body as { status?: string } | null)?.status;
        if (status === 'done' || status === 'failed') {
          jobTimes.push(performance.now() - pasted);
          for (const item of items) {
            if (item.status === 'failed') itemsFailed++;
            else itemsDone++;
          }
          break;
        }
      }
      // Time from pasting until the first of this reader's links left the queue.
      if (firstDone.size) queueWaits.push(Math.min(...firstDone.values()));
      const shelf = await call('GET /v1/books', '/v1/books', token, ip);
      const book = (shelf.body as { books?: { id: string }[] } | null)?.books?.[0];
      if (book) await call('PATCH /v1/books/:id', `/v1/books/${book.id}`, token, ip, { method: 'PATCH', body: { status: 'reading' } });
      await call('GET /v1/usage', '/v1/usage', token, ip);
    }),
  );

  const container_ = await stopSampling();
  const { stdout: leftovers } = await promisify(execFile)('docker', ['exec', container, 'sh', '-c', 'ls -d /tmp/booktrap-* 2>/dev/null | grep -v load-sample | wc -l']).catch(() => ({ stdout: '?' }));
  const routes = Object.fromEntries([...samples].map(([name, values]) => [name, summary(values)]));
  const result = {
    label,
    readers: users.length,
    linksPerReader: links,
    timeScale: scale,
    wallSeconds: Math.round((performance.now() - started) / 1000),
    // As measured (see the header: stubbed waits were scaled, real work wasn't).
    jobSeconds: summary(jobTimes.map((ms) => ms / 1000)),
    queueWaitSeconds: summary(queueWaits.map((ms) => ms / 1000)),
    items: { done: itemsDone, failed: itemsFailed },
    postsPerMinute: Math.round((itemsDone / ((performance.now() - started) / 60_000)) * 10) / 10,
    routesMs: routes,
    failures: Object.fromEntries(failures),
    container: container_,
    cpuSecondsPerPost: itemsDone ? Math.round((container_.cpuSeconds / itemsDone) * 10) / 10 : null,
    tempDirsLeft: leftovers.trim(),
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `results-${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

async function seedShelf(userId: string, books: number, prefix: string) {
  const { data: tags, error: tagError } = await db
    .from('tags')
    .insert(['Dark academia', 'Winter', 'Book club'].map((name) => ({ user_id: userId, name: `${prefix}${name}` })))
    .select('id');
  if (tagError) throw new Error(tagError.message);
  for (let from = 0; from < books; from += 200) {
    const rows = Array.from({ length: Math.min(200, books - from) }, (_, i) => {
      const n = from + i;
      return {
        user_id: userId,
        title: `${prefix}A Typical Book Title Number ${n}`,
        author: 'Firstname Lastname',
        normalized_key: `${prefix.toLowerCase()}typical book title number ${n}|firstname lastname`,
        isbn13: `978${String(1_000_000_000 + n).slice(0, 10)}`,
        cover_url: `https://books.google.com/books/content?id=load${n}&printsec=frontcover&img=1&zoom=1`,
        published_year: 2000 + (n % 25),
        verified: true,
        status: n % 3 === 0 ? 'read' : 'want_to_read',
        notes: n % 10 === 0 ? 'A short note the reader wrote about why they want this one.' : null,
      };
    });
    const { data: inserted, error } = await db.from('books').insert(rows).select('id');
    if (error) throw new Error(error.message);
    // About 1.3 sources per book (a third were seen in a second post), and every third book on a shelf.
    const sources = inserted.flatMap((row, i) =>
      Array.from({ length: i % 3 === 0 ? 2 : 1 }, (_, s) => ({
        book_id: row.id,
        source_platform: 'tiktok',
        source_post_id: `${prefix}${from + i}-${s}`,
        source_url: `https://www.tiktok.com/@a.creator.handle/video/76724405405183951${String(from + i).padStart(2, '0')}`,
        creator_handle: 'a.creator.handle',
        thumbnail_url: 'https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/abcdefghijklmnopqrstuvwxyz0123456789~tplv-photomode-zoomcover:720:720.jpeg?x-expires=1791700000&x-signature=abcdefghijklmnopqrstuvwxyz%3D',
        evidence: 'cover',
        confidence: 0.92,
      })),
    );
    const { error: sourceError } = await db.from('book_sources').insert(sources);
    if (sourceError) throw new Error(sourceError.message);
    const { error: linkError } = await db.from('book_tags').insert(inserted.filter((_, i) => i % 3 === 0).map((row, i) => ({ book_id: row.id, tag_id: tags[i % 3]!.id })));
    if (linkError) throw new Error(linkError.message);
  }
}

async function shelf(books: number, label: string) {
  const { privateJwk, users } = readSetup();
  const userId = users[0]!;
  await seedShelf(userId, books, 'Shelf ');
  const token = await tokenFor(privateJwk, userId);
  const sizes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const response = await fetch(`${API}/v1/books`, { headers: { authorization: `Bearer ${token}` } });
    const text = await response.text();
    sizes.push(text.length);
  }
  for (let i = 0; i < 20; i++) await call(`GET /v1/books (${books})`, '/v1/books', token, '10.250.0.1');
  const result = { label, books, routesMs: Object.fromEntries([...samples].map(([n, v]) => [n, summary(v)])), responseKiB: Math.round(sizes[0]! / 1024), failures: Object.fromEntries(failures) };
  writeFileSync(join(DIR, `results-${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

async function storage(books: number) {
  const report = async () => {
    const { data, error } = await db.rpc('storage_report');
    if (error) throw new Error(`storage_report: ${error.message} (is 0011 applied?)`);
    return data as { table_name: string; row_count: number | null; total_bytes: number; index_bytes: number | null }[];
  };
  const before = await report();
  const { data, error } = await db.auth.admin.createUser({ email: `${EMAIL_PREFIX}storage@example.com`, email_confirm: true });
  if (error) throw new Error(error.message);
  await seedShelf(data.user.id, books, 'Storage ');
  // Let autovacuum's statistics and the size functions settle.
  await sleep(5000);
  const after = await report();
  const rows = after.map((row) => {
    const old = before.find((b) => b.table_name === row.table_name);
    return { table: row.table_name, rows: (row.row_count ?? 0) - (old?.row_count ?? 0), bytes: row.total_bytes - (old?.total_bytes ?? 0) };
  }).filter((row) => row.rows !== 0 || (row.bytes !== 0 && row.table !== 'database'));
  const databaseDelta = after.find((r) => r.table_name === 'database')!.total_bytes - before.find((r) => r.table_name === 'database')!.total_bytes;
  const result = { books, tables: rows, databaseBytesAdded: databaseDelta, databaseBytesTotal: after.find((r) => r.table_name === 'database')!.total_bytes, before };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `storage-${books}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, before: undefined }, null, 2));
}

async function clean() {
  const ours: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    ours.push(...data.users.filter((user) => user.email?.startsWith(EMAIL_PREFIX)).map((user) => user.id));
    if (data.users.length < 1000) break;
  }
  // The stubs cost nothing but still leave $0 spend rows: drop the load accounts' own, while they still
  // say whose they are (deleting an account keeps its spend without the owner). Real spend stays.
  let spend = 0;
  for (let i = 0; i < ours.length; i += 100) {
    const { count, error } = await db.from('spend_events').delete({ count: 'exact' }).in('user_id', ours.slice(i, i + 100)).eq('usd', 0);
    if (error) throw new Error(error.message);
    spend += count ?? 0;
  }
  let removed = 0;
  for (const id of ours) {
    await db.rpc('delete_user_data', { p_user_id: id });
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) console.log('could not delete a load-test user:', error.message);
    else removed++;
  }
  const cache = await db.from('post_cache').delete({ count: 'exact' }).eq('model', 'load-test');
  console.log(`deleted ${removed} load-test accounts, ${spend} of their $0 spend rows and ${cache.count ?? 0} cached load-test posts`);
}

const [command, a, b, c, d] = process.argv.slice(2);
if (command === 'setup') await setup(Number(a ?? 100));
else if (command === 'run') await run(a ?? 'run', Number(b ?? 1), Number(c ?? 0.25), d ?? 'booktrap-load');
else if (command === 'shelf') await shelf(Number(a ?? 1000), b ?? 'shelf');
else if (command === 'storage') await storage(Number(a ?? 200));
else if (command === 'clean') await clean();
else console.log('Usage: run.ts setup | run <label> [links] [scale] [container] | shelf <books> <label> | storage <books> | clean');
