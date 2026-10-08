import { parseTikTokUrl, type TikTokLink } from '@booktrap/shared';
import { TIKTOK_PAGE_HOSTS, safeFetch } from './safe-fetch';
import { PipelineError } from './errors';

/**
 * Turns a short link (vm./vt.tiktok.com, tiktok.com/t/…) into the canonical post URL by
 * following redirects, staying on TikTok's own hosts the whole way.
 */
export async function resolveLink(link: TikTokLink, fetchImpl?: typeof fetch): Promise<TikTokLink> {
  if (link.kind !== 'short') return link;

  let finalUrl: string;
  try {
    ({ finalUrl } = await safeFetch(link.url, { hosts: TIKTOK_PAGE_HOSTS, method: 'GET', timeoutMs: 10_000, fetchImpl }));
  } catch {
    throw new PipelineError('unreachable', 'This short link could not be opened. Try copying the full TikTok link instead.');
  }
  const resolved = parseTikTokUrl(finalUrl);
  if (!resolved || resolved.kind === 'short') {
    throw new PipelineError('not_a_post', 'This link doesn’t lead to a TikTok video or photo post.');
  }
  return resolved;
}
