import { z } from 'zod';
import { DEVICE_SECRET_BYTES, DeviceCredentialsSchema, type DeviceCredentials } from '@booktrap/shared';

export const CREDENTIALS_KEY = 'booktrap.device.v1';

const StoredSchema = DeviceCredentialsSchema.extend({
  registered: z.boolean().default(false),
});
export type StoredCredentials = z.infer<typeof StoredSchema>;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCredentials(): DeviceCredentials {
  const secret = new Uint8Array(DEVICE_SECRET_BYTES);
  crypto.getRandomValues(secret);
  return { deviceId: crypto.randomUUID(), deviceSecret: base64url(secret) };
}

export interface CredentialStore {
  /** False when the browser blocks storage (private mode, disabled site data). */
  readonly durable: boolean;
  load(): StoredCredentials | null;
  save(credentials: StoredCredentials): void;
  clear(): void;
}

export function createCredentialStore(storage: Storage | null = safeLocalStorage()): CredentialStore {
  if (!storage) {
    let memory: StoredCredentials | null = null;
    return {
      durable: false,
      load: () => memory,
      save: (credentials) => {
        memory = credentials;
      },
      clear: () => {
        memory = null;
      },
    };
  }

  return {
    durable: true,
    load() {
      try {
        const raw = storage.getItem(CREDENTIALS_KEY);
        if (!raw) return null;
        const parsed = StoredSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    save(credentials) {
      storage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    },
    clear() {
      storage.removeItem(CREDENTIALS_KEY);
    },
  };
}

/** Returns stored credentials, or creates, saves and returns a new unregistered set. */
export function loadOrCreate(store: CredentialStore): StoredCredentials {
  const existing = store.load();
  if (existing) return existing;
  const created: StoredCredentials = { ...generateCredentials(), registered: false };
  store.save(created);
  return created;
}

function safeLocalStorage(): Storage | null {
  try {
    const probe = '__booktrap_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
