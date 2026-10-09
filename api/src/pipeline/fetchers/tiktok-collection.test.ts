import { describe, expect, it, vi } from 'vitest';
import { COLLECTION_PRICES_USD, listTikTokCollection, toCollectionVideos } from './tiktok-collection';

const row = (id: string, extra: object = {}) => ({ id, author: { uniqueId: 'reader' }, ...extra });

describe('toCollectionVideos', () => {
  it('builds canonical video and photo URLs and skips private, duplicate or malformed rows', () => {
    const videos = toCollectionVideos([
      row('7459230804909100296'),
      row('7459230804909100297', { imagePost: { images: [] } }),
      row('7459230804909100296'),
      row('7459230804909100298', { secret: true }),
      row('not-an-id'),
      { id: '7459230804909100299', author: { uniqueId: 'bad handle/../x' } },
    ]);
    expect(videos).toEqual([
      { postId: '7459230804909100296', url: 'https://www.tiktok.com/@reader/video/7459230804909100296', kind: 'video' },
      { postId: '7459230804909100297', url: 'https://www.tiktok.com/@reader/photo/7459230804909100297', kind: 'carousel' },
    ]);
  });
});

describe('listTikTokCollection', () => {
  const ok = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200 });

  it('asks for one more than the limit, so a bigger collection is noticed', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => row(String(7459230804909100000n + BigInt(i))));
    const fetchImpl = vi.fn(async () => ok(rows));
    const listing = await listTikTokCollection('7442134949027351314', 25, { token: 't', fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('powerai~tiktok-collection-posts-scraper');
    expect(url).toContain('memory=1024');
    expect(JSON.parse(init.body as string)).toEqual({ collectionId: '7442134949027351314', maxResults: 26 });
    expect(listing.videos).toHaveLength(25);
    expect(listing.more).toBe(true);
    expect(listing.costUsd).toBeCloseTo(COLLECTION_PRICES_USD.actorStart + 26 * COLLECTION_PRICES_USD.row);
  });

  it('still says there are more when a dropped row brings the count back to the limit', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => row(String(7459230804909100000n + BigInt(i)), i === 3 ? { secret: true } : {}));
    const listing = await listTikTokCollection('1', 25, { token: 't', fetchImpl: vi.fn(async () => ok(rows)) });
    expect(listing.videos).toHaveLength(25);
    expect(listing.more).toBe(true);
  });

  it('never asks for fewer than the actor’s minimum of 20', async () => {
    const fetchImpl = vi.fn(async () => ok([row('7459230804909100296')]));
    const listing = await listTikTokCollection('1', 3, { token: 't', fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).maxResults).toBe(20);
    expect(listing).toMatchObject({ more: false, videos: [{ postId: '7459230804909100296' }] });
  });

  it('explains an empty or private collection and still reports the cost', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await expect(listTikTokCollection('1', 25, { token: 't', fetchImpl })).rejects.toMatchObject({
      code: 'private_collection',
      costUsd: COLLECTION_PRICES_USD.actorStart,
    });
  });
});
