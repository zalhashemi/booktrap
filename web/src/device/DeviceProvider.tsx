import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, NetworkError } from '../api/client';
import { bootstrapDevice, requestPersistentStorage, type DeviceSession } from './bootstrap';
import { CREDENTIALS_KEY, createCredentialStore } from './credentials';

const store = createCredentialStore();
const SESSION_KEY = ['device-session'] as const;

interface DeviceContextValue {
  status: 'loading' | 'error' | 'ready';
  session: DeviceSession | undefined;
  error: Error | null;
  /** Whether the browser agreed to keep our storage (null = not supported or unknown). */
  persisted: boolean | null;
  retry: () => void;
  /** Discards this device's credentials and starts a new, empty shelf. */
  startFresh: () => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => bootstrapDevice(api, store),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (failures, error) => error instanceof NetworkError && failures < 2,
    retryDelay: 1500,
  });

  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!query.isSuccess) return;
    let cancelled = false;
    void requestPersistentStorage().then((result) => {
      if (!cancelled) setPersisted(result);
    });
    return () => {
      cancelled = true;
    };
  }, [query.isSuccess]);

  // Another tab replaced this browser's credentials (first launch or "start fresh"):
  // follow it, so every tab writes to the same shelf.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CREDENTIALS_KEY || event.key === null) {
        void queryClient.resetQueries({ queryKey: SESSION_KEY });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const startFresh = useCallback(() => {
    store.clear();
    void queryClient.resetQueries({ queryKey: SESSION_KEY });
  }, [queryClient]);

  const value: DeviceContextValue = {
    status: query.isSuccess ? 'ready' : query.isError ? 'error' : 'loading',
    session: query.data,
    error: query.error,
    persisted,
    retry,
    startFresh,
  };

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const value = useContext(DeviceContext);
  if (!value) throw new Error('useDevice must be used inside <DeviceProvider>');
  return value;
}
