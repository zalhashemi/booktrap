import { beforeEach, describe, expect, it } from 'vitest';
import { DeviceCredentialsSchema } from '@booktrap/shared';
import { CREDENTIALS_KEY, createCredentialStore, generateCredentials, loadOrCreate } from './credentials';

describe('device credentials', () => {
  beforeEach(() => localStorage.clear());

  it('generates a UUID v4 id and a 43-character base64url secret', () => {
    const credentials = generateCredentials();
    expect(DeviceCredentialsSchema.safeParse(credentials).success).toBe(true);
  });

  it('never generates the same secret twice', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateCredentials().deviceSecret));
    expect(secrets.size).toBe(50);
  });

  it('creates credentials once, then returns the stored ones', () => {
    const store = createCredentialStore(localStorage);
    const first = loadOrCreate(store);
    expect(first.registered).toBe(false);
    expect(loadOrCreate(store)).toEqual(first);
  });

  it('replaces corrupt stored data with fresh credentials', () => {
    localStorage.setItem(CREDENTIALS_KEY, '{"deviceId":"nope"');
    const store = createCredentialStore(localStorage);
    const credentials = loadOrCreate(store);
    expect(DeviceCredentialsSchema.safeParse(credentials).success).toBe(true);
  });

  it('falls back to memory when storage is unavailable', () => {
    const store = createCredentialStore(null);
    expect(store.durable).toBe(false);
    const credentials = loadOrCreate(store);
    expect(loadOrCreate(store)).toEqual(credentials);
    expect(localStorage.getItem(CREDENTIALS_KEY)).toBeNull();
  });
});
