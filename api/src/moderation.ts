import type { AdminPost, AdminPostList, AdminTab, BlockedKind, SourcePlatform, TakedownResponse } from '@booktrap/shared';
import { parseSourceUrl } from '@booktrap/shared';
import { resolveLink } from './pipeline/resolve';
import type { LibraryStore, PostContent, RemovedPostRecord, ReportRecord } from './store/types';

/** Posts listed per admin tab. Reports are read in a bigger batch first, then grouped by post. */
const POSTS_PER_TAB = 100;
const REPORTS_READ = 1000;

const VERDICT_KIND: Partial<Record<PostContent, BlockedKind>> = {
  explicit_non_book: 'explicit',
  graphic_violence: 'graphic',
  refused: 'refused',
};

export class NotAPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAPostError';
  }
}

/** Reports grouped by post, newest activity first. */
function groupReports(reports: ReportRecord[]): Omit<AdminPost, 'reach'>[] {
  const byPost = new Map<string, Omit<AdminPost, 'reach'>>();
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
  reach: null,
});

/** One tab of the admin page, with every tab's count for the page-tabs. */
export async function listAdminPosts(store: LibraryStore, tab: AdminTab): Promise<AdminPostList> {
  const [open, blocked, removed, dismissed] = await Promise.all([
    store.countReports('open'),
    store.countBlockedPosts(),
    store.countRemovedPosts(),
    store.countReports('dismissed'),
  ]);
  let posts: AdminPost[];
  if (tab === 'open' || tab === 'dismissed') {
    const grouped = groupReports(await store.listReports(tab, REPORTS_READ));
    // How far each reported post reached: the operator sees what a takedown would remove.
    posts = await Promise.all(grouped.map(async (post) => ({ ...post, reach: await store.postReach(post.platform, post.postId) })));
  } else if (tab === 'blocked') {
    posts = (await store.listBlockedPosts(POSTS_PER_TAB)).map((entry) => ({
      platform: entry.post.platform,
      postId: entry.post.postId,
      url: entry.post.url,
      creatorHandle: entry.post.creatorHandle,
      reports: [],
      blocked: VERDICT_KIND[entry.content] ?? 'explicit',
      since: entry.fetchedAt,
      last: entry.fetchedAt,
      reach: null,
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
 * Takes a post down everywhere. The link and handle come from its reports when there are any (they're
 * what readers saw), otherwise from what the operator gave.
 */
export async function takeDown(
  store: LibraryStore,
  post: { platform: SourcePlatform; postId: string; url?: string | null; creatorHandle?: string | null },
  reason: RemovedPostRecord['reason'],
): Promise<TakedownResponse> {
  const reported = (await store.listReports('open', REPORTS_READ)).find((r) => r.platform === post.platform && r.postId === post.postId);
  const result = await store.takeDownPost(
    {
      platform: post.platform,
      postId: post.postId,
      url: reported?.url ?? post.url ?? null,
      creatorHandle: reported?.creatorHandle ?? post.creatorHandle ?? null,
    },
    reported && reason === 'admin' ? 'report' : reason,
  );
  return { platform: post.platform, postId: post.postId, ...result };
}
