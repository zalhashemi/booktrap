import { parseInstagramUrl } from './instagram';
import { linkKey, type SourceLink } from './source';
import { parseTikTokUrl } from './tiktok';

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
