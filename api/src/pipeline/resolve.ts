import { PLATFORM_LABELS, parseSourceUrl, type SourceLink } from '@booktrap/shared';
import { PipelineError } from './errors';
import { INSTAGRAM_PAGE_HOSTS, TIKTOK_PAGE_HOSTS, safeFetch } from './safe-fetch';

const PAGE_HOSTS = { tiktok: TIKTOK_PAGE_HOSTS, instagram: INSTAGRAM_PAGE_HOSTS } as const;
/** Attributes of one tag, in any order. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, , value] of tag.matchAll(/([a-z:-]+)\s*=\s*(["'])(.*?)\2/gi)) out[name!.toLowerCase()] = value!;
  return out;
}

/**
 * Instagram share pages sometimes answer 200 instead of redirecting; the canonical link
 * (or og:url) names the post. Attribute order varies, so tags are parsed rather than matched whole.
 */
export function canonicalUrl(html: string): string | null {
  for (const [tag] of html.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    if (attrs.rel?.toLowerCase() === 'canonical' && attrs.href) return attrs.href.replace(/&amp;/g, '&');
    if (attrs.property?.toLowerCase() === 'og:url' && attrs.content) return attrs.content.replace(/&amp;/g, '&');
  }
  return null;
}

async function readHead(response: Response, maxBytes = 512 * 1024): Promise<string> {
  if (!response.body) return '';
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length >= maxBytes || /<\/head>/i.test(text)) break;
  }
  await response.body.cancel().catch(() => {});
  return text;
}

/**
 * Turns a share link (vm./vt.tiktok.com, tiktok.com/t/…, instagram.com/share/…) into the canonical
 * post URL by following redirects, staying on that platform's own hosts the whole way.
 */
export async function resolveLink(link: SourceLink, fetchImpl?: typeof fetch): Promise<SourceLink> {
  if (link.kind !== 'short') return link;
  const label = PLATFORM_LABELS[link.platform];

  let resolved: SourceLink | null;
  try {
    const { response, finalUrl } = await safeFetch(link.url, { hosts: PAGE_HOSTS[link.platform], method: 'GET', timeoutMs: 10_000, fetchImpl });
    resolved = parseSourceUrl(finalUrl);
    if (!resolved || resolved.kind === 'short') {
      const canonical = canonicalUrl(await readHead(response));
      resolved = canonical ? parseSourceUrl(canonical) : null;
    } else {
      await response.body?.cancel().catch(() => {});
    }
  } catch {
    throw new PipelineError('unreachable', `This share link could not be opened. Try copying the full ${label} link instead.`);
  }
  // A redirect may only land on the same platform's posts.
  if (!resolved || resolved.kind === 'short' || resolved.platform !== link.platform) {
    throw new PipelineError('not_a_post', `This link doesn’t lead to a ${label} post. Try copying the post’s own link instead.`);
  }
  return resolved;
}
