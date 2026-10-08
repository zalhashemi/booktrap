/**
 * TikTok link parsing, shared by the web app (paste preview) and the API (validation).
 * Only hosts on this allowlist are ever fetched by the server.
 */

export const TIKTOK_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'] as const;
const SHORT_LINK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

export type TikTokLinkKind = 'video' | 'photo' | 'short' | 'collection';

export interface TikTokLink {
  /** Canonical https URL (query string and fragment dropped). */
  url: string;
  kind: TikTokLinkKind;
  /** Numeric post id for video/photo links; null until a short link is resolved. */
  postId: string | null;
  handle: string | null;
}

const POST_PATH = /^\/@([\w.-]+)\/(video|photo)\/(\d{8,25})\/?$/;
const COLLECTION_PATH = /^\/@([\w.-]+)\/collection\/([^/]+?)-(\d{8,25})\/?$/;
const SHORT_PATH = /^\/(?:t\/)?[A-Za-z0-9]{5,20}\/?$/;

export function isTikTokHost(hostname: string): boolean {
  return (TIKTOK_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}

/** Parses one URL. Returns null for anything that is not a recognised TikTok post, short or collection link. */
export function parseTikTokUrl(raw: string): TikTokLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!isTikTokHost(host)) return null;

  if (SHORT_LINK_HOSTS.has(host) || (host.endsWith('tiktok.com') && url.pathname.startsWith('/t/'))) {
    if (!SHORT_PATH.test(url.pathname)) return null;
    return { url: `https://${host}${url.pathname.replace(/\/?$/, '/')}`, kind: 'short', postId: null, handle: null };
  }

  const post = POST_PATH.exec(url.pathname);
  if (post) {
    const [, handle, type, id] = post as unknown as [string, string, 'video' | 'photo', string];
    return { url: `https://www.tiktok.com/@${handle}/${type}/${id}`, kind: type, postId: id, handle };
  }

  const collection = COLLECTION_PATH.exec(url.pathname);
  if (collection) {
    const [, handle, slug, id] = collection as unknown as [string, string, string, string];
    return {
      url: `https://www.tiktok.com/@${handle}/collection/${slug}-${id}`,
      kind: 'collection',
      postId: null,
      handle,
    };
  }
  return null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'()\]]+/gi;

/**
 * Pulls every TikTok link out of pasted text (a list, a share message, a whole chat).
 * Duplicates are dropped, keeping first occurrence order.
 */
export function extractTikTokLinks(text: string): TikTokLink[] {
  const seen = new Set<string>();
  const links: TikTokLink[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const link = parseTikTokUrl(match[0].replace(/[.,;:!?]+$/, ''));
    if (!link) continue;
    const key = link.postId ?? link.url;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}
