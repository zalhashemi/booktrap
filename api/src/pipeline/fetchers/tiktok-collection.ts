import { PipelineError } from '../errors';
import { runActor } from './apify';
import type { FetchDeps } from './types';

/**
 * Lists the videos in a public TikTok collection or playlist via the Apify actor
 * powerai/tiktok-collection-posts-scraper (the only actor found that reads them; clockworks'
 * TikTok scraper does not). Pay-per-event prices read from its pricing API on 2026-10-09.
 * Only the listing happens here: each video is then read like any pasted link (and cached).
 */
// At its default 2 GB the actor start was billed twice ($0.18); 1 GB lists fine (tested 2026-10-09).
const SPEC = { actor: 'powerai~tiktok-collection-posts-scraper', label: 'TikTok', startUsd: 0.09, memoryMb: 1024 };
export const COLLECTION_PRICES_USD = { actorStart: SPEC.startUsd, row: 0.00499 } as const;
/** The actor refuses smaller requests. */
const ACTOR_MIN_RESULTS = 20;

interface CollectionRow {
  id?: string;
  author?: { uniqueId?: string } | string;
  imagePost?: unknown;
  secret?: boolean;
  privateItem?: boolean;
}

export interface CollectionVideo {
  postId: string;
  url: string;
  kind: 'video' | 'carousel';
}

export interface CollectionListing {
  videos: CollectionVideo[];
  /** The collection holds more than `limit` videos. */
  more: boolean;
  costUsd: number;
}

export function toCollectionVideos(rows: CollectionRow[]): CollectionVideo[] {
  const seen = new Set<string>();
  const videos: CollectionVideo[] = [];
  for (const row of rows) {
    const handle = typeof row.author === 'string' ? row.author : row.author?.uniqueId;
    if (!row.id || !/^\d{8,25}$/.test(row.id) || !handle || !/^[\w.-]+$/.test(handle)) continue;
    if (row.secret || row.privateItem || seen.has(row.id)) continue;
    seen.add(row.id);
    const kind = row.imagePost ? 'carousel' : 'video';
    videos.push({ postId: row.id, url: `https://www.tiktok.com/@${handle}/${kind === 'carousel' ? 'photo' : 'video'}/${row.id}`, kind });
  }
  return videos;
}

/** Lists up to `limit` videos, asking for one more so we can tell the reader the collection is bigger. */
export async function listTikTokCollection(collectionId: string, limit: number, deps: FetchDeps): Promise<CollectionListing> {
  const { items, spent } = await runActor<CollectionRow>(
    SPEC,
    { collectionId, maxResults: Math.max(ACTOR_MIN_RESULTS, limit + 1) },
    deps,
  );
  const rows = items;
  const costUsd = spent + rows.length * COLLECTION_PRICES_USD.row;
  const videos = toCollectionVideos(rows);
  if (videos.length === 0) {
    throw new PipelineError(
      'private_collection',
      'BookTrap couldn’t see any videos in this collection. It may be private, empty or deleted. Paste the video links instead.',
      false,
      { costUsd },
    );
  }
  // Judged on the raw rows: dropped private or duplicate rows must not hide that the list went on.
  return { videos: videos.slice(0, limit), more: rows.length > limit, costUsd };
}
