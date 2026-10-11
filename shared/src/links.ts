import { LIMITS } from './limits';
import { INSTAGRAM_HOSTS, parseInstagramUrl } from './instagram';
import { linkKey, type SourceLink } from './source';
import { TIKTOK_HOSTS, parseTikTokUrl } from './tiktok';

/** Parses one TikTok or Instagram URL; null for anything else. */
export function parseSourceUrl(raw: string): SourceLink | null {
  return parseTikTokUrl(raw) ?? parseInstagramUrl(raw);
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'()\]]+/gi;

/**
 * Pulls every TikTok and Instagram link out of pasted text (a list, a share message, a whole chat).
 * Duplicates are dropped, keeping first occurrence order.
 */
export function extractSourceLinks(text: string): SourceLink[] {
  const seen = new Set<string>();
  const links: SourceLink[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const link = parseSourceUrl(match[0].replace(/[.,;:!?]+$/, ''));
    if (!link) continue;
    const key = linkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

const PLATFORM_HOSTS = new Set<string>([...TIKTOK_HOSTS, ...INSTAGRAM_HOSTS]);

/**
 * How many distinct links in the text are on TikTok or Instagram but aren't a post, reel or
 * collection BookTrap can read (a profile, a search page, a mistyped id), so the paste box can say
 * so rather than silently leaving them out.
 */
export function countUnreadableLinks(text: string): number {
  const unreadable = new Set<string>();
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    // The same page however it's written: no www/m., query, hash, trailing slash or case.
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    // A bare home page (a share message's "tiktok.com" footer) isn't a link anyone meant to send.
    if (!PLATFORM_HOSTS.has(host) || path === '' || parseSourceUrl(raw)) continue;
    unreadable.add(`${host.replace(/^(www|m)\./, '')}${path}`);
  }
  return unreadable.size;
}

/**
 * The part of a huge paste that's read for links: the first `LIMITS.pasteChars` characters, cut back
 * to the last whitespace so a link at the edge is dropped whole rather than read as a shorter, wrong id.
 */
export function readablePaste(text: string, limit: number = LIMITS.pasteChars): string {
  if (text.length <= limit) return text;
  // One character past the limit tells whether the last word ends right at it.
  const head = text.slice(0, limit + 1);
  const lastSpace = head.search(/\s\S*$/);
  return lastSpace === -1 ? '' : head.slice(0, lastSpace);
}
