import type { SourcePlatform } from '@booktrap/shared';

/** One post, the same shape whichever platform it came from. Feeds the shared media + extraction steps. */
export interface PostData {
  platform: SourcePlatform;
  /** TikTok's numeric id or Instagram's shortcode. */
  postId: string;
  url: string;
  /** A single-photo Instagram post is a one-slide carousel. */
  kind: 'video' | 'carousel';
  caption: string;
  hashtags: string[];
  creatorHandle: string | null;
  thumbnailUrl: string | null;
  /** Carousel slides, in order. */
  imageUrls: string[];
  videoUrl: string | null;
  /** WebVTT subtitles when the platform shares them for free (TikTok only today). */
  subtitleUrl: string | null;
  durationSec: number;
}

export interface FetchDeps {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Every platform sits behind this one interface; the rest of the pipeline never branches on platform. */
export interface PostFetcher {
  fetchPost(postUrl: string, postId: string, deps: FetchDeps): Promise<{ post: PostData; costUsd: number }>;
}
