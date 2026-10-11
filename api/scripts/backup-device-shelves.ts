/**
 * Saves every device-owned shelf as JSON before 0009_accounts.sql drops them. Read-only: it only
 * selects. Device secrets and hashed networks are left out. Prints counts, never rows or keys.
 *
 *   npx tsx --env-file=.env scripts/backup-device-shelves.ts
 *
 * Writes backups/device-shelves-<date>.json at the repo root (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (api/.env).');
const db = createClient(new URL(url).origin, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PAGE = 1000;

/** Every row of a table, a page at a time, in a stable order. */
async function all(table: string, columns: string, orderBy: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns);
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < PAGE) return rows;
  }
}

const tables = {
  devices: await all('devices', 'id, created_at, last_seen_at', ['created_at', 'id']),
  books: await all('books', '*', ['device_id', 'created_at', 'id']),
  book_sources: await all('book_sources', '*', ['book_id', 'id']),
  tags: await all('tags', '*', ['device_id', 'id']),
  book_tags: await all('book_tags', '*', ['book_id', 'tag_id']),
  jobs: await all('jobs', 'id, device_id, status, cleared_new, created_at, updated_at', ['device_id', 'created_at', 'id']),
  job_items: await all('job_items', '*', ['job_id', 'created_at', 'id']),
};

// Books per device, so the biggest shelf (the dev shelf) is easy to find.
const perDevice = new Map<string, { live: number; deleted: number }>();
for (const book of tables.books) {
  const counts = perDevice.get(book.device_id as string) ?? { live: 0, deleted: 0 };
  counts[book.deleted_at ? 'deleted' : 'live']++;
  perDevice.set(book.device_id as string, counts);
}

const date = new Date().toISOString().slice(0, 10);
const dir = new URL('../../backups/', import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`device-shelves-${date}.json`, dir);
writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), source: new URL(url).host, tables }, null, 2));

console.log(`Saved ${file.pathname}`);
for (const [table, rows] of Object.entries(tables)) console.log(`  ${table}: ${rows.length}`);
console.log('Books per device (live / in Undo bin):');
for (const [device, counts] of [...perDevice].sort((a, b) => b[1].live - a[1].live)) {
  console.log(`  ${device.slice(0, 8)}…  ${counts.live} / ${counts.deleted}`);
}
