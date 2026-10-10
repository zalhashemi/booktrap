import { describe, expect, it } from 'vitest';
import { parseInstagramUrl } from './instagram';
import { countUnreadableLinks, extractSourceLinks } from './links';

describe('parseInstagramUrl', () => {
  it.each([
    ['https://www.instagram.com/p/DeJvdqUjLd1/', 'post', 'DeJvdqUjLd1', 'https://www.instagram.com/p/DeJvdqUjLd1/'],
    ['https://www.instagram.com/p/DeJvdqUjLd1/?igsh=MWQ1ZGUxMzBkMA==&img_index=2', 'post', 'DeJvdqUjLd1', 'https://www.instagram.com/p/DeJvdqUjLd1/'],
    ['https://instagram.com/reel/DeMTMjJjmqF', 'video', 'DeMTMjJjmqF', 'https://www.instagram.com/reel/DeMTMjJjmqF/'],
    ['https://www.instagram.com/reels/DeMTMjJjmqF/', 'video', 'DeMTMjJjmqF', 'https://www.instagram.com/reel/DeMTMjJjmqF/'],
    ['https://www.instagram.com/tv/CdEfGh12345/', 'video', 'CdEfGh12345', 'https://www.instagram.com/tv/CdEfGh12345/'],
    ['https://m.instagram.com/penguinukbooks/p/DeJvdqUjLd1/', 'post', 'DeJvdqUjLd1', 'https://www.instagram.com/p/DeJvdqUjLd1/'],
    ['https://instagr.am/p/DeJvdqUjLd1/', 'post', 'DeJvdqUjLd1', 'https://www.instagram.com/p/DeJvdqUjLd1/'],
  ])('reads %s as a %s', (raw, kind, id, url) => {
    expect(parseInstagramUrl(raw)).toMatchObject({ platform: 'instagram', kind, postId: id, url });
  });

  it('keeps the handle from a /username/p/ link', () => {
    expect(parseInstagramUrl('https://www.instagram.com/penguinukbooks/reel/DeMTMjJjmqF/')?.handle).toBe('penguinukbooks');
  });

  it.each(['https://www.instagram.com/share/BAmKr3xYz1/', 'https://www.instagram.com/share/reel/BAmKr3xYz1', 'https://www.instagram.com/share/p/BAmKr3xYz1/'])(
    'treats the share link %s as a short link',
    (raw) => {
      expect(parseInstagramUrl(raw)).toMatchObject({ kind: 'short', postId: null });
    },
  );

  it.each(['https://www.instagram.com/reader/saved/', 'https://www.instagram.com/reader/saved/books-to-read/17912345678901234/'])(
    'recognises the saved collection %s as private',
    (raw) => {
      expect(parseInstagramUrl(raw)).toMatchObject({ kind: 'private_collection', handle: 'reader' });
    },
  );

  it.each([
    'https://instagram.com.evil.example/p/DeJvdqUjLd1/',
    'https://evil.example/?u=https://www.instagram.com/p/DeJvdqUjLd1/',
    'https://user:pass@www.instagram.com/p/DeJvdqUjLd1/',
    'https://www.instagram.com:8443/p/DeJvdqUjLd1/',
    'https://l.instagram.com/?u=https%3A%2F%2Fevil.example',
    'https://www.instagram.com/penguinukbooks/',
    'https://www.instagram.com/explore/tags/booktok/',
    'https://www.instagram.com/stories/reader/3412345678901234567/',
    'ftp://www.instagram.com/p/DeJvdqUjLd1/',
  ])('rejects %s', (raw) => {
    expect(parseInstagramUrl(raw)).toBeNull();
  });
});

describe('extractSourceLinks (mixed)', () => {
  it('finds TikTok and Instagram links in one paste, in order', () => {
    const text = `my list:
https://www.instagram.com/p/DeJvdqUjLd1/?igsh=abc
https://www.tiktok.com/@a/video/7672440936101727519
https://www.instagram.com/reel/DeMTMjJjmqF/ and https://youtube.com/watch?v=1`;
    expect(extractSourceLinks(text).map((link) => [link.platform, link.kind])).toEqual([
      ['instagram', 'post'],
      ['tiktok', 'video'],
      ['instagram', 'video'],
    ]);
  });

  it('treats a reel and the same shortcode via /reels/ as one post', () => {
    expect(extractSourceLinks('https://www.instagram.com/reel/DeMTMjJjmqF/ https://www.instagram.com/reels/DeMTMjJjmqF/')).toHaveLength(1);
  });
});

describe('countUnreadableLinks', () => {
  it('counts platform links that are not readable posts, once each', () => {
    const text = 'see https://www.instagram.com/penguinukbooks/ and https://www.tiktok.com/@reader and https://www.instagram.com/penguinukbooks/ plus https://example.com/x and https://www.instagram.com/p/DeJvdqUjLd1/';
    expect(countUnreadableLinks(text)).toBe(2);
  });

  it('treats variants of one page as one link and ignores bare home pages', () => {
    const text = 'https://www.instagram.com/penguinukbooks and https://instagram.com/PenguinUKBooks/?hl=en, via https://www.tiktok.com/';
    expect(countUnreadableLinks(text)).toBe(1);
  });
});
