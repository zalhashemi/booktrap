import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book, BookSource, Tag } from '@booktrap/shared';
import {
  TERMINAL_STATUSES,
  TagNameTakenError,
  deriveJobStatus,
  type BookPatch,
  type JobItemRecord,
  type JobRecord,
  type JobWithItems,
  type LibraryStore,
} from './types';

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
  source_platform: JobItemRecord['platform'];
  source_post_id: string | null;
  kind: JobItemRecord['kind'];
  status: JobItemRecord['status'];
  error: string | null;
  books_found: number;
  attempts: number;
  parent_item_id: string | null;
  note: string | null;
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
  is_new: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  book_sources?: SourceRow[];
  book_tags?: { tags: { id: string; name: string } | null }[];
}

interface SourceRow {
  id: string;
  source_platform: BookSource['platform'];
  source_post_id: string;
  source_url: string;
  creator_handle: string | null;
  thumbnail_url: string | null;
  evidence: BookSource['evidence'];
  confidence: number | null;
  created_at: string;
}

const ITEM_COLUMNS = 'id, job_id, device_id, input_url, source_platform, source_post_id, kind, status, error, books_found, attempts, parent_item_id, note, created_at';

const toItem = (row: ItemRow): JobItemRecord => ({
  id: row.id,
  jobId: row.job_id,
  deviceId: row.device_id,
  inputUrl: row.input_url,
  platform: row.source_platform,
  postId: row.source_post_id,
  kind: row.kind,
  status: row.status,
  error: row.error,
  booksFound: row.books_found,
  attempts: row.attempts,
  parentItemId: row.parent_item_id,
  note: row.note,
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
  platform: row.source_platform,
  postId: row.source_post_id,
  url: row.source_url,
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
  isNew: row.is_new,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sources: (row.book_sources ?? []).map(toSource).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  tags: (row.book_tags ?? [])
    .map((link) => link.tags)
    .filter((tag): tag is Tag => Boolean(tag))
    .sort((a, b) => a.name.localeCompare(b.name)),
});

const BOOK_SELECT =
  'id, title, author, isbn10, isbn13, cover_url, published_year, status, is_new, notes, created_at, updated_at, ' +
  'book_sources (id, source_platform, source_post_id, source_url, creator_handle, thumbnail_url, evidence, confidence, created_at), ' +
  'book_tags (tags (id, name))';

