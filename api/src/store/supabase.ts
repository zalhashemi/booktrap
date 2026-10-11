import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book, BookSource, Tag } from '@booktrap/shared';
import {
  DailyCapError,
  TERMINAL_STATUSES,
  TagNameTakenError,
  deriveJobStatus,
  type BlockedPostRecord,
  type BookPatch,
  type CachedPost,
  type JobItemRecord,
  type JobRecord,
  type JobWithItems,
  type LibraryStore,
  type NewItem,
  type PostContent,
  type RemovedPostRecord,
  type ReportRecord,
} from './types';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

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
  user_id: string;
  status: JobRecord['status'];
  cleared_new: boolean;
  created_at: string;
  job_items?: ItemRow[];
}

interface ItemRow {
  id: string;
  job_id: string;
  user_id: string;
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
  blocked: JobItemRecord['blocked'];
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

const ITEM_COLUMNS = 'id, job_id, user_id, input_url, source_platform, source_post_id, kind, status, error, books_found, attempts, parent_item_id, note, blocked, created_at';

const toItem = (row: ItemRow): JobItemRecord => ({
  id: row.id,
  jobId: row.job_id,
  userId: row.user_id,
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
  blocked: row.blocked ?? null,
  createdAt: row.created_at,
});

/** The shape `create_job_capped` and `add_child_items_capped` read (0007_hardening.sql). */
const toItemJson = (item: NewItem) => ({
  input_url: item.inputUrl,
  source_platform: item.platform,
  source_post_id: item.postId,
  kind: item.kind,
});

/** Caps off: the functions still insert atomically, with nothing to refuse. */
const NO_CAP = 2_147_483_647;

const toJob = (row: JobRow): JobWithItems => ({
  id: row.id,
  userId: row.user_id,
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
  const jobSelect = `id, user_id, status, cleared_new, created_at, job_items (${ITEM_COLUMNS})`;

  return {
    async createJob(userId, ipHash, items, caps) {
      const result = check(
        await db.rpc('create_job_capped', {
          p_user_id: userId,
          p_ip_hash: ipHash,
          p_items: items.map(toItemJson),
          p_posts: caps?.posts ?? 0,
          p_user_cap: caps?.perUser ?? NO_CAP,
          p_ip_cap: caps?.perIp ?? NO_CAP,
          p_since: (caps?.since ?? new Date()).toISOString(),
        }),
        'create_job_capped',
      ) as { job_id?: string; capped?: 'user' | 'ip'; used?: number };
      if (result.capped) throw new DailyCapError(result.capped, result.used ?? 0);
      const created = result.job_id ? await this.getJob(userId, result.job_id) : null;
      if (!created) throw new Error('job vanished after insert');
      return created;
    },

    async addChildItems(parent, children, caps) {
      if (children.length === 0) return [];
      const rows = check(
        await db.rpc('add_child_items_capped', {
          p_parent_id: parent.id,
          p_items: children.map(toItemJson),
          p_user_cap: caps?.perUser ?? NO_CAP,
          p_ip_cap: caps?.perIp ?? NO_CAP,
          p_since: (caps?.since ?? new Date()).toISOString(),
        }),
        'add_child_items_capped',
      ) as ItemRow[];
      return rows.map(toItem).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

    async getJob(userId, jobId) {
      const row = check(
        await db.from('jobs').select(jobSelect).eq('id', jobId).eq('user_id', userId).maybeSingle<JobRow>(),
        'jobs.get',
      );
      return row ? toJob(row) : null;
    },

    async listJobs(userId, limit) {
      const rows = check(
        await db.from('jobs').select(jobSelect).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
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
      if (patch.blocked !== undefined) row.blocked = patch.blocked;
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
      if ('userId' in filter) {
        const { count, error } = await db
          .from('job_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', filter.userId)
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
      const extracted = row.extracted_json as { books: unknown; content?: PostContent };
      return { post: row.post, books: extracted.books, model: row.model ?? 'unknown', content: extracted.content ?? 'books' } as unknown as CachedPost;
    },

    async putCachedPost(platform, postId, value) {
      check(
        await db.from('post_cache').upsert({
          source_platform: platform,
          source_post_id: postId,
          post: value.post,
          extracted_json: { books: value.books, content: value.content },
          model: value.model,
          fetched_at: new Date().toISOString(),
        }),
        'post_cache.put',
      );
    },

    async recordSpend(event) {
      const row = { user_id: event.userId, job_item_id: event.jobItemId, provider: event.provider, usd: event.usd, detail: event.detail ?? null };
      let result = await db.from('spend_events').insert(row);
      // The shelf was deleted while its post was being read: the money is still spent, so keep it without them.
      if (result.error?.code === FOREIGN_KEY_VIOLATION) result = await db.from('spend_events').insert({ ...row, user_id: null, job_item_id: null });
      check(result, 'spend_events.insert');
    },

    async spendSince(since) {
      const value = check(await db.rpc('spend_since', { since: since.toISOString() }), 'spend_since');
      return Number(value ?? 0);
    },

    async clearNewForJob(jobId, userId) {
      // Claim the job's "first save" atomically; only the claimant clears the old highlight.
      const claimed = check(
        await db.from('jobs').update({ cleared_new: true }).eq('id', jobId).eq('cleared_new', false).select('id'),
        'jobs.claim_clear_new',
      ) as { id: string }[];
      if (claimed.length === 0) return;
      check(await db.from('books').update({ is_new: false }).eq('user_id', userId).eq('is_new', true), 'books.clear_new');
    },

    async dedupCandidates(userId) {
      const rows = check(
        await db.from('books').select('id, title, author, isbn10, isbn13, cover_url, published_year').eq('user_id', userId).is('deleted_at', null),
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

    async insertBook(userId, book) {
      const row = checkOne(
        await db
          .from('books')
          .insert({
            user_id: userId,
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

    async listBooks(userId) {
      const rows = check(
        await db
          .from('books')
          .select(BOOK_SELECT)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5000),
        'books.list',
      ) as unknown as BookRow[];
      return rows.map(toBook);
    },

    async countBooks(userId) {
      const { count, error } = await db.from('books').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null);
      if (error) throw new Error(`books.count failed: ${error.message}`);
      return count ?? 0;
    },

    async eraseUser(userId) {
      check(await db.rpc('delete_user_data', { p_user_id: userId }), 'delete_user_data');
    },

    async transferShelf(fromUserId, toUserId) {
      // Shelves first: a name the account already has is folded into the account's shelf.
      const [theirs, ours] = await Promise.all([this.listTags(fromUserId), this.listTags(toUserId)]);
      for (const tag of theirs) {
        const same = ours.find((existing) => existing.name.toLowerCase() === tag.name.toLowerCase());
        if (same) {
          const rows = check(await db.from('book_tags').select('book_id').eq('tag_id', tag.id), 'book_tags.list') as { book_id: string }[];
          if (rows.length) {
            check(
              await db.from('book_tags').upsert(rows.map((row) => ({ book_id: row.book_id, tag_id: same.id })), { ignoreDuplicates: true }),
              'book_tags.fold',
            );
          }
          check(await db.from('tags').delete().eq('id', tag.id).eq('user_id', fromUserId), 'tags.fold');
        } else {
          check(await db.from('tags').update({ user_id: toUserId }).eq('id', tag.id).eq('user_id', fromUserId), 'tags.move');
        }
      }
      // Jobs and their items move too, so today's posts keep counting against the account's cap.
      for (const table of ['jobs', 'job_items', 'spend_events']) {
        check(await db.from(table).update({ user_id: toUserId }).eq('user_id', fromUserId), `${table}.move`);
      }
    },

    async moveBooks(fromUserId, toUserId, bookIds) {
      let query = db.from('books').update({ user_id: toUserId }).eq('user_id', fromUserId);
      if (bookIds !== 'all') {
        if (bookIds.length === 0) return;
        query = query.in('id', bookIds);
      }
      check(await query, 'books.move');
    },

    async purgeDeletedBooks() {
      const count = check(await db.rpc('purge_deleted_books'), 'purge_deleted_books');
      return Number(count ?? 0);
    },

    async expireRetention({ postCacheBefore, ipHashBefore }) {
      const posts = await db.from('post_cache').delete({ count: 'exact' }).lt('fetched_at', postCacheBefore.toISOString());
      if (posts.error) throw new Error(`post_cache.expire failed: ${posts.error.message}`);
      const jobs = await db
        .from('jobs')
        .update({ ip_hash: null }, { count: 'exact' })
        .lt('created_at', ipHashBefore.toISOString())
        .not('ip_hash', 'is', null);
      if (jobs.error) throw new Error(`jobs.expire_ip failed: ${jobs.error.message}`);
      const carried = await db.from('network_usage').delete({ count: 'exact' }).lt('used_at', ipHashBefore.toISOString());
      if (carried.error) throw new Error(`network_usage.expire failed: ${carried.error.message}`);
      return { posts: posts.count ?? 0, ipHashes: (jobs.count ?? 0) + (carried.count ?? 0) };
    },

    async purgeOldJobs(before) {
      return Number(check(await db.rpc('purge_old_jobs', { p_before: before.toISOString() }), 'purge_old_jobs') ?? 0);
    },

    async isPostRemoved(platform, postId) {
      const row = check(
        await db.from('removed_posts').select('source_post_id').eq('source_platform', platform).eq('source_post_id', postId).maybeSingle(),
        'removed_posts.get',
      );
      return row !== null;
    },

    async findOwnSource(userId, platform, postId) {
      const rows = check(
        await db
          .from('book_sources')
          .select('source_url, creator_handle, books!inner(user_id, deleted_at)')
          .eq('source_platform', platform)
          .eq('source_post_id', postId)
          .eq('books.user_id', userId)
          .is('books.deleted_at', null)
          .limit(1),
        'book_sources.own',
      ) as { source_url: string; creator_handle: string | null }[];
      const row = rows[0];
      return row ? { url: row.source_url, creatorHandle: row.creator_handle } : null;
    },

    async createReport(userId, report) {
      const { error } = await db.from('reports').insert({
        user_id: userId,
        source_platform: report.platform,
        source_post_id: report.postId,
        source_url: report.url,
        creator_handle: report.creatorHandle,
        reason: report.reason,
        note: report.note,
      });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`reports.insert failed: ${error.message}`);
    },

    async countReportsSince(userId, since) {
      const { count, error } = await db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', since.toISOString());
      if (error) throw new Error(`reports.count_user failed: ${error.message}`);
      return count ?? 0;
    },

    async listReports(status, limit) {
      const rows = check(
        await db
          .from('reports')
          .select('id, source_platform, source_post_id, source_url, creator_handle, reason, note, status, created_at')
          .eq('status', status)
          .order('created_at', { ascending: false })
          .limit(limit),
        'reports.list',
      ) as ReportRow[];
      return rows.map(toReport);
    },

    async countReports(status) {
      const { count, error } = await db.from('reports').select('id', { count: 'exact', head: true }).eq('status', status);
      if (error) throw new Error(`reports.count failed: ${error.message}`);
      return count ?? 0;
    },

    async dismissReports(platform, postId) {
      const rows = check(
        await db
          .from('reports')
          .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
          .eq('source_platform', platform)
          .eq('source_post_id', postId)
          .eq('status', 'open')
          .select('id'),
        'reports.dismiss',
      ) as { id: string }[];
      return rows.length;
    },

    async listRemovedPosts(limit) {
      const rows = check(
        await db
          .from('removed_posts')
          .select('source_platform, source_post_id, source_url, creator_handle, reason, removed_at')
          .order('removed_at', { ascending: false })
          .limit(limit),
        'removed_posts.list',
      ) as {
        source_platform: RemovedPostRecord['platform'];
        source_post_id: string;
        source_url: string | null;
        creator_handle: string | null;
        reason: RemovedPostRecord['reason'];
        removed_at: string;
      }[];
      return rows.map((row) => ({
        platform: row.source_platform,
        postId: row.source_post_id,
        url: row.source_url,
        creatorHandle: row.creator_handle,
        reason: row.reason,
        removedAt: row.removed_at,
      }));
    },

    async countRemovedPosts() {
      const { count, error } = await db.from('removed_posts').select('source_post_id', { count: 'exact', head: true });
      if (error) throw new Error(`removed_posts.count failed: ${error.message}`);
      return count ?? 0;
    },

    async listBlockedPosts(limit) {
      const rows = check(
        await db
          .from('post_cache')
          .select('post, extracted_json, fetched_at')
          .in('extracted_json->>content', BLOCKING_CONTENT)
          .order('fetched_at', { ascending: false })
          .limit(limit),
        'post_cache.blocked',
      ) as { post: BlockedPostRecord['post']; extracted_json: { content: PostContent }; fetched_at: string }[];
      return rows.map((row) => ({ post: row.post, content: row.extracted_json.content, fetchedAt: row.fetched_at }));
    },

    async countBlockedPosts() {
      const { count, error } = await db
        .from('post_cache')
        .select('source_post_id', { count: 'exact', head: true })
        .in('extracted_json->>content', BLOCKING_CONTENT);
      if (error) throw new Error(`post_cache.count_blocked failed: ${error.message}`);
      return count ?? 0;
    },

    async postReach(platform, postId) {
      const rows = check(await db.rpc('post_reach', { p_platform: platform, p_post_id: postId }), 'post_reach') as
        | { shelves: number; only_here: number; edited: number }[]
        | { shelves: number; only_here: number; edited: number };
      const row = Array.isArray(rows) ? rows[0] : rows;
      return { shelves: row?.shelves ?? 0, onlyHere: row?.only_here ?? 0, edited: row?.edited ?? 0 };
    },

    async takeDownPost(post, reason) {
      const result = check(
        await db.rpc('take_down_post', {
          p_platform: post.platform,
          p_post_id: post.postId,
          p_reason: reason,
          p_url: post.url,
          p_handle: post.creatorHandle,
        }),
        'take_down_post',
      ) as { sources_removed: number; books_deleted: number; books_kept: number };
      return { sourcesRemoved: result.sources_removed, booksDeleted: result.books_deleted, booksKept: result.books_kept };
    },

    async unblockPost(platform, postId) {
      const removed = check(
        await db.from('removed_posts').delete().eq('source_platform', platform).eq('source_post_id', postId).select('source_post_id'),
        'removed_posts.delete',
      ) as unknown[];
      const cached = await this.getCachedPost(platform, postId);
      const skipped = cached !== null && BLOCKING_CONTENT.includes(cached.content);
      if (cached && cached.content === 'refused') {
        // Nothing was read, so there are no books to keep: the next paste reads it again.
        check(await db.from('post_cache').delete().eq('source_platform', platform).eq('source_post_id', postId), 'post_cache.unblock');
      } else if (cached && skipped) {
        await this.putCachedPost(platform, postId, { ...cached, content: 'books' });
      }
      return removed.length > 0 || skipped;
    },

    async getBook(userId, bookId) {
      const row = check(
        await db.from('books').select(BOOK_SELECT).eq('id', bookId).eq('user_id', userId).is('deleted_at', null).maybeSingle(),
        'books.get',
      ) as unknown as BookRow | null;
      return row ? toBook(row) : null;
    },

    async updateBook(userId, bookId, patch) {
      const row: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) row[PATCH_COLUMNS[key as keyof BookPatch]] = value;
      }
      if (Object.keys(row).length) {
        check(await db.from('books').update(row).eq('id', bookId).eq('user_id', userId).is('deleted_at', null), 'books.update');
      }
      return this.getBook(userId, bookId);
    },

    async removeBook(userId, bookId) {
      check(await db.from('books').delete().eq('id', bookId).eq('user_id', userId), 'books.remove');
    },

    async deleteBooks(userId, bookIds) {
      let count = 0;
      // Ids travel in the URL (PostgREST `in` filter): keep each request well under URL limits.
      for (const chunk of chunks(bookIds, ID_CHUNK)) {
        const rows = check(
          await db
            .from('books')
            .update({ deleted_at: new Date().toISOString() })
            .eq('user_id', userId)
            .in('id', chunk)
            .is('deleted_at', null)
            .select('id'),
          'books.delete',
        ) as { id: string }[];
        count += rows.length;
      }
      return count;
    },

    async restoreBooks(userId, bookIds) {
      let count = 0;
      for (const chunk of chunks(bookIds, ID_CHUNK)) {
        const rows = check(
          await db
            .from('books')
            .update({ deleted_at: null })
            .eq('user_id', userId)
            .in('id', chunk)
            .not('deleted_at', 'is', null)
            .select('id'),
          'books.restore',
        ) as { id: string }[];
        count += rows.length;
      }
      return count;
    },

    async markAllSeen(userId) {
      const rows = check(
        await db.from('books').update({ is_new: false }).eq('user_id', userId).eq('is_new', true).is('deleted_at', null).select('id'),
        'books.mark_seen',
      ) as { id: string }[];
      return rows.length;
    },

    async mergeBooks(userId, keepId, mergeIds) {
      const keep = await this.getBook(userId, keepId);
      if (!keep) return null;
      for (const id of mergeIds) {
        if (id === keepId) continue;
        const other = await this.getBook(userId, id);
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
        check(await db.from('books').delete().eq('id', id).eq('user_id', userId), 'books.merge_delete');
      }
      return this.getBook(userId, keepId);
    },

    async listTags(userId) {
      return check(await db.from('tags').select('id, name').eq('user_id', userId).order('name'), 'tags.list') as Tag[];
    },

    async createTag(userId, name) {
      const { data, error } = await db.from('tags').insert({ user_id: userId, name }).select('id, name').single<Tag>();
      if (!error && data) return data;
      if (error?.code !== UNIQUE_VIOLATION) throw new Error(`tags.insert failed: ${error?.message}`);
      const existing = (await this.listTags(userId)).find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (!existing) throw new Error('tags.insert conflicted but no tag was found');
      return existing;
    },

    async renameTag(userId, tagId, name) {
      const { data, error } = await db
        .from('tags')
        .update({ name })
        .eq('id', tagId)
        .eq('user_id', userId)
        .select('id, name')
        .maybeSingle<Tag>();
      if (error?.code === UNIQUE_VIOLATION) throw new TagNameTakenError();
      if (error) throw new Error(`tags.rename failed: ${error.message}`);
      return data;
    },

    async deleteTag(userId, tagId) {
      const rows = check(await db.from('tags').delete().eq('id', tagId).eq('user_id', userId).select('id'), 'tags.delete') as {
        id: string;
      }[];
      return rows.length > 0;
    },

    async countTags(userId) {
      const { count, error } = await db.from('tags').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (error) throw new Error(`tags.count failed: ${error.message}`);
      return count ?? 0;
    },

    async setBookTags(userId, bookId, tagIds) {
      const book = check(
        await db.from('books').select('id').eq('id', bookId).eq('user_id', userId).is('deleted_at', null).maybeSingle(),
        'books.owner',
      );
      if (!book) return;
      const owned = tagIds.length
        ? (check(await db.from('tags').select('id').eq('user_id', userId).in('id', tagIds), 'tags.owned') as { id: string }[]).map(
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

/** Verdicts that skip a post. */
const BLOCKING_CONTENT: PostContent[] = ['explicit_non_book', 'graphic_violence', 'refused'];

interface ReportRow {
  id: string;
  source_platform: ReportRecord['platform'];
  source_post_id: string;
  source_url: string;
  creator_handle: string | null;
  reason: ReportRecord['reason'];
  note: string | null;
  status: ReportRecord['status'];
  created_at: string;
}

const toReport = (row: ReportRow): ReportRecord => ({
  id: row.id,
  platform: row.source_platform,
  postId: row.source_post_id,
  url: row.source_url,
  creatorHandle: row.creator_handle,
  reason: row.reason,
  note: row.note,
  status: row.status,
  createdAt: row.created_at,
});

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
