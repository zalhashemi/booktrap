import { describe, expect, it } from 'vitest';
import { dedupe, type ExtractedBook } from './extract';
import { downloadSlides, normalizeImage, vttToText } from './media';

const book = (overrides: Partial<ExtractedBook>): ExtractedBook => ({
  title: 'Babel',
  author: 'R. F. Kuang',
  confidence: 0.9,
  evidence: 'spine',
  prominence: 'background',
  notes: null,
  ...overrides,
});

describe('dedupe', () => {
  it('keeps a book featured even when the featured sighting is the less confident one', () => {
    const [result] = dedupe([book({ confidence: 0.9 }), book({ confidence: 0.7, prominence: 'featured', evidence: 'caption' })]);
    expect(result).toMatchObject({ prominence: 'featured', confidence: 0.9 });
  });

  it('clamps confidence into 0..1 and drops empty titles', () => {
    const result = dedupe([book({ confidence: 1.4 }), book({ title: '  ' })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(1);
  });
});

describe('normalizeImage', () => {
  it('shrinks a tall image to fit 1568px without distorting it', async () => {
    const { spawnSync } = await import('node:child_process');
    const ffmpeg = (await import('ffmpeg-static')).default as unknown as string;
    // A 1000x2000 test pattern, as a JPEG on stdout.
    const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1000x2000', '-frames:v', '1', '-f', 'mjpeg', 'pipe:1']);
    const out = await normalizeImage(made.stdout);
    let i = 2;
    let size = '';
    while (i < out.length) {
      const marker = out[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xc2) {
        size = `${out.readUInt16BE(i + 7)}x${out.readUInt16BE(i + 5)}`;
        break;
      }
      i += 2 + out.readUInt16BE(i + 2);
    }
    expect(size).toBe('784x1568');
  });
});

describe('vttToText', () => {
  it('removes cue numbers and timings but keeps spoken numeric titles', () => {
    const vtt = ['WEBVTT', '', '1', '00:00:01.000 --> 00:00:02.000', 'my favourite is', '', '2', '00:00:02.000 --> 00:00:03.000', '1984'].join('\n');
    expect(vttToText(vtt)).toBe('my favourite is 1984');
  });
});

describe('downloadSlides', () => {
  it('downloads a big carousel’s slides two at a time', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return new Response('gone', { status: 404 });
    };
    const urls = Array.from({ length: 20 }, (_, n) => `https://scontent-a.cdninstagram.com/${n}.jpg`);
    await expect(downloadSlides(urls, { apifyToken: 't', fetchImpl: fetchImpl as never })).rejects.toThrow(/couldn’t download/);
    expect(peak).toBe(2);
  });
});
