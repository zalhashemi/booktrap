import { MEDIA_LIMITS } from '@booktrap/shared';
import { toWebp } from './pipeline/media';
import { createLimiter } from './limiter';
import { COVER_HOSTS, isAllowedUrl, safeFetch } from './pipeline/safe-fetch';

const COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The widths a cover is served at (CSS px times device pixel ratio): a fixed few, so the cache stays small. */
export const COVER_WIDTHS = [160, 320] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];

/** The body, or null once it passes `maxBytes` (content-length can be missing or wrong). */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * A cover image from the catalogues, or null when there's none: only from the cover hosts, only
 * images, never more than 2 MB. Network failures throw. Open Library's covers live on the Internet
 * Archive, which often answers 502 at the first try: a server error or a dropped connection gets a second.
 */
export async function fetchCover(url: string, fetchImpl?: typeof fetch): Promise<{ bytes: Buffer; type: string } | null> {
  const get = async () => (await safeFetch(url, { hosts: COVER_HOSTS, timeoutMs: 10_000, fetchImpl })).response;
  // A dropped connection is a TypeError from fetch; a blocked host or a timeout isn't worth a second try.
  let response = await get().catch((error: unknown) => (error instanceof TypeError ? null : Promise.reject(error)));
  if (response && response.status >= 500) await response.body?.cancel();
  if (!response || response.status >= 500) response = await get();
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!response.ok || !COVER_TYPES.has(type)) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await readCapped(response, MEDIA_LIMITS.maxCoverBytes);
  return bytes && { bytes, type };
}

export interface CoverCacheOptions {
  fetchImpl?: typeof fetch;
  /** Converts an image to WebP at a width (ffmpeg by default). */
  convert?: (bytes: Buffer, width: number) => Promise<Buffer>;
  /** Total bytes of WebP kept in memory; the least recently used go first. */
  maxBytes?: number;
  /** Conversions running at once: ffmpeg shares a small CPU with the API. */
  concurrency?: number;
  /** Covers fetched at once: each holds its original (up to 2 MB) in memory until it's converted. */
  fetchConcurrency?: number;
  /** Covers waiting for a turn; past this, a request is turned away and the shelf shows the catalogue's own image. */
  maxWaiting?: number;
  now?: () => number;
}

/** A cover that couldn't be had is not tried again for this long. */
const MISS_TTL_MS = 2 * 60 * 1000;

/**
 * Covers as small WebP, made once and kept in memory: the catalogues' JPEGs are several times larger
 * than a shelf needs. Requests for the same cover at once share one conversion. A big shelf opened for
 * the first time asks for hundreds at once: only a few are fetched at a time, and past `maxWaiting` the
 * rest are turned away (the 512 MB instance was restarted for running out of memory on 12 Oct 2026).
 */
export function createCoverCache({
  fetchImpl,
  convert = toWebp,
  maxBytes = 24 * 1024 * 1024,
  concurrency = 2,
  fetchConcurrency = 6,
  maxWaiting = 100,
  now = Date.now,
}: CoverCacheOptions = {}) {
  const images = new Map<string, Buffer>();
  const misses = new Map<string, number>();
  const pending = new Map<string, Promise<Buffer | null>>();
  let total = 0;
  const fetches = createLimiter(fetchConcurrency);
  const conversions = createLimiter(concurrency);

  const keep = (key: string, image: Buffer) => {
    images.set(key, image);
    total += image.byteLength;
    for (const [oldest, old] of images) {
      if (total <= maxBytes) break;
      images.delete(oldest);
      total -= old.byteLength;
    }
  };

  const make = async (key: string, url: string, width: CoverWidth): Promise<Buffer | null> => {
    try {
      // The original is dropped once converted, so at most `fetchConcurrency` are ever in memory.
      const image = await fetches.run(async () => {
        const cover = await fetchCover(url, fetchImpl);
        if (!cover) throw new Error('no cover');
        return conversions.run(() => convert(cover.bytes, width));
      });
      keep(key, image);
      return image;
    } catch {
      if (misses.size >= 10_000) misses.clear();
      misses.set(key, now() + MISS_TTL_MS);
      return null;
    }
  };

  return {
    /** The cover as WebP at `width`, or null when it can't be had. Never throws. */
    async get(url: string, width: CoverWidth): Promise<Buffer | null> {
      if (!isAllowedUrl(url, COVER_HOSTS)) return null;
      const key = `${width} ${url}`;
      const cached = images.get(key);
      if (cached) {
        // Most recently used goes to the back of the line.
        images.delete(key);
        images.set(key, cached);
        return cached;
      }
      if ((misses.get(key) ?? 0) > now()) return null;
      misses.delete(key);
      let made = pending.get(key);
      if (!made) {
        // Too busy: not remembered as a miss, so it's made on a later visit.
        if (fetches.size >= fetchConcurrency + maxWaiting) return null;
        made = make(key, url, width).finally(() => pending.delete(key));
        pending.set(key, made);
      }
      return made;
    },
  };
}

export type CoverCache = ReturnType<typeof createCoverCache>;
