/**
 * TikTok link parsing, shared by the web app (paste preview) and the API (validation).
 * Only hosts on this allowlist are ever fetched by the server.
 */
import type { SourceLink } from './source';

export const TIKTOK_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'] as const;
const SHORT_LINK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

export type TikTokLink = SourceLink & { platform: 'tiktok' };

const POST_PATH = /^\/@([\w.-]+)\/(video|photo)\/(\d{8,25})\/?$/;
/** Collections (a reader's saved favourites, when public) and creator playlists: both list videos by id. */
const COLLECTION_PATH = /^\/@([\w.-]+)\/(collection|playlist)\/([^/]+?)-(\d{8,25})\/?$/;
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
    return { platform: 'tiktok', url: `https://${host}${url.pathname.replace(/\/?$/, '/')}`, kind: 'short', postId: null, handle: null };
  }

  const post = POST_PATH.exec(url.pathname);
  if (post) {
    const [, handle, type, id] = post as unknown as [string, string, 'video' | 'photo', string];
    return { platform: 'tiktok', url: `https://www.tiktok.com/@${handle}/${type}/${id}`, kind: type, postId: id, handle };
  }

  const collection = COLLECTION_PATH.exec(url.pathname);
  if (collection) {
    const [, handle, type, slug, id] = collection as unknown as [string, string, string, string, string];
    return {
      platform: 'tiktok',
      url: `https://www.tiktok.com/@${handle}/${type}/${slug}-${id}`,
      kind: 'collection',
      postId: null,
      handle,
    };
  }
  return null;
}

/** The numeric id at the end of a collection or playlist URL. */
export function tiktokCollectionId(url: string): string | null {
  return /-(\d{8,25})\/?$/.exec(url)?.[1] ?? null;
}
