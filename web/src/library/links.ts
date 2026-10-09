import { PLATFORM_LABELS, SOURCE_PLATFORMS, type BookSource, type SourceLink } from '@booktrap/shared';

/** What each pasted link is, in the reader's words. */
export function describeKind(link: Pick<SourceLink, 'platform' | 'kind'>): string {
  switch (link.kind) {
    case 'video':
      return link.platform === 'instagram' ? 'Reel' : 'Video';
    case 'photo':
      return 'Photos';
    case 'post':
      return 'Post';
    case 'short':
      return 'Share link';
    case 'collection':
      return 'Collection';
    case 'private_collection':
      return 'Saved collection';
  }
}

export function summarize(links: SourceLink[]): string {
  const parts = SOURCE_PLATFORMS.map((platform) => [platform, links.filter((link) => link.platform === platform).length] as const)
    .filter(([, count]) => count > 0)
    .map(([platform, count]) => `${count} ${PLATFORM_LABELS[platform]}`);
  return `${links.length} ${links.length === 1 ? 'link' : 'links'} found${parts.length > 1 ? `: ${parts.join(', ')}` : ''}`;
}


/** "from @handle" for one source, "seen in 3 posts" for several (brief §7, platform-neutral). */
export function sourceSummary(sources: BookSource[]): string {
  if (sources.length === 1) {
    const [only] = sources as [BookSource];
    return `from ${only.creatorHandle ? `@${only.creatorHandle}` : PLATFORM_LABELS[only.platform]}`;
  }
  return `seen in ${sources.length} posts`;
}

export function sourceHeading(sources: BookSource[]): string {
  return sources.length === 1 ? 'Found in 1 post' : `Seen in ${sources.length} posts`;
}
