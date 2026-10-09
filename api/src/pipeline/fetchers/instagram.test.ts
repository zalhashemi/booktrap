import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '../errors';
import { isAllowedUrl, MEDIA_HOSTS } from '../safe-fetch';
import { resolveLink } from '../resolve';
import { fetchInstagramPost, INSTAGRAM_PRICES_USD, toInstagramPost } from './instagram';

// Trimmed from real apify/instagram-scraper output for public Penguin UK posts (2026-10-09).
const CAROUSEL = {
  shortCode: 'DeJvdqUjLd1',
  type: 'Sidecar',
  url: 'https://www.instagram.com/p/DeJvdqUjLd1/',
  caption: 'Which member of the social team is your book buddy?',
  hashtags: ['booktok'],
  ownerUsername: 'penguinukbooks',
  displayUrl: 'https://instagram.fbod1-1.fna.fbcdn.net/v/cover.jpg',
  images: ['https://instagram.fbod1-1.fna.fbcdn.net/v/1.jpg', 'https://instagram.fbod1-1.fna.fbcdn.net/v/2.jpg'],
  childPosts: [
    { type: 'Image', displayUrl: 'https://instagram.fbod1-1.fna.fbcdn.net/v/1.jpg' },
    { type: 'Video', displayUrl: 'https://instagram.fbod1-1.fna.fbcdn.net/v/2.jpg' },
  ],
};
const REEL = {
  shortCode: 'DeMTMjJjmqF',
  type: 'Video',
  url: 'https://www.instagram.com/p/DeMTMjJjmqF/',
  caption: 'Nothing better than falling in love with a book',
  hashtags: [],
  ownerUsername: 'penguinukbooks',
  displayUrl: 'https://scontent-gmp1-1.cdninstagram.com/v/cover.jpg',
  videoUrl: 'https://scontent-gmp1-1.cdninstagram.com/o1/v/reel.mp4',
  videoDuration: 36.1,
};

describe('toInstagramPost', () => {
  it('turns a carousel into slides, video slides contributing their cover', () => {
    expect(toInstagramPost(CAROUSEL, 'DeJvdqUjLd1')).toMatchObject({
      platform: 'instagram',
      postId: 'DeJvdqUjLd1',
      kind: 'carousel',
      creatorHandle: 'penguinukbooks',
      imageUrls: CAROUSEL.images,
      videoUrl: null,
      subtitleUrl: null,
    });
  });

  it('reads a reel as a video with its duration', () => {
    expect(toInstagramPost(REEL, 'DeMTMjJjmqF')).toMatchObject({ kind: 'video', videoUrl: REEL.videoUrl, durationSec: 36.1, imageUrls: [] });
  });

  it('reads a single photo as a one-slide carousel', () => {
    const photo = { ...CAROUSEL, type: 'Image', images: [], childPosts: [] };
    expect(toInstagramPost(photo, 'x')).toMatchObject({ kind: 'carousel', imageUrls: [CAROUSEL.displayUrl] });
  });

  it.each([
    [{ error: 'not_found', errorDescription: 'Post does not exist' }, /deleted, or the link is wrong/],
    [{ error: 'private_profile', errorDescription: 'Profile is private' }, /account is private/],
    [{ error: 'login_required', errorDescription: 'Login required to view this post' }, /logged in/],
    [{ error: 'rate_limited', errorDescription: 'Too many requests' }, /limiting requests/],
    // Words that merely contain a keyword ("page" holds "age") must not change the reason.
    [{ error: 'not_found', errorDescription: 'Page not found' }, /deleted, or the link is wrong/],
    [{ error: 'restricted_page', errorDescription: 'Restricted profile: age-gated content' }, /logged in/],
  ])('gives a readable reason for %o', (item, message) => {
    expect(() => toInstagramPost(item, 'x')).toThrow(message);
  });

  it('does not retry a blocked post as if it were a rate limit', () => {
    const failure = (() => {
      try {
        toInstagramPost({ error: 'blocked', errorDescription: 'Content blocked in your country' }, 'x');
      } catch (error) {
        return error as PipelineError;
      }
    })();
    expect(failure).toMatchObject({ retryable: false });
  });

  it('only ever downloads media from Instagram’s CDNs', () => {
    for (const url of [...CAROUSEL.images, REEL.videoUrl]) expect(isAllowedUrl(url, MEDIA_HOSTS)).toBe(true);
    expect(isAllowedUrl('https://fbcdn.net.evil.example/x.jpg', MEDIA_HOSTS)).toBe(false);
    expect(isAllowedUrl('https://evil-cdninstagram.com/x.jpg', MEDIA_HOSTS)).toBe(false);
  });
});

