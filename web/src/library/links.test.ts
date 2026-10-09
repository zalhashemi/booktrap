import { describe, expect, it } from 'vitest';
import { extractSourceLinks, type BookSource } from '@booktrap/shared';
import { describeKind, sourceHeading, sourceSummary, summarize } from './links';

const paste = `https://www.tiktok.com/@a/video/7672440936101727519
https://www.instagram.com/p/DeJvdqUjLd1/
https://www.instagram.com/reel/DeMTMjJjmqF/`;

describe('paste preview', () => {
  it('counts links per platform when a paste mixes them', () => {
    expect(summarize(extractSourceLinks(paste))).toBe('3 links found: 1 TikTok, 2 Instagram');
  });

  it('keeps the summary short for a single platform', () => {
    expect(summarize(extractSourceLinks('https://www.instagram.com/p/DeJvdqUjLd1/'))).toBe('1 link found');
  });

  it('names each kind in the reader’s words', () => {
    expect(extractSourceLinks(paste).map(describeKind)).toEqual(['Video', 'Post', 'Reel']);
  });
});

describe('source wording', () => {
  const source = (platform: BookSource['platform'], creatorHandle: string | null): BookSource => ({
    id: platform,
    platform,
    postId: '1',
    url: 'u',
    creatorHandle,
    thumbnailUrl: null,
    evidence: null,
    confidence: null,
    createdAt: '2026-10-09T00:00:00Z',
  });

  it('says posts, not TikToks', () => {
    expect(sourceSummary([source('tiktok', 'a'), source('instagram', 'b')])).toBe('seen in 2 posts');
    expect(sourceHeading([source('instagram', 'b')])).toBe('Found in 1 post');
    expect(sourceSummary([source('instagram', null)])).toBe('from Instagram');
  });
});
