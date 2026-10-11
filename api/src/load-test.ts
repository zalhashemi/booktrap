import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { createSessionVerifier, type SessionVerifier } from './auth/session-auth';
import type { PostData } from './pipeline/fetchers';
import type { ExtractedBook } from './pipeline/extract';
import { framesFromFile } from './pipeline/media';
import type { PipelineDeps } from './pipeline/process';

/**
 * Load-test mode (Phase 9; refused in production). Sessions are signed with a key the load script made,
 * so 100 readers don't need 100 Supabase sign-ins. Apify, Claude and the catalogue lookup are stubbed with
 * realistic delays and cost nothing; frames still come from a real ffmpeg run on a sample video, since
 * ffmpeg is what uses the memory. Delays are multiplied by `timeScale` so a run fits in minutes.
 */
export interface LoadTestOptions {
  supabaseUrl: string;
  jwksFile: string;
  timeScale: number;
}

const SAMPLE_SECONDS = 60;
const TITLES = [
  ['Piranesi', 'Susanna Clarke'], ['Circe', 'Madeline Miller'], ['The Secret History', 'Donna Tartt'], ['Babel', 'R. F. Kuang'],
  ['The Night Circus', 'Erin Morgenstern'], ['Station Eleven', 'Emily St. John Mandel'], ['Normal People', 'Sally Rooney'],
  ['Klara and the Sun', 'Kazuo Ishiguro'], ['Pachinko', 'Min Jin Lee'], ['A Little Life', 'Hanya Yanagihara'],
  ['The Song of Achilles', 'Madeline Miller'], ['Tomorrow, and Tomorrow, and Tomorrow', 'Gabrielle Zevin'],
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Uniform in [min, max] seconds, scaled. */
const delay = (min: number, max: number, scale: number) => sleep((min + Math.random() * (max - min)) * 1000 * scale);

/** A 720p, 60-second test video, made once: the size of a typical BookTok video. */
async function makeSampleVideo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'booktrap-load-sample-'));
  const file = join(dir, 'sample.mp4');
  await promisify(execFile)(ffmpegPath as unknown as string, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${SAMPLE_SECONDS}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', file,
  ]);
  return file;
}

export async function loadTestMode(options: LoadTestOptions): Promise<{ verifySession: SessionVerifier; stubs: Partial<PipelineDeps> }> {
  const jwks = JSON.parse(await readFile(options.jwksFile, 'utf8')) as JSONWebKeySet;
  const verifySession = createSessionVerifier({ supabaseUrl: options.supabaseUrl, getKey: createLocalJWKSet(jwks) });
  const sample = await makeSampleVideo();
  const scale = options.timeScale;

  const stubs: Partial<PipelineDeps> = {
    // Apify: an actor run takes about 6-14s. The caption carries the post id so extraction can vary.
    fetchPost: async (platform, url, postId) => {
      await delay(6, 14, scale);
      const post: PostData = {
        platform, postId, url, kind: 'video', caption: `load test ${postId}`, hashtags: ['booktok'], creatorHandle: 'booktrap.load',
        thumbnailUrl: null, imageUrls: [], videoUrl: 'load-test://sample', subtitleUrl: null, durationSec: SAMPLE_SECONDS,
      };
      return { post, costUsd: 0 };
    },
    // The download is a local copy (the same disk write a real one makes), then the real frame sampling.
    loadMedia: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'booktrap-'));
      try {
        await delay(1, 3, scale);
        const video = join(dir, 'video.mp4');
        await copyFile(sample, video);
        return { images: await framesFromFile(video, dir, SAMPLE_SECONDS), transcript: null };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    // Claude reading ~30 frames: about 8-16s, 3-6 books, overlapping between posts so some fold together.
    extractBooks: async (input) => {
      await delay(8, 16, scale);
      const seed = Number(/(\d+)$/.exec(input.caption)?.[1]?.slice(-6) ?? 0);
      const count = 3 + (seed % 4);
      const books: ExtractedBook[] = Array.from({ length: count }, (_, i) => {
        const [title, author] = TITLES[(seed + i * 5) % TITLES.length]!;
        return { title: i === count - 1 ? `${title} (${seed % 97})` : title, author, confidence: 0.9, evidence: 'cover', prominence: 'featured', notes: null };
      });
      return { books, content: 'books', model: 'load-test', costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 } };
    },
    // Google Books / Open Library: a few hundred ms, no match (nothing external is called).
    verifyBook: async (title, author) => {
      await delay(0.2, 0.8, scale);
      return { verified: false, title, author, isbn10: null, isbn13: null, coverUrl: null, publishedYear: null, score: 0 };
    },
  };
  return { verifySession, stubs };
}
