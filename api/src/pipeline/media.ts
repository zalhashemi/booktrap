import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpegPath from 'ffmpeg-static';
import { PipelineError } from './errors';
import { MEDIA_HOSTS, safeFetch } from './safe-fetch';

export interface ImageInput {
  /** Shown to the model, e.g. "Slide 2 of 5" or "Frame at 0:42". */
  label: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  base64: string;
}

export const MEDIA_LIMITS = {
  maxSlides: 20,
  maxFrames: 30,
  /** One frame every this many seconds at most (brief: about one every 2s). */
  minFrameIntervalSec: 2,
  /** Frames are scaled to this width: legible spines without paying for full 720p. */
  frameWidth: 720,
  /** Raw download cap for a slide; slides are then re-encoded well under the API's 5MB per image. */
  maxImageBytes: 15 * 1024 * 1024,
  /** Long edge for slides sent to the model (the API downsamples beyond ~1568px anyway). */
  slideLongEdge: 1568,
  maxVideoBytes: 150 * 1024 * 1024,
  maxSubtitleChars: 8000,
} as const;

export interface MediaDeps {
  apifyToken: string;
  fetchImpl?: typeof fetch;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new PipelineError('media_failed', 'This post’s media is too large to read.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new PipelineError('media_failed', 'This post’s media is too large to read.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Re-encodes an image as a JPEG no larger than `longEdge` on its longest side (keeps requests small). */
export async function normalizeImage(bytes: Buffer, longEdge: number = MEDIA_LIMITS.slideLongEdge): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'booktrap-img-'));
  try {
    const input = join(dir, 'in');
    const output = join(dir, 'out.jpg');
    await writeFile(input, bytes);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-i', input,
      // Fit inside a longEdge square, never upscale, keep the aspect ratio. Quotes protect the commas.
      '-vf', `scale='min(${longEdge},iw)':'min(${longEdge},ih)':force_original_aspect_ratio=decrease`,
      '-frames:v', '1',
      '-q:v', '3',
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function downloadSlides(urls: string[], deps: MediaDeps): Promise<ImageInput[]> {
  const slides = urls.slice(0, MEDIA_LIMITS.maxSlides);
  const images = await Promise.all(
    slides.map(async (url, index) => {
      try {
        const { response } = await safeFetch(url, { hosts: MEDIA_HOSTS, apifyToken: deps.apifyToken, fetchImpl: deps.fetchImpl });
        if (!response.ok) return null;
        const raw = await readCapped(response, MEDIA_LIMITS.maxImageBytes);
        const bytes = await normalizeImage(raw);
        const image: ImageInput = {
          label: `Slide ${index + 1} of ${slides.length}`,
          mediaType: 'image/jpeg',
          base64: bytes.toString('base64'),
        };
        return image;
      } catch {
        return null;
      }
    }),
  );
  const ok = images.filter((image): image is ImageInput => image !== null);
  if (ok.length === 0) throw new PipelineError('media_failed', 'BookTrap couldn’t download this post’s photos. Try again in a minute.', true);
  return ok;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Evenly thins a list down to `max` entries, always keeping the first and last. */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]!);
}

/**
 * Frame sampling: one frame at least every `interval` seconds (interval grows for long videos so the
 * total stays near the cap), plus extra frames on scene changes, since a cut usually means a new
 * book is on screen. Then thinned evenly to the cap.
 */
