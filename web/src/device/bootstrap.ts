import type { MeResponse } from '@booktrap/shared';
import { ApiRequestError, type ApiClient } from '../api/client';
import { loadOrCreate, type CredentialStore, type StoredCredentials } from './credentials';

export interface DeviceSession {
  credentials: StoredCredentials;
  me: MeResponse;
  /** False when credentials only live in memory and will vanish with the tab. */
  durable: boolean;
}

const BOOTSTRAP_LOCK = 'booktrap-device-bootstrap';

/**
 * First launch: create credentials, register them, then confirm with /v1/me.
 * Later launches: confirm with /v1/me. If the server no longer knows this device
 * (for example a wiped development database), register again once.
 *
 * Runs under a cross-tab lock so two tabs opened together share one device
 * instead of each minting its own and overwriting the other's credentials.
 */
export function bootstrapDevice(api: ApiClient, store: CredentialStore): Promise<DeviceSession> {
  const run = () => bootstrapUnlocked(api, store);
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(BOOTSTRAP_LOCK, run);
  }
  return run();
}

async function bootstrapUnlocked(api: ApiClient, store: CredentialStore): Promise<DeviceSession> {
  let credentials = loadOrCreate(store);

  const register = async () => {
    await api.registerDevice(credentials);
    credentials = { ...credentials, registered: true };
    store.save(credentials);
  };

  if (!credentials.registered) await register();

  try {
    const me = await api.me(credentials);
    return { credentials, me, durable: store.durable };
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
    await register();
    const me = await api.me(credentials);
    return { credentials, me, durable: store.durable };
  }
}

/** Ask the browser not to evict our storage under pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
