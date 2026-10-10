import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceCredentials } from '@booktrap/shared';
import { api, NetworkError } from '../api/client';
import { bootstrapDevice, requestPersistentStorage } from './bootstrap';
import { CREDENTIALS_KEY, createCredentialStore } from './credentials';
import { DeviceContext, type DeviceContextValue } from './device-context';

const store = createCredentialStore();
const SESSION_KEY = ['device-session'] as const;


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

  const restore = useCallback(
    async (credentials: DeviceCredentials) => {
      // Prove the code works before replacing anything on this browser.
      await api.me(credentials);
      store.save({ ...credentials, registered: true });
      // Re-run bootstrap with the restored credentials. Library data is keyed by device, so the
      // old shelf's cache can never be shown under the new one; it is dropped to free memory.
      await queryClient.resetQueries({ queryKey: SESSION_KEY });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    },
    [queryClient],
  );

  const value: DeviceContextValue = {
    status: query.isSuccess ? 'ready' : query.isError ? 'error' : 'loading',
    session: query.data,
    error: query.error,
    persisted,
    retry,
    startFresh,
    restore,
  };

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}