export function frameFilter(durationSec: number, width: number): string {
  const interval = Math.max(MEDIA_LIMITS.minFrameIntervalSec, durationSec / MEDIA_LIMITS.maxFrames);
  const select = [
    'isnan(prev_selected_t)',
    `gte(t-prev_selected_t\\,${interval.toFixed(2)})`,
    'gt(scene\\,0.3)*gte(t-prev_selected_t\\,0.7)',
  ].join('+');
  // showinfo logs each kept frame's real timestamp (pts_time), used for the frame labels.
  return `select='${select}',scale='min(${width}\\,iw)':-2,showinfo`;
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not available on this platform'));
    const child = spawn(ffmpegPath as unknown as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function extractFrames(
  videoUrl: string,
  durationSec: number,
  deps: MediaDeps & { frameWidth?: number },
): Promise<ImageInput[]> {
  const dir = await mkdtemp(join(tmpdir(), 'booktrap-'));
  try {
    const videoPath = join(dir, 'video.mp4');
    const { response } = await safeFetch(videoUrl, {
      hosts: MEDIA_HOSTS,
      apifyToken: deps.apifyToken,
      fetchImpl: deps.fetchImpl,
      timeoutMs: 120_000,
    });
    if (!response.ok || !response.body) {
      throw new PipelineError('media_failed', 'BookTrap couldn’t download this video. Try again in a minute.', true);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MEDIA_LIMITS.maxVideoBytes) throw new PipelineError('media_failed', 'This video is too long for BookTrap to read.');
    // Enforce the cap while streaming: content-length can be missing or wrong.
    let written = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.byteLength;
        if (written > MEDIA_LIMITS.maxVideoBytes) {
          callback(new PipelineError('media_failed', 'This video is too long for BookTrap to read.'));
        } else {
          callback(null, chunk);
        }
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), cap, createWriteStream(videoPath));

    const log = await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'info',
      '-i', videoPath,
      '-vf', frameFilter(durationSec || 60, deps.frameWidth ?? MEDIA_LIMITS.frameWidth),
      '-fps_mode', 'vfr',
      '-q:v', '4',
      join(dir, 'frame_%d.jpg'),
    ]);
    const times = [...log.matchAll(/pts_time:\s*([\d.]+)/g)].map((match) => Number(match[1]));

    const files = (await readdir(dir))
      .map((name) => ({ name, n: Number(/^frame_(\d+)\.jpg$/.exec(name)?.[1] ?? NaN) }))
      .filter((file) => Number.isFinite(file.n))
      .sort((a, b) => a.n - b.n);
    if (files.length === 0) throw new PipelineError('media_failed', 'BookTrap couldn’t read any frames from this video.');

    const chosen = thin(files, MEDIA_LIMITS.maxFrames);
    return Promise.all(
      chosen.map(async (file) => ({
        label: times[file.n - 1] !== undefined ? `Frame at ${formatTime(times[file.n - 1]!)}` : `Frame ${file.n}`,
        mediaType: 'image/jpeg' as const,
        base64: (await readFile(join(dir, file.name))).toString('base64'),
      })),
    );
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError('media_failed', 'BookTrap couldn’t process this video. Try again in a minute.', true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** WebVTT -> plain text, de-duplicated (TikTok captions repeat lines across cues). */
export function vttToText(vtt: string): string {
  const lines: string[] = [];
  const rows = vtt.split(/\r?\n/);
  rows.forEach((raw, index) => {
    const line = raw.replace(/<[^>]+>/g, '').trim();
    // A cue identifier is the line right before a timing line; spoken text like "1984" is kept.
    const isCueId = /-->/.test(rows[index + 1] ?? '');
    if (!line || line === 'WEBVTT' || /-->/.test(line) || isCueId || /^(NOTE|STYLE|REGION)\b/.test(line)) return;
    if (lines.at(-1) !== line) lines.push(line);
  });
  return lines.join(' ').slice(0, MEDIA_LIMITS.maxSubtitleChars);
}

export async function fetchSubtitles(url: string | null, deps: MediaDeps): Promise<string | null> {
  if (!url) return null;
  try {
    const { response } = await safeFetch(url, { hosts: MEDIA_HOSTS, apifyToken: deps.apifyToken, fetchImpl: deps.fetchImpl });
    if (!response.ok) return null;
    const text = (await readCapped(response, 512 * 1024)).toString('utf8');
    return vttToText(text) || null;
  } catch {
    // Subtitles are a bonus; frames and caption still carry the post.
    return null;
  }
}
