/**
 * Outbound fetch with an allowlist checked on every redirect hop (SSRF guard, brief §4/§11).
 * The server only ever reaches TikTok, TikTok's CDNs and Apify's API through this.
 */

export type HostRule = string | RegExp;

export const TIKTOK_PAGE_HOSTS: HostRule[] = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'];
export const MEDIA_HOSTS: HostRule[] = [
  'api.apify.com',
  /^[a-z0-9-]+\.tiktokcdn\.com$/,
  /^[a-z0-9-]+\.tiktokcdn-us\.com$/,
  /^[a-z0-9-]+\.tiktokcdn-eu\.com$/,
  /^[a-z0-9-]+\.tiktokv\.com$/,
  /^[a-z0-9-]+\.byteoversea\.com$/,
];

export class BlockedUrlError extends Error {
  constructor(readonly url: string) {
    super(`Refusing to fetch a URL outside the allowlist: ${new URL(url).hostname}`);
    this.name = 'BlockedUrlError';
  }
}

export function isAllowedUrl(raw: string, hosts: HostRule[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((rule) => (typeof rule === 'string' ? rule === host : rule.test(host)));
}

export interface SafeFetchOptions {
  hosts: HostRule[];
  timeoutMs?: number;
  maxRedirects?: number;
  method?: 'GET' | 'HEAD';
  /** Only sent to api.apify.com, never to a CDN or a redirect target elsewhere. */
  apifyToken?: string;
  fetchImpl?: typeof fetch;
}

export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<{ response: Response; finalUrl: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  let current = raw;

  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    if (!isAllowedUrl(current, options.hosts)) throw new BlockedUrlError(current);
    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (compatible; BookTrap/0.1; +https://booktrap.app)',
    };
    if (options.apifyToken && new URL(current).hostname === 'api.apify.com') {
      headers.authorization = `Bearer ${options.apifyToken}`;
    }
    const response = await fetchImpl(current, { method: options.method ?? 'GET', headers, redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: current };
      await response.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error('Too many redirects');
}
