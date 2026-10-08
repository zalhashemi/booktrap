import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book, BookSource } from '@booktrap/shared';
import { TERMINAL_STATUSES, deriveJobStatus, type JobItemRecord, type JobRecord, type JobWithItems, type LibraryStore } from './types';

const UNIQUE_VIOLATION = '23505';

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}

/** For `.single()` reads and inserts that must return a row. */
function checkOne<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  const data = check(result, what);
  if (data === null) throw new Error(`${what} returned no row`);
  return data;
}

interface JobRow {
  id: string;
  device_id: string;
  status: JobRecord['status'];
  cleared_new: boolean;
  created_at: string;
  job_items?: ItemRow[];
}

interface ItemRow {
  id: string;
  job_id: string;
  device_id: string;
  input_url: string;
  resolved_post_id: string | null;
  kind: JobItemRecord['kind'];
  status: JobItemRecord['status'];
  error: string | null;
  books_found: number;
  attempts: number;
  created_at: string;
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  published_year: number | null;
  status: Book['status'];
  verified: boolean;
  unsure: boolean;
  is_new: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  book_sources?: SourceRow[];
}

interface SourceRow {
  id: string;
  tiktok_post_id: string;
  tiktok_url: string;
  creator_handle: string | null;
  thumbnail_url: string | null;
  evidence: BookSource['evidence'];
  confidence: number | null;
  created_at: string;
}

const ITEM_COLUMNS = 'id, job_id, device_id, input_url, resolved_post_id, kind, status, error, books_found, attempts, created_at';

const toItem = (row: ItemRow): JobItemRecord => ({
  id: row.id,
  jobId: row.job_id,
  deviceId: row.device_id,
  inputUrl: row.input_url,
  postId: row.resolved_post_id,
  kind: row.kind,
  status: row.status,
  error: row.error,
  booksFound: row.books_found,
  attempts: row.attempts,
  createdAt: row.created_at,
});

const toJob = (row: JobRow): JobWithItems => ({
  id: row.id,
  deviceId: row.device_id,
  status: row.status,
  clearedNew: row.cleared_new,
  createdAt: row.created_at,
  items: (row.job_items ?? []).map(toItem).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
});

const toSource = (row: SourceRow): BookSource => ({
  id: row.id,
  postId: row.tiktok_post_id,
  url: row.tiktok_url,
  creatorHandle: row.creator_handle,
  thumbnailUrl: row.thumbnail_url,
  evidence: row.evidence,
  confidence: row.confidence,
  createdAt: row.created_at,
});

const toBook = (row: BookRow): Book => ({
  id: row.id,
  title: row.title,
  author: row.author,
  isbn10: row.isbn10,
  isbn13: row.isbn13,
  coverUrl: row.cover_url,
  publishedYear: row.published_year,
  status: row.status,
  verified: row.verified,
  unsure: row.unsure,
  isNew: row.is_new,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sources: (row.book_sources ?? []).map(toSource).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
});

