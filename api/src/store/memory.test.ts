import { describe, expect, it } from 'vitest';
import { createMemoryLibraryStore } from './memory';

const USER = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

describe('memory store retention', () => {
  it('expires old cached posts and hashed networks, and keeps recent ones', async () => {
    const store = createMemoryLibraryStore();
    const post = { platform: 'tiktok' as const, postId: '1', url: 'u', kind: 'video' as const, creatorHandle: null, thumbnailUrl: null };
    await store.putCachedPost('tiktok', '1', { post, books: [], model: 'm', content: 'books' });
    await store.createJob(USER, 'ip-hash', [{ inputUrl: 'u', platform: 'tiktok', postId: '1', kind: 'video' }]);

    const past = new Date(Date.now() - 60_000);
    expect(await store.expireRetention({ postCacheBefore: past, ipHashBefore: past })).toEqual({ posts: 0, ipHashes: 0 });

    const future = new Date(Date.now() + 60_000);
    expect(await store.expireRetention({ postCacheBefore: future, ipHashBefore: future })).toEqual({ posts: 1, ipHashes: 1 });
    expect(await store.getCachedPost('tiktok', '1')).toBeNull();
    expect(await store.countItemsSince({ ipHash: 'ip-hash' }, new Date(0))).toBe(0);
    // The user’s own count is untouched.
    expect(await store.countItemsSince({ userId: USER }, new Date(0))).toBe(1);
  });
});
