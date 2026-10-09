/**
 * Instagram link parsing (posts, carousels, reels, IGTV, share links), shared by the web app
 * and the API. Only instagram.com and Instagram's official short domain are accepted.
 */
import type { SourceLink } from './source';

export const INSTAGRAM_HOSTS = ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'] as const;

export type InstagramLink = SourceLink & { platform: 'instagram' };

// Shortcodes are URL-safe base64, about 11 characters today; allow some slack either side.
const CODE = '([A-Za-z0-9_-]{5,40})';
const HANDLE = '([A-Za-z0-9._]{1,30})';
/** /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, optionally behind a /username/ prefix. */
const POST_PATH = new RegExp(`^(?:/${HANDLE})?/(p|reels?|tv)/${CODE}/?$`);
/** Share links from the app: /share/CODE, /share/p/CODE, /share/reel/CODE. They redirect to the post. */
const SHARE_PATH = new RegExp(`^/share/(?:(?:p|reels?|tv)/)?${CODE}/?$`);
/** Saved collections: /username/saved/, /username/saved/name/id/. Only the owner can open these. */
const SAVED_PATH = new RegExp(`^/${HANDLE}/saved(?:/[^/]+(?:/\\d+)?)?/?$`);

export function isInstagramHost(hostname: string): boolean {
  return (INSTAGRAM_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}

/** Parses one URL. Returns null for anything that is not a recognised Instagram post, share or saved link. */
export function parseInstagramUrl(raw: string): InstagramLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!isInstagramHost(host)) return null;
  const path = url.pathname;

  // Before posts: /share/reel/CODE would otherwise read as a reel by a user called "share".
  if (SHARE_PATH.test(path)) {
    return { platform: 'instagram', url: `https://www.instagram.com${path.replace(/\/?$/, '/')}`, kind: 'short', postId: null, handle: null };
  }

  const post = POST_PATH.exec(path);
  if (post) {
    const [, handle, type, code] = post as unknown as [string, string | undefined, string, string];
    return {
      platform: 'instagram',
      // The handle prefix is dropped: the shortcode alone identifies the post.
      url: `https://www.instagram.com/${type === 'reels' ? 'reel' : type}/${code}/`,
      kind: type === 'p' ? 'post' : 'video',
      postId: code,
      handle: handle ?? null,
    };
  }

  const saved = SAVED_PATH.exec(path);
  if (saved) {
    return {
      platform: 'instagram',
      url: `https://www.instagram.com${path.replace(/\/?$/, '/')}`,
      kind: 'private_collection',
      postId: null,
      handle: saved[1] ?? null,
    };
  }
  return null;
}
