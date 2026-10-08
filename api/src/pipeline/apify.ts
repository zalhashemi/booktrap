import { PipelineError } from './errors';

/**
 * TikTok data via the Apify actor clockworks/tiktok-scraper (pay-per-event).
 * Free-plan prices read from the actor's pricing API on 2026-10-08.
 */
const ACTOR = 'clockworks~tiktok-scraper';
export const APIFY_PRICES_USD = { actorStart: 0.001, result: 0.0037, videoDownload: 0.0013 } as const;

export interface PostData {
  postId: string;
  url: string;
  kind: 'video' | 'carousel';
  caption: string;
  hashtags: string[];
  creatorHandle: string | null;
  thumbnailUrl: string | null;
  /** Carousel slides, in order. */
  imageUrls: string[];
  videoUrl: string | null;
  subtitleUrl: string | null;
  durationSec: number;
}

interface ApifyItem {
  id?: string;
  text?: string;
  webVideoUrl?: string;
  error?: string;
  isSlideshow?: boolean;
  hashtags?: { name?: string }[];
  authorMeta?: { name?: string; privateAccount?: boolean };
  videoMeta?: {
    duration?: number;
    coverUrl?: string;
    originalCoverUrl?: string;
    subtitleLinks?: { language?: string; downloadLink?: string }[] | null;
  };
  slideshowImageLinks?: { downloadLink?: string; tiktokLink?: string }[];
  mediaUrls?: string[];
}

export function toPostData(item: ApifyItem, requestedPostId: string): PostData {
  if (item.error) {
    throw new PipelineError('unavailable', describeApifyError(item.error));
  }
  const isCarousel = Boolean(item.isSlideshow);
  const imageUrls = (item.slideshowImageLinks ?? [])
    .map((link) => link.downloadLink ?? link.tiktokLink)
    .filter((url): url is string => Boolean(url));
  const videoUrl = item.mediaUrls?.[0] ?? null;

  if (isCarousel ? imageUrls.length === 0 : !videoUrl) {
    throw new PipelineError(
      'unavailable',
      item.authorMeta?.privateAccount
        ? 'This account is private, so BookTrap can’t see the post.'
        : 'TikTok didn’t share this post’s media. It may be deleted, private or blocked in some regions.',
    );
  }

  const subtitles = item.videoMeta?.subtitleLinks ?? [];
  const subtitle = subtitles.find((s) => s.language?.startsWith('eng')) ?? subtitles[0];

  return {
    postId: item.id ?? requestedPostId,
    url: item.webVideoUrl ?? '',
    kind: isCarousel ? 'carousel' : 'video',
    caption: (item.text ?? '').slice(0, 4000),
    hashtags: (item.hashtags ?? []).map((h) => h.name).filter((name): name is string => Boolean(name)),
    creatorHandle: item.authorMeta?.name ?? null,
    thumbnailUrl: item.videoMeta?.originalCoverUrl ?? item.videoMeta?.coverUrl ?? null,
    imageUrls,
    videoUrl: isCarousel ? null : videoUrl,
    subtitleUrl: subtitle?.downloadLink ?? null,
    durationSec: item.videoMeta?.duration ?? 0,
  };
}

function describeApifyError(error: string): string {
  const text = error.toLowerCase();
  if (text.includes('private')) return 'This account is private, so BookTrap can’t see the post.';
  if (text.includes('not found') || text.includes('deleted') || text.includes('unavailable')) {
    return 'This post seems to have been deleted or made private.';
  }
  if (text.includes('region') || text.includes('country')) return 'This post isn’t available in the region BookTrap reads from.';
  return 'TikTok didn’t return this post. It may be deleted, private or region-locked.';
}

export interface ApifyDeps {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Fetches one post. Retries scraper hiccups with backoff; returns the post and what the run cost. */
export async function fetchPost(postUrl: string, postId: string, deps: ApifyDeps): Promise<{ post: PostData; costUsd: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const input = {
    postURLs: [postUrl],
    resultsPerPage: 1,
    shouldDownloadVideos: true,
    shouldDownloadSlideshowImages: true,
    shouldDownloadCovers: false,
    downloadSubtitlesOptions: 'DOWNLOAD_SUBTITLES',
  };

  // Every attempt that reaches Apify is billed (actor start at least), success or not.
  let spent = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    // Counted up front: a request that times out on our side may still have started a billed run.
    spent += APIFY_PRICES_USD.actorStart;
    try {
      const response = await fetchImpl(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=180`, {
        method: 'POST',
        headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(200_000),
      });
      if (response.status === 401 || response.status === 402 || response.status === 403) {
        spent -= APIFY_PRICES_USD.actorStart; // Refused before any run started.
      }
      if (response.status === 401 || response.status === 403) {
        throw new PipelineError('scraper_failed', 'BookTrap’s TikTok reader isn’t configured correctly. We’ve logged it.');
      }
      if (response.status === 402) {
        throw new PipelineError('budget_exhausted', 'BookTrap has used up its TikTok reading allowance for now. Try again later.');
      }
      if (!response.ok) throw new Error(`Apify responded ${response.status}`);
      const items = (await response.json()) as ApifyItem[];
      const item = items.find((candidate) => candidate.id === postId) ?? items[0];
      if (!item) {
        throw new PipelineError('unavailable', 'TikTok didn’t return this post. It may be deleted, private or region-locked.', false, {
          costUsd: spent,
        });
      }
      spent += APIFY_PRICES_USD.result;
      let post: PostData;
      try {
        post = toPostData(item, postId);
      } catch (error) {
        if (error instanceof PipelineError) error.costUsd = spent;
        throw error;
      }
      return { post, costUsd: spent + (post.kind === 'video' ? APIFY_PRICES_USD.videoDownload : 0) };
    } catch (error) {
      if (error instanceof PipelineError) throw error;
      // Network error, timeout or 5xx: retry with backoff.
    }
  }
  throw new PipelineError('scraper_failed', 'TikTok took too long to answer. Try this link again in a minute.', true, {
    costUsd: spent,
  });
}
