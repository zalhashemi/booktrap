/**
 * Takes a post down everywhere, the same way the admin page does: it's never read or shown again,
 * it leaves every shelf, and books seen only in it are deleted unless the reader changed them.
 *
 *   npx tsx --env-file=.env scripts/takedown.ts <post link> [--dry-run]
 *
 * --dry-run prints how far the post reached and changes nothing. Prints counts, never readers or rows.
 */
import { createClient } from '@supabase/supabase-js';
import { postFromUrl, takeDown } from '../src/moderation';
import { createSupabaseLibraryStore } from '../src/store/supabase';

const [link, flag] = process.argv.slice(2);
if (!link) throw new Error('Usage: scripts/takedown.ts <post link> [--dry-run]');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (api/.env).');
const store = createSupabaseLibraryStore(createClient(new URL(url).origin, key, { auth: { persistSession: false, autoRefreshToken: false } }));

const post = await postFromUrl(link);
const reach = await store.postReach(post.platform, post.postId);
console.log(`${post.platform} post ${post.postId}: on ${reach.shelves} shelves, ${reach.onlyHere} books seen only there (${reach.edited} changed by their reader, kept).`);
if (flag === '--dry-run') {
  console.log('Dry run: nothing changed.');
} else {
  const result = await takeDown(store, post, 'request');
  console.log(`Taken down: ${result.sourcesRemoved} sources removed, ${result.booksDeleted} books deleted, ${result.booksKept} kept without the source.`);
}
