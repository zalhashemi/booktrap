import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it, vi } from 'vitest';
import { createCoverCache, fetchCover } from './covers';
import { toWebp } from './pipeline/media';

const COVER = 'https://covers.openlibrary.org/b/id/123-L.jpg';

const image = (type = 'image/jpeg') => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': type } });

describe('createCoverCache', () => {
  it('converts a cover once, then serves it from memory', async () => {
    const fetchImpl = vi.fn(async () => image());
    const convert = vi.fn(async (_bytes: Buffer, width: number) => Buffer.from(`webp ${width}`));
    const covers = createCoverCache({ fetchImpl: fetchImpl as never, convert });
    const [first, second] = await Promise.all([covers.get(COVER, 160), covers.get(COVER, 160)]);
    expect(first?.toString()).toBe('webp 160');
    expect(second).toBe(first);
    expect(await covers.get(COVER, 160)).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('never fetches outside the cover hosts', async () => {
    const fetchImpl = vi.fn(async () => image());
    const covers = createCoverCache({ fetchImpl: fetchImpl as never, convert: async () => Buffer.from('x') });
    expect(await covers.get('https://example.com/a.jpg', 160)).toBeNull();
    expect(await covers.get('http://covers.openlibrary.org/b/id/1-L.jpg', 160)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('remembers a missing cover for a while instead of asking again', async () => {
    let at = 0;
    const fetchImpl = vi.fn(async () => image('text/html'));
    const covers = createCoverCache({ fetchImpl: fetchImpl as never, convert: async () => Buffer.from('x'), now: () => at });
    expect(await covers.get(COVER, 160)).toBeNull();
    expect(await covers.get(COVER, 160)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    at += 3 * 60 * 1000;
    await covers.get(COVER, 160);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('drops the least recently used covers past its size', async () => {
    const fetchImpl = vi.fn(async () => image());
    const covers = createCoverCache({ fetchImpl: fetchImpl as never, convert: async () => Buffer.alloc(10), maxBytes: 25 });
    const url = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
    await covers.get(url(1), 160);
    await covers.get(url(2), 160);
    await covers.get(url(1), 160); // 1 is now the most recent
    await covers.get(url(3), 160); // 2 goes
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await covers.get(url(1), 160);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await covers.get(url(2), 160);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('fetches only a few covers at once and turns away the rest when too many wait', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return image();
    });
    const covers = createCoverCache({ fetchImpl: fetchImpl as never, convert: async () => Buffer.from('x'), fetchConcurrency: 3, maxWaiting: 4 });
    const url = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
    const results = await Promise.all(Array.from({ length: 10 }, (_, id) => covers.get(url(id), 160)));
    expect(peak).toBe(3);
    expect(results.filter(Boolean)).toHaveLength(7);
    // A cover turned away isn't remembered as missing: asked again later, it's made.
    expect(await covers.get(url(9), 160)).not.toBeNull();
  });
});

describe('toWebp', () => {
  it('makes a WebP no wider than asked, from a JPEG', async () => {
    const jpeg = execFileSync(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=400x600', '-frames:v', '1', '-f', 'mjpeg', 'pipe:1']);
    const webp = await toWebp(jpeg, 160);
    expect(webp.subarray(0, 4).toString()).toBe('RIFF');
    expect(webp.subarray(8, 12).toString()).toBe('WEBP');
    // VP8 frame header holds the width in the low 14 bits at byte 26 (lossy WebP).
    expect(webp.readUInt16LE(26) & 0x3fff).toBe(160);
    expect(webp.byteLength).toBeLessThan(jpeg.byteLength);
  });
});

describe('fetchCover', () => {
  it('tries once more when the catalogue answers with a server error', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/html' } })).mockResolvedValueOnce(image());
    expect(await fetchCover(COVER, fetchImpl as never)).toMatchObject({ type: 'image/jpeg' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
