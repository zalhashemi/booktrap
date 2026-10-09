import type { SourcePlatform } from '@booktrap/shared';
import { instagramFetcher } from './instagram';
import { tiktokFetcher } from './tiktok';
import type { FetchDeps, PostData, PostFetcher } from './types';

export type { FetchDeps, PostData, PostFetcher } from './types';

export const FETCHERS: Record<SourcePlatform, PostFetcher> = {
  tiktok: tiktokFetcher,
  instagram: instagramFetcher,
};

/** Fetches one post from whichever platform it lives on. */
export function fetchPost(
  platform: SourcePlatform,
  postUrl: string,
  postId: string,
  deps: FetchDeps,
): Promise<{ post: PostData; costUsd: number }> {
  return FETCHERS[platform].fetchPost(postUrl, postId, deps);
}
