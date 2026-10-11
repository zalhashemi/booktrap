import type { AdminPost, AdminPostList, AdminTab, SourcePlatform, TakedownResponse } from '@booktrap/shared';
import { parseSourceUrl } from '@booktrap/shared';
import { resolveLink } from './pipeline/resolve';
import { BLOCKED_BY_CONTENT, type LibraryStore, type RemovedPostRecord, type ReportRecord } from './store/types';

/** Posts listed per admin tab. Reports are read in a bigger batch first, then grouped by post. */
const POSTS_PER_TAB = 100;
const REPORTS_READ = 1000;


export class NotAPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAPostError';
  }
}

/** Reports grouped by post, newest activity first. */
function groupReports(reports: ReportRecord[]): AdminPost[] {
  const byPost = new Map<string, AdminPost>();
  for (const report of reports) {
    const key = `${report.platform}:${report.postId}`;
    const entry = byPost.get(key) ?? {
      platform: report.platform,
      postId: report.postId,
      url: report.url,
      creatorHandle: report.creatorHandle,
      reports: [],
      blocked: null,
      since: report.createdAt,
      last: report.createdAt,
    };
    entry.reports.push({ id: report.id, reason: report.reason, note: report.note, createdAt: report.createdAt });
    if (report.createdAt < entry.since) entry.since = report.createdAt;
    if (report.createdAt > entry.last) entry.last = report.createdAt;
    byPost.set(key, entry);
  }
  return [...byPost.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, POSTS_PER_TAB);
}

const removedToPost = (post: RemovedPostRecord): AdminPost => ({
  platform: post.platform,
  postId: post.postId,
  url: post.url,
  creatorHandle: post.creatorHandle,
  reports: [],
  blocked: 'removed',
  since: post.removedAt,
  last: post.removedAt,
});

/**
 * One tab of the admin page, with every tab's count for the page-tabs. How far a post reached is
 * asked for the chosen post only (`/admin/reach`), not for every row.
 */
export async function listAdminPosts(store: LibraryStore, tab: AdminTab): Promise<AdminPostList> {
  const [open, blocked, removed, dismissed] = await Promise.all([
    store.countReports('open'),
    store.countBlockedPosts(),
    store.countRemovedPosts(),
    store.countReports('dismissed'),
  ]);
  let posts: AdminPost[];
  if (tab === 'open' || tab === 'dismissed') {
    posts = groupReports(await store.listReports(tab, REPORTS_READ));
  } else if (tab === 'blocked') {
    posts = (await store.listBlockedPosts(POSTS_PER_TAB)).map((entry) => ({
      platform: entry.post.platform,
      postId: entry.post.postId,
      url: entry.post.url,
      creatorHandle: entry.post.creatorHandle,
      reports: [],
      blocked: BLOCKED_BY_CONTENT[entry.content] ?? 'explicit',
      since: entry.fetchedAt,
      last: entry.fetchedAt,
    }));
  } else {
    posts = (await store.listRemovedPosts(POSTS_PER_TAB)).map(removedToPost);
  }
  return { posts, counts: { open, blocked, removed, dismissed } };
}

/** The post a pasted link points at (short links are followed), for a takedown by email request. */
export async function postFromUrl(url: string, resolve: typeof resolveLink = resolveLink) {
  const link = parseSourceUrl(url.trim());
  if (!link) throw new NotAPostError('That isn’t a TikTok or Instagram post link.');
  const resolved = link.postId ? link : await resolve(link);
  if (!resolved.postId || resolved.kind === 'collection' || resolved.kind === 'private_collection') {
    throw new NotAPostError('That link doesn’t lead to a single post.');
  }
  return { platform: resolved.platform, postId: resolved.postId, url: resolved.url, creatorHandle: resolved.handle };
}

/**
 * Takes a post down everywhere. Its link and handle are kept on the record: from a report (what readers
 * saw), the cache or a shelf, otherwise what the operator gave. Read before the takedown deletes them.
 */
export async function takeDown(
  store: LibraryStore,
  post: { platform: SourcePlatform; postId: string; url?: string | null; creatorHandle?: string | null },
  reason: RemovedPostRecord['reason'],
): Promise<TakedownResponse> {
  const known = await store.describePost(post.platform, post.postId);
  const result = await store.takeDownPost(
    {
      platform: post.platform,
      postId: post.postId,
      url: known.url ?? post.url ?? null,
      creatorHandle: known.creatorHandle ?? post.creatorHandle ?? null,
    },
    known.reported && reason === 'admin' ? 'report' : reason,
  );
  return { platform: post.platform, postId: post.postId, ...result };
}
