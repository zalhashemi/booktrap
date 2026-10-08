import { describe, expect, it } from 'vitest';
import { extractTikTokLinks, parseTikTokUrl } from './tiktok';

describe('parseTikTokUrl', () => {
  it.each([
    ['https://www.tiktok.com/@wmccusker/video/7672440936101727519', 'video', '7672440936101727519'],
    ['https://www.tiktok.com/@readbetweeenlines/photo/7674670540518395169?is_from_webapp=1', 'photo', '7674670540518395169'],
    ['https://m.tiktok.com/@a.b_c/video/7672440936101727519/', 'video', '7672440936101727519'],
  ])('reads %s as a %s post', (raw, kind, id) => {
    expect(parseTikTokUrl(raw)).toMatchObject({ kind, postId: id });
  });

  it('drops tracking parameters from the canonical URL', () => {
    expect(parseTikTokUrl('https://www.tiktok.com/@x/video/7672440936101727519?_r=1&_t=abc')?.url).toBe(
      'https://www.tiktok.com/@x/video/7672440936101727519',
    );
  });

  it.each(['https://vm.tiktok.com/ZMabc123/', 'https://vt.tiktok.com/ZSxyz789', 'https://www.tiktok.com/t/ZT8abcdEF/'])(
    'recognises the short link %s',
    (raw) => {
      expect(parseTikTokUrl(raw)).toMatchObject({ kind: 'short', postId: null });
    },
  );

  it('recognises collection links', () => {
    expect(parseTikTokUrl('https://www.tiktok.com/@reader/collection/Dark%20academia-7301234567890123456')).toMatchObject({
      kind: 'collection',
      handle: 'reader',
    });
  });

  it.each([
    'https://tiktok.com.evil.example/@x/video/7672440936101727519',
    'https://evil.example/?u=https://www.tiktok.com/@x/video/1',
    'https://user:pass@www.tiktok.com/@x/video/7672440936101727519',
    'https://www.tiktok.com:8443/@x/video/7672440936101727519',
    'javascript:alert(1)',
    'https://www.tiktok.com/@x',
    'not a url',
  ])('rejects %s', (raw) => {
    expect(parseTikTokUrl(raw)).toBeNull();
  });
});

describe('extractTikTokLinks', () => {
  it('finds links inside a share message and ignores everything else', () => {
    const text = `omg read these!! https://www.tiktok.com/@a/video/7672440936101727519?_t=8x.
also https://vm.tiktok.com/ZMabc123/ and https://youtube.com/watch?v=1`;
    expect(extractTikTokLinks(text).map((l) => l.kind)).toEqual(['video', 'short']);
  });

  it('de-duplicates the same post pasted twice with different tracking params', () => {
    const text =
      'https://www.tiktok.com/@a/video/7672440936101727519?x=1\nhttps://www.tiktok.com/@a/video/7672440936101727519?x=2';
    expect(extractTikTokLinks(text)).toHaveLength(1);
  });
});
