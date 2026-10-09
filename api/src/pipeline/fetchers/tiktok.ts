import { PipelineError } from '../errors';
import { runActor } from './apify';
import type { FetchDeps, PostData, PostFetcher } from './types';

/**
 * TikTok data via the Apify actor clockworks/tiktok-scraper (pay-per-event).
 * Free-plan prices read from the actor's pricing API on 2026-10-08.
 */
const SPEC = { actor: 'clockworks~tiktok-scraper', label: 'TikTok', startUsd: 0.001 };
export const TIKTOK_PRICES_USD = { actorStart: SPEC.startUsd, result: 0.0037, videoDownload: 0.0013 } as const;

interface TikTokItem {
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

export function toTikTokPost(item: TikTokItem, requestedPostId: string): PostData {
  if (item.error) {
    throw new PipelineError('unavailable', describeTikTokError(item.error));
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
    platform: 'tiktok',
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

function describeTikTokError(error: string): string {
  const text = error.toLowerCase();
  if (text.includes('private')) return 'This account is private, so BookTrap can’t see the post.';
  if (text.includes('not found') || text.includes('deleted') || text.includes('unavailable')) {
    return 'This post seems to have been deleted or made private.';
  }
  if (text.includes('region') || text.includes('country')) return 'This post isn’t available in the region BookTrap reads from.';
  return 'TikTok didn’t return this post. It may be deleted, private or region-locked.';
}

/** Fetches one TikTok post; returns it and what the run cost. */
export async function fetchTikTokPost(postUrl: string, postId: string, deps: FetchDeps): Promise<{ post: PostData; costUsd: number }> {
  const { items, spent } = await runActor<TikTokItem>(
    SPEC,
    {
      postURLs: [postUrl],
      resultsPerPage: 1,
      shouldDownloadVideos: true,
      shouldDownloadSlideshowImages: true,
      shouldDownloadCovers: false,
      downloadSubtitlesOptions: 'DOWNLOAD_SUBTITLES',
    },
    deps,
  );
  const item = items.find((candidate) => candidate.id === postId) ?? items[0];
  if (!item) {
    throw new PipelineError('unavailable', 'TikTok didn’t return this post. It may be deleted, private or region-locked.', false, {
      costUsd: spent,
    });
  }
  const billed = spent + TIKTOK_PRICES_USD.result;
  let post: PostData;
  try {
    post = toTikTokPost(item, postId);
  } catch (error) {
    if (error instanceof PipelineError) error.costUsd = billed;
    throw error;
  }
  return { post, costUsd: billed + (post.kind === 'video' ? TIKTOK_PRICES_USD.videoDownload : 0) };
}

export const tiktokFetcher: PostFetcher = { fetchPost: fetchTikTokPost };
