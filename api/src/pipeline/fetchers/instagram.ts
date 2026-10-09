import { PipelineError } from '../errors';
import { runActor } from './apify';
import type { FetchDeps, PostData, PostFetcher } from './types';

/**
 * Instagram data via the Apify actor apify/instagram-scraper (pay-per-result, no start fee).
 * Chosen over apify/instagram-post-scraper (same price and output on the test posts) for its
 * much larger user base and run record. Price read from the actor's pricing API on 2026-10-09.
 * Reels have no free subtitles; the paid transcript add-on ($0.048) is deliberately not used.
 */
const SPEC = { actor: 'apify~instagram-scraper', label: 'Instagram', startUsd: 0 };
export const INSTAGRAM_PRICES_USD = { result: 0.0027 } as const;

interface InstagramChild {
  type?: string;
  displayUrl?: string;
}

interface InstagramItem {
  error?: string;
  errorDescription?: string;
  shortCode?: string;
  type?: 'Image' | 'Video' | 'Sidecar' | string;
  url?: string;
  caption?: string;
  hashtags?: string[];
  ownerUsername?: string;
  displayUrl?: string;
  images?: string[];
  childPosts?: InstagramChild[];
  videoUrl?: string;
  videoDuration?: number;
}

/** Readable reasons for the actor's error items (brief §11 and change request 001 §4). */
export function describeInstagramError(error: string, description = ''): { code: 'unavailable' | 'scraper_failed'; message: string; retryable: boolean } {
  const text = `${error} ${description}`.toLowerCase().replace(/_/g, ' ');
  const has = (pattern: RegExp) => pattern.test(text);
  if (has(/\bprivate\b/)) {
    return { code: 'unavailable', message: 'This Instagram account is private, so BookTrap can’t see the post.', retryable: false };
  }
  if (has(/\blog ?in\b|\bsign ?in\b|\brestricted\b|\bage[- ]gated\b/)) {
    return {
      code: 'unavailable',
      message: 'Instagram only shows this post to people who are logged in (it may be age-restricted). Try another link.',
      retryable: false,
    };
  }
  if (has(/\brate[- ]?limit|\b429\b|\btoo many requests\b/)) {
    return { code: 'scraper_failed', message: 'Instagram is limiting requests right now. Try this link again in a few minutes.', retryable: true };
  }
  if (has(/\bnot found\b|\bdoes not exist\b|\bdeleted\b|\bremoved\b/)) {
    return { code: 'unavailable', message: 'This Instagram post seems to have been deleted, or the link is wrong.', retryable: false };
  }
  return { code: 'unavailable', message: 'Instagram didn’t return this post. It may be deleted or private.', retryable: false };
}

export function toInstagramPost(item: InstagramItem, requestedPostId: string): PostData {
  if (item.error) {
    const { code, message, retryable } = describeInstagramError(item.error, item.errorDescription);
    throw new PipelineError(code, message, retryable);
  }

  const isVideo = item.type === 'Video';
  // A carousel can mix photos and videos; a video slide contributes its cover frame.
  const slides =
    item.type === 'Sidecar'
      ? (item.childPosts?.length ? item.childPosts.map((child) => child.displayUrl) : (item.images ?? []))
      : isVideo
        ? []
        : [item.displayUrl];
  const imageUrls = slides.filter((url): url is string => Boolean(url));

  if (isVideo ? !item.videoUrl : imageUrls.length === 0) {
    throw new PipelineError('unavailable', 'Instagram didn’t share this post’s media. It may be deleted or private.');
  }

  return {
    platform: 'instagram',
    postId: item.shortCode ?? requestedPostId,
    url: item.url ?? `https://www.instagram.com/p/${requestedPostId}/`,
    kind: isVideo ? 'video' : 'carousel',
    caption: (item.caption ?? '').slice(0, 4000),
    hashtags: item.hashtags ?? [],
    creatorHandle: item.ownerUsername ?? null,
    thumbnailUrl: item.displayUrl ?? null,
    imageUrls: isVideo ? [] : imageUrls,
    videoUrl: isVideo ? item.videoUrl! : null,
    subtitleUrl: null,
    durationSec: item.videoDuration ?? 0,
  };
}

/** Fetches one Instagram post, carousel, reel or IGTV video; returns it and what the run cost. */
export async function fetchInstagramPost(postUrl: string, postId: string, deps: FetchDeps): Promise<{ post: PostData; costUsd: number }> {
  const { items, spent } = await runActor<InstagramItem>(
    SPEC,
    { directUrls: [postUrl], resultsType: 'details', resultsLimit: 1, addParentData: false },
    deps,
  );
  const item = items.find((candidate) => candidate.shortCode === postId) ?? items[0];
  if (!item) {
    throw new PipelineError('unavailable', 'Instagram didn’t return this post. It may be deleted or private.', false, { costUsd: spent });
  }
  // Error items are billed as results too.
  const billed = spent + INSTAGRAM_PRICES_USD.result;
  try {
    return { post: toInstagramPost(item, postId), costUsd: billed };
  } catch (error) {
    if (error instanceof PipelineError) error.costUsd = billed;
    throw error;
  }
}

export const instagramFetcher: PostFetcher = { fetchPost: fetchInstagramPost };
