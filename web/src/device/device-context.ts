import { createContext, useContext } from 'react';
import type { DeviceCredentials } from '@booktrap/shared';
import type { DeviceSession } from './bootstrap';

/** Kept apart from the provider component so hot reloads never re-create the context mid-session. */
export interface DeviceContextValue {
  status: 'loading' | 'error' | 'ready';
  session: DeviceSession | undefined;
  error: Error | null;
  /** Whether the browser agreed to keep our storage (null = not supported or unknown). */
  persisted: boolean | null;
  retry: () => void;
  /** Discards this device's credentials and starts a new, empty shelf. */
  startFresh: () => void;
  /** Switches this browser to the shelf a backup code belongs to. Throws if the code is rejected. */
  restore: (credentials: DeviceCredentials) => Promise<void>;
}

export const DeviceContext = createContext<DeviceContextValue | null>(null);

export function useDevice(): DeviceContextValue {
  const value = useContext(DeviceContext);
  if (!value) throw new Error('useDevice must be used inside <DeviceProvider>');
  return value;
}