export function createSupabaseLibraryStore(db: SupabaseClient): LibraryStore {
  const jobSelect = `id, device_id, status, cleared_new, created_at, job_items (${ITEM_COLUMNS})`;

  return {
    async createJob(deviceId, ipHash, items) {
      const job = checkOne(
        await db.from('jobs').insert({ device_id: deviceId, ip_hash: ipHash }).select('id').single<{ id: string }>(),
        'jobs.insert',
      );
      check(
        await db.from('job_items').insert(
          items.map((item) => ({
            job_id: job.id,
            device_id: deviceId,
            input_url: item.inputUrl,
            resolved_post_id: item.postId,
            kind: item.kind,
          })),
        ),
        'job_items.insert',
      );
      const created = await this.getJob(deviceId, job.id);
      if (!created) throw new Error('job vanished after insert');
      return created;
    },

    async getJob(deviceId, jobId) {
      const row = check(
        await db.from('jobs').select(jobSelect).eq('id', jobId).eq('device_id', deviceId).maybeSingle<JobRow>(),
        'jobs.get',
      );
      return row ? toJob(row) : null;
    },

    async listJobs(deviceId, limit) {
      const rows = check(
        await db.from('jobs').select(jobSelect).eq('device_id', deviceId).order('created_at', { ascending: false }).limit(limit),
        'jobs.list',
      ) as JobRow[];
      return rows.map(toJob);
    },

    async getItem(itemId) {
      const row = check(await db.from('job_items').select(ITEM_COLUMNS).eq('id', itemId).maybeSingle<ItemRow>(), 'job_items.get');
      return row ? toItem(row) : null;
    },

    async updateItem(itemId, patch) {
      const row: Record<string, unknown> = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.booksFound !== undefined) row.books_found = patch.booksFound;
      if (patch.postId !== undefined) row.resolved_post_id = patch.postId;
      if (patch.kind !== undefined) row.kind = patch.kind;
      if (patch.attempts !== undefined) row.attempts = patch.attempts;
      check(await db.from('job_items').update(row).eq('id', itemId), 'job_items.update');
    },

    async unfinishedItems() {
      const rows = check(
        await db
          .from('job_items')
          .select(ITEM_COLUMNS)
          .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
          .order('created_at', { ascending: true })
          .limit(1000),
        'job_items.unfinished',
      ) as ItemRow[];
      return rows.map(toItem);
    },

    async refreshJobStatus(jobId) {
      const rows = check(await db.from('job_items').select('status').eq('job_id', jobId), 'job_items.statuses') as Pick<ItemRow, 'status'>[];
      check(await db.from('jobs').update({ status: deriveJobStatus(rows) }).eq('id', jobId), 'jobs.status');
    },

    async countItemsSince(filter, since) {
      if ('deviceId' in filter) {
        const { count, error } = await db
          .from('job_items')
          .select('id', { count: 'exact', head: true })
          .eq('device_id', filter.deviceId)
          .gte('created_at', since.toISOString());
        if (error) throw new Error(`job_items.count failed: ${error.message}`);
        return count ?? 0;
      }
      const { count, error } = await db
        .from('job_items')
        .select('id, jobs!inner(ip_hash)', { count: 'exact', head: true })
        .eq('jobs.ip_hash', filter.ipHash)
        .gte('created_at', since.toISOString());
      if (error) throw new Error(`job_items.count_ip failed: ${error.message}`);
      return count ?? 0;
    },

    async getCachedPost(postId) {
      const row = check(
        await db.from('post_cache').select('post, extracted_json, model').eq('tiktok_post_id', postId).maybeSingle(),
        'post_cache.get',
      ) as { post: unknown; extracted_json: unknown; model: string | null } | null;
      if (!row?.post) return null;
      return { post: row.post, books: (row.extracted_json as { books: unknown }).books, model: row.model ?? 'unknown' } as never;
    },

    async putCachedPost(postId, value) {
      check(
        await db.from('post_cache').upsert({
          tiktok_post_id: postId,
          post: value.post,
          extracted_json: { books: value.books },
          model: value.model,
          fetched_at: new Date().toISOString(),
        }),
        'post_cache.put',
      );
    },

    async recordSpend(event) {
      check(
        await db.from('spend_events').insert({
          device_id: event.deviceId,
          job_item_id: event.jobItemId,
          provider: event.provider,
          usd: event.usd,
          detail: event.detail ?? null,
        }),
        'spend_events.insert',
      );
    },

    async spendSince(since) {
      const value = check(await db.rpc('spend_since', { since: since.toISOString() }), 'spend_since');
      return Number(value ?? 0);
    },

    async clearNewForJob(jobId, deviceId) {
      // Claim the job's "first save" atomically; only the claimant clears the old highlight.
      const claimed = check(
        await db.from('jobs').update({ cleared_new: true }).eq('id', jobId).eq('cleared_new', false).select('id'),
        'jobs.claim_clear_new',
      ) as { id: string }[];
      if (claimed.length === 0) return;
      check(await db.from('books').update({ is_new: false }).eq('device_id', deviceId).eq('is_new', true), 'books.clear_new');
    },

    async dedupCandidates(deviceId) {
      const rows = check(
        await db.from('books').select('id, title, author, isbn10, isbn13, cover_url, published_year').eq('device_id', deviceId),
        'books.candidates',
      ) as Pick<BookRow, 'id' | 'title' | 'author' | 'isbn10' | 'isbn13' | 'cover_url' | 'published_year'>[];
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        author: row.author,
        isbn10: row.isbn10,
        isbn13: row.isbn13,
        coverUrl: row.cover_url,
        publishedYear: row.published_year,
      }));
    },

    async insertBook(deviceId, book) {
      const row = checkOne(
        await db
          .from('books')
          .insert({
            device_id: deviceId,
            title: book.title,
            author: book.author,
            isbn10: book.isbn10,
            isbn13: book.isbn13,
            cover_url: book.coverUrl,
            published_year: book.publishedYear,
            verified: book.verified,
            unsure: book.unsure,
            is_new: true,
            normalized_key: book.normalizedKey,
          })
          .select('id')
          .single<{ id: string }>(),
        'books.insert',
      );
      return row.id;
    },

    async fillBookGaps(bookId, fields) {
      const columns: Record<string, string> = { isbn10: 'isbn10', isbn13: 'isbn13', coverUrl: 'cover_url', publishedYear: 'published_year' };
      for (const [key, value] of Object.entries(fields)) {
        if (value == null) continue;
        const column = columns[key]!;
        check(await db.from('books').update({ [column]: value }).eq('id', bookId).is(column, null), `books.fill_${column}`);
      }
    },

    async addSource(bookId, source) {
      const { error } = await db.from('book_sources').insert({
        book_id: bookId,
        tiktok_post_id: source.postId,
        tiktok_url: source.url,
        creator_handle: source.creatorHandle,
        thumbnail_url: source.thumbnailUrl,
        evidence: source.evidence,
        confidence: source.confidence,
      });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`book_sources.insert failed: ${error.message}`);
    },

    async listBooks(deviceId) {
      const rows = check(
        await db
          .from('books')
          .select(
            'id, title, author, isbn10, isbn13, cover_url, published_year, status, verified, unsure, is_new, notes, created_at, updated_at, book_sources (id, tiktok_post_id, tiktok_url, creator_handle, thumbnail_url, evidence, confidence, created_at)',
          )
          .eq('device_id', deviceId)
          .order('created_at', { ascending: false })
          .limit(5000),
        'books.list',
      ) as BookRow[];
      return rows.map(toBook);
    },
  };
}