const PATCH_COLUMNS: Record<keyof BookPatch, string> = {
  title: 'title',
  author: 'author',
  isbn10: 'isbn10',
  isbn13: 'isbn13',
  coverUrl: 'cover_url',
  publishedYear: 'published_year',
  status: 'status',
  notes: 'notes',
  verified: 'verified',
  isNew: 'is_new',
  normalizedKey: 'normalized_key',
};

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
            source_platform: item.platform,
            source_post_id: item.postId,
            kind: item.kind,
          })),
        ),
        'job_items.insert',
      );
      const created = await this.getJob(deviceId, job.id);
      if (!created) throw new Error('job vanished after insert');
      return created;
    },

    async addChildItems(parent, children) {
      if (children.length === 0) return [];
      const rows = check(
        await db
          .from('job_items')
          .insert(
            children.map((child) => ({
              job_id: parent.jobId,
              device_id: parent.deviceId,
              parent_item_id: parent.id,
              input_url: child.inputUrl,
              source_platform: child.platform,
              source_post_id: child.postId,
              kind: child.kind,
            })),
          )
          .select(ITEM_COLUMNS),
        'job_items.insert_children',
      ) as ItemRow[];
      return rows.map(toItem);
    },

    async childItems(parentItemId) {
      const rows = check(
        await db.from('job_items').select(ITEM_COLUMNS).eq('parent_item_id', parentItemId).order('created_at', { ascending: true }),
        'job_items.children',
      ) as ItemRow[];
      return rows.map(toItem);
    },

    async jobIpHash(jobId) {
      const row = check(await db.from('jobs').select('ip_hash').eq('id', jobId).maybeSingle(), 'jobs.ip_hash') as { ip_hash: string | null } | null;
      return row?.ip_hash ?? null;
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
      if (patch.platform !== undefined) row.source_platform = patch.platform;
      if (patch.postId !== undefined) row.source_post_id = patch.postId;
      if (patch.kind !== undefined) row.kind = patch.kind;
      if (patch.attempts !== undefined) row.attempts = patch.attempts;
      if (patch.note !== undefined) row.note = patch.note;
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
          .or('kind.is.null,kind.neq.collection')
          .gte('created_at', since.toISOString());
        if (error) throw new Error(`job_items.count failed: ${error.message}`);
        return count ?? 0;
      }
      const { count, error } = await db
        .from('job_items')
        .select('id, jobs!inner(ip_hash)', { count: 'exact', head: true })
        .eq('jobs.ip_hash', filter.ipHash)
        .or('kind.is.null,kind.neq.collection')
        .gte('created_at', since.toISOString());
      if (error) throw new Error(`job_items.count_ip failed: ${error.message}`);
      return count ?? 0;
    },

    async getCachedPost(platform, postId) {
      const row = check(
        await db
          .from('post_cache')
          .select('post, extracted_json, model')
          .eq('source_platform', platform)
          .eq('source_post_id', postId)
          .maybeSingle(),
        'post_cache.get',
      ) as { post: Record<string, unknown> | null; extracted_json: unknown; model: string | null } | null;
      if (!row?.post) return null;
      return { post: row.post, books: (row.extracted_json as { books: unknown }).books, model: row.model ?? 'unknown' } as never;
    },

    async putCachedPost(platform, postId, value) {
      check(
        await db.from('post_cache').upsert({
          source_platform: platform,
          source_post_id: postId,
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
        await db.from('books').select('id, title, author, isbn10, isbn13, cover_url, published_year').eq('device_id', deviceId).is('deleted_at', null),
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
        source_platform: source.platform,
        source_post_id: source.postId,
        source_url: source.url,
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
          .select(BOOK_SELECT)
          .eq('device_id', deviceId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5000),
        'books.list',
      ) as unknown as BookRow[];
      return rows.map(toBook);
    },

    async purgeDeletedBooks() {
      const count = check(await db.rpc('purge_deleted_books'), 'purge_deleted_books');
      return Number(count ?? 0);
    },

    async getBook(deviceId, bookId) {
      const row = check(
        await db.from('books').select(BOOK_SELECT).eq('id', bookId).eq('device_id', deviceId).is('deleted_at', null).maybeSingle(),
        'books.get',
      ) as unknown as BookRow | null;
      return row ? toBook(row) : null;
    },

    async updateBook(deviceId, bookId, patch) {
      const row: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) row[PATCH_COLUMNS[key as keyof BookPatch]] = value;
      }
      if (Object.keys(row).length) {
        check(await db.from('books').update(row).eq('id', bookId).eq('device_id', deviceId).is('deleted_at', null), 'books.update');
      }
      return this.getBook(deviceId, bookId);
    },

    async removeBook(deviceId, bookId) {
      check(await db.from('books').delete().eq('id', bookId).eq('device_id', deviceId), 'books.remove');
    },

    async deleteBooks(deviceId, bookIds) {
      let count = 0;
      // Ids travel in the URL (PostgREST `in` filter): keep each request well under URL limits.
      for (const chunk of chunks(bookIds, ID_CHUNK)) {
        const rows = check(
          await db
            .from('books')
            .update({ deleted_at: new Date().toISOString() })
            .eq('device_id', deviceId)
            .in('id', chunk)
            .is('deleted_at', null)
            .select('id'),
          'books.delete',
        ) as { id: string }[];
        count += rows.length;
      }
      return count;
    },

    async restoreBooks(deviceId, bookIds) {
      let count = 0;
      for (const chunk of chunks(bookIds, ID_CHUNK)) {
        const rows = check(
          await db
            .from('books')
            .update({ deleted_at: null })
            .eq('device_id', deviceId)
            .in('id', chunk)
            .not('deleted_at', 'is', null)
            .select('id'),
          'books.restore',
        ) as { id: string }[];
        count += rows.length;
      }
      return count;
    },

    async markAllSeen(deviceId) {
      const rows = check(
        await db.from('books').update({ is_new: false }).eq('device_id', deviceId).eq('is_new', true).is('deleted_at', null).select('id'),
        'books.mark_seen',
      ) as { id: string }[];
      return rows.length;
    },

    async mergeBooks(deviceId, keepId, mergeIds) {
      const keep = await this.getBook(deviceId, keepId);
      if (!keep) return null;
      for (const id of mergeIds) {
        if (id === keepId) continue;
        const other = await this.getBook(deviceId, id);
        if (!other) continue;
        for (const source of other.sources) {
          await this.addSource(keepId, {
            platform: source.platform,
            postId: source.postId,
            url: source.url,
            creatorHandle: source.creatorHandle,
            thumbnailUrl: source.thumbnailUrl,
            evidence: source.evidence,
            confidence: source.confidence,
          });
        }
        if (other.tags.length) {
          check(
            await db.from('book_tags').upsert(
              other.tags.map((tag) => ({ book_id: keepId, tag_id: tag.id })),
              { ignoreDuplicates: true },
            ),
            'book_tags.merge',
          );
        }
        await this.fillBookGaps(keepId, {
          isbn10: other.isbn10,
          isbn13: other.isbn13,
          coverUrl: other.coverUrl,
          publishedYear: other.publishedYear,
        });
        if (other.notes) {
          check(await db.from('books').update({ notes: other.notes }).eq('id', keepId).is('notes', null), 'books.merge_notes');
        }
        check(await db.from('books').delete().eq('id', id).eq('device_id', deviceId), 'books.merge_delete');
      }
      return this.getBook(deviceId, keepId);
    },

    async listTags(deviceId) {
      return check(await db.from('tags').select('id, name').eq('device_id', deviceId).order('name'), 'tags.list') as Tag[];
    },

    async createTag(deviceId, name) {
      const { data, error } = await db.from('tags').insert({ device_id: deviceId, name }).select('id, name').single<Tag>();
      if (!error && data) return data;
      if (error?.code !== UNIQUE_VIOLATION) throw new Error(`tags.insert failed: ${error?.message}`);
      const existing = (await this.listTags(deviceId)).find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (!existing) throw new Error('tags.insert conflicted but no tag was found');
      return existing;
    },

    async renameTag(deviceId, tagId, name) {
      const { data, error } = await db
        .from('tags')
        .update({ name })
        .eq('id', tagId)
        .eq('device_id', deviceId)
        .select('id, name')
        .maybeSingle<Tag>();
      if (error?.code === UNIQUE_VIOLATION) throw new TagNameTakenError();
      if (error) throw new Error(`tags.rename failed: ${error.message}`);
      return data;
    },

    async deleteTag(deviceId, tagId) {
      const rows = check(await db.from('tags').delete().eq('id', tagId).eq('device_id', deviceId).select('id'), 'tags.delete') as {
        id: string;
      }[];
      return rows.length > 0;
    },

    async setBookTags(deviceId, bookId, tagIds) {
      const book = check(
        await db.from('books').select('id').eq('id', bookId).eq('device_id', deviceId).is('deleted_at', null).maybeSingle(),
        'books.owner',
      );
      if (!book) return;
      const owned = tagIds.length
        ? (check(await db.from('tags').select('id').eq('device_id', deviceId).in('id', tagIds), 'tags.owned') as { id: string }[]).map(
            (tag) => tag.id,
          )
        : [];
      // Add the wanted links first, then drop the rest: a failure part-way never strips every tag.
      if (owned.length) {
        check(
          await db.from('book_tags').upsert(
            owned.map((tagId) => ({ book_id: bookId, tag_id: tagId })),
            { ignoreDuplicates: true },
          ),
          'book_tags.add',
        );
      }
      const removal = db.from('book_tags').delete().eq('book_id', bookId);
      check(await (owned.length ? removal.not('tag_id', 'in', `(${owned.join(',')})`) : removal), 'book_tags.remove');
    },
  };
}

const ID_CHUNK = 100;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
