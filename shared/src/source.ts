/** Where a post comes from. Everything downstream (cache, sources, jobs) keys on platform + post id. */
export const SOURCE_PLATFORMS = ['tiktok', 'instagram'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<SourcePlatform, string> = { tiktok: 'TikTok', instagram: 'Instagram' };

/**
 * - video: a TikTok video, an Instagram reel or IGTV video
 * - photo: a TikTok photo carousel
 * - post: an Instagram /p/ post (a photo, a carousel or a video; known only after fetching)
 * - short: a share link that has to be resolved first
 * - collection: a public TikTok collection or playlist
 * - private_collection: an Instagram saved collection, which only its owner can open
 */
export type SourceLinkKind = 'video' | 'photo' | 'post' | 'short' | 'collection' | 'private_collection';

export interface SourceLink {
  platform: SourcePlatform;
  /** Canonical https URL (query string and fragment dropped). */
  url: string;
  kind: SourceLinkKind;
  /** TikTok's numeric id or Instagram's shortcode; null until a short link is resolved. */
  postId: string | null;
  handle: string | null;
}

/** The cache and dedupe key for a post. */
export function postKey(platform: SourcePlatform, postId: string): string {
  return `${platform}:${postId}`;
}

/** The dedupe key for a pasted link: its post when known, otherwise its canonical URL. */
export function linkKey(link: Pick<SourceLink, 'platform' | 'postId' | 'url'>): string {
  return link.postId ? postKey(link.platform, link.postId) : link.url;
}

/**
 * Videos read from one TikTok collection or playlist for free. Larger collections are planned as a paid
 * option (user, 2026-10-09). The web app and the API both read it from here, so they always agree.
 */
export const FREE_VIDEOS_PER_COLLECTION = 25;

/** Shown when someone pastes an Instagram saved collection, by the web app and the API alike. */
export const PRIVATE_COLLECTION_MESSAGE =
  'Instagram keeps saved collections private, so BookTrap can’t open them. Copy each post’s link (Share, then Copy link) and paste them all here at once.';
