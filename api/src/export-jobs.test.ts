import { describe, expect, it } from 'vitest';
import { createMemoryLibraryStore } from './store/memory';
import { createExportJobs, EXPORT_COOLDOWN_MS, EXPORT_KEEP_MS } from './export-jobs';
import type { LibraryStore } from './store/types';

const USER = '00000000-0000-4000-8000-000000000001';

describe('createExportJobs', () => {
  it('answers at once and makes the file afterwards', async () => {
    const exports = createExportJobs({ store: createMemoryLibraryStore() });
    expect(exports.request(USER).status).toBe('queued');
    expect(exports.file(USER)).toBeNull();
    await exports.idle();
    expect(exports.status(USER)?.status).toBe('ready');
    expect(JSON.parse(exports.file(USER)!)).toMatchObject({ app: 'BookTrap', books: [] });
  });

  it('makes a new export only after the cooldown, and drops old files', async () => {
    let at = 1_000_000;
    const exports = createExportJobs({ store: createMemoryLibraryStore(), now: () => at });
    const first = exports.request(USER);
    await exports.idle();
    at += EXPORT_COOLDOWN_MS - 1;
    expect(exports.request(USER).requestedAt).toBe(first.requestedAt);
    at += 2;
    expect(exports.request(USER)).toMatchObject({ status: 'queued' });
    await exports.idle();
    at += EXPORT_KEEP_MS + 1;
    expect(exports.status(USER)).toBeNull();
  });

  it('lets a failed export be tried again straight away', async () => {
    let fail = true;
    const store = createMemoryLibraryStore();
    const flaky = { ...store, listBooks: async (userId: string) => (fail ? Promise.reject(new Error('db down')) : store.listBooks(userId)) } as LibraryStore;
    const errors: unknown[] = [];
    const exports = createExportJobs({ store: flaky, log: (error) => errors.push(error) });
    exports.request(USER);
    await exports.idle();
    expect(exports.status(USER)?.status).toBe('failed');
    expect(errors).toHaveLength(1);
    fail = false;
    expect(exports.request(USER).status).toBe('queued');
    await exports.idle();
    expect(exports.status(USER)?.status).toBe('ready');
  });

  it('keeps nothing for a user deleted mid-export', async () => {
    const exports = createExportJobs({ store: createMemoryLibraryStore() });
    exports.request(USER);
    exports.forgetUser(USER);
    await exports.idle();
    expect(exports.status(USER)).toBeNull();
  });
});
