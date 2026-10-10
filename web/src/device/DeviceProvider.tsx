import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceCredentials } from '@booktrap/shared';
import { api, ApiRequestError, NetworkError } from '../api/client';
import { bootstrapDevice, requestPersistentStorage } from './bootstrap';
import { clearBackupSaved } from './backupPrompt';
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

  /** Points this browser at another shelf (or none: a new one) and drops every cached view of the old one. */
  const switchShelf = useCallback(
    async (next: DeviceCredentials | null) => {
      if (next) store.save({ ...next, registered: true });
      else store.clear();
      await queryClient.resetQueries({ queryKey: SESSION_KEY });
      queryClient.removeQueries({ predicate: (cached) => cached.queryKey[0] !== SESSION_KEY[0] });
    },
    [queryClient],
  );

  const session = query.data;
  const deleteShelf = useCallback(async () => {
    if (!session) throw new Error('No shelf is open.');
    try {
      await api.deleteDevice(session.credentials);
    } catch (error) {
      // Already gone (a retry after an answer that never arrived): carry on as deleted.
      if (!(error instanceof ApiRequestError && error.status === 401)) throw error;
    }
    clearBackupSaved();
    await switchShelf(null);
  }, [session, switchShelf]);

  const restore = useCallback(
    async (credentials: DeviceCredentials) => {
      // Prove the code works before replacing anything on this browser.
      await api.me(credentials);
      await switchShelf(credentials);
    },
    [switchShelf],
  );

  const value: DeviceContextValue = {
    status: query.isSuccess ? 'ready' : query.isError ? 'error' : 'loading',
    session: query.data,
    error: query.error,
    persisted,
    retry,
    startFresh,
    deleteShelf,
    restore,
  };

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}