describe('fetchInstagramPost', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('asks the actor for the one post and bills one result', async () => {
    const fetchImpl = vi.fn(async () => ok([REEL]));
    const { post, costUsd } = await fetchInstagramPost('https://www.instagram.com/reel/DeMTMjJjmqF/', 'DeMTMjJjmqF', { token: 't', fetchImpl });
    expect(post.kind).toBe('video');
    expect(costUsd).toBeCloseTo(INSTAGRAM_PRICES_USD.result);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('apify~instagram-scraper');
    expect(JSON.parse(init.body as string)).toMatchObject({ directUrls: ['https://www.instagram.com/reel/DeMTMjJjmqF/'], resultsType: 'details' });
  });

  it('charges a deleted post to the budget even though it fails', async () => {
    const fetchImpl = vi.fn(async () => ok([{ error: 'not_found' }]));
    const failure = await fetchInstagramPost('u', 'x', { token: 't', fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PipelineError);
    expect((failure as PipelineError).costUsd).toBeCloseTo(INSTAGRAM_PRICES_USD.result);
  });

  it('retries a body that isn’t a list, and bills every attempt', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { type: 'run-timeout' } }), { status: 200 }));
    const failure = await fetchInstagramPost('u', 'x', { token: 't', fetchImpl, sleep: async () => {} }).catch((error: unknown) => error);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(failure).toBeInstanceOf(PipelineError);
    expect(failure).toMatchObject({ retryable: true });
  });

  it('retries a 5xx with backoff, then gives up with a retryable message', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));
    const failure = await fetchInstagramPost('u', 'x', { token: 't', fetchImpl, sleep: async () => {} }).catch((error: unknown) => error);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(failure).toMatchObject({ retryable: true, userMessage: expect.stringMatching(/Instagram took too long/) });
  });
});

describe('resolveLink (Instagram share links)', () => {
  const share = { platform: 'instagram' as const, url: 'https://www.instagram.com/share/reel/BAmKr3xYz1/', kind: 'short' as const, postId: null, handle: null };

  it('follows a redirect to the post', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/share/')
        ? new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/reel/DeMTMjJjmqF/?igsh=1' } })
        : new Response('<html></html>', { status: 200 }),
    );
    expect(await resolveLink(share, fetchImpl as never)).toMatchObject({ kind: 'video', postId: 'DeMTMjJjmqF' });
  });

  it('reads the canonical tag when Instagram answers 200 instead of redirecting', async () => {
    const html = '<html><head><link rel="canonical" href="https://www.instagram.com/p/DeJvdqUjLd1/" /></head><body>';
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    expect(await resolveLink(share, fetchImpl as never)).toMatchObject({ kind: 'post', postId: 'DeJvdqUjLd1' });
  });

  it('refuses a redirect that leaves Instagram', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    await expect(resolveLink(share, fetchImpl as never)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('reads the canonical tag whatever order its attributes come in', async () => {
    const html = '<head><meta content="https://www.instagram.com/reel/DeMTMjJjmqF/?x=1&amp;y=2" property="og:url"></head>';
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    expect(await resolveLink(share, fetchImpl as never)).toMatchObject({ kind: 'video', postId: 'DeMTMjJjmqF' });
    const flipped = '<link href="https://www.instagram.com/p/DeJvdqUjLd1/" rel="canonical">';
    const again = vi.fn(async () => new Response(flipped, { status: 200 }));
    expect(await resolveLink(share, again as never)).toMatchObject({ postId: 'DeJvdqUjLd1' });
  });

  it('refuses a share link that lands on another platform', async () => {
    const html = '<link rel="canonical" href="https://www.tiktok.com/@a/video/7672440936101727519">';
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    await expect(resolveLink(share, fetchImpl as never)).rejects.toMatchObject({ code: 'not_a_post' });
  });
});
