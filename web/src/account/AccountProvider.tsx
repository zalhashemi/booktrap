import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { api as defaultApi, ApiRequestError, NetworkError, type ApiClient } from '../api/client';
import { toAccountError } from './errors';
import { AccountContext, AccountError, type AccountContextValue, type AccountUser, type LoginResult } from './account-context';
import { authClient, type AuthClient } from './supabase';

const GUEST_LOCK = 'booktrap-start-guest';
const NOT_SET_UP = new AccountError('unknown', 'Sign-in isn’t set up on this copy of BookTrap.');

type State = { status: 'loading'; session: null; error: null } | { status: 'ready'; session: Session; error: null } | { status: 'error'; session: null; error: Error };

function storageWorks(): boolean {
  try {
    const probe = 'booktrap.probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function toUser(session: Session): AccountUser {
  const isGuest = session.user.is_anonymous ?? false;
  return { id: session.user.id, email: isGuest ? null : (session.user.email ?? null), isGuest };
}

/**
 * Every visitor has a Supabase session. With none, a guest (anonymous user) is started; saving the
 * shelf adds an email to that same user, so the shelf and its id never change. Supabase keeps the
 * session in this browser and refreshes it; the API client asks here for the current token.
 */
export function AccountProvider({ children, auth = authClient, client = defaultApi }: { children: ReactNode; auth?: AuthClient | null; client?: ApiClient }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(() =>
    auth ? { status: 'loading', session: null, error: null } : { status: 'error', session: null, error: NOT_SET_UP },
  );
  const [attempt, setAttempt] = useState(0);
  const [durable] = useState(storageWorks);
  const userId = state.session?.user.id ?? null;

  useEffect(() => {
    if (!auth) return;
    client.setTokenSource(async ({ refresh }) => {
      const { data } = refresh ? await auth.refreshSession() : await auth.getSession();
      return data.session?.access_token ?? null;
    });
  }, [auth, client]);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;

    // Two tabs opened at once share one guest: under a cross-tab lock, the second finds the first's session.
    const startGuest = async () => {
      const run = async () => {
        const { data: existing } = await auth.getSession();
        if (existing.session) return existing.session;
        const { data, error } = await auth.signInAnonymously();
        if (error || !data.session) throw error ?? new Error('No session came back');
        return data.session;
      };
      try {
        const session = navigator.locks?.request ? await navigator.locks.request(GUEST_LOCK, run) : await run();
        if (!cancelled) setState({ status: 'ready', session, error: null });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', session: null, error: toAccountError(error) });
      }
    };

    const { data } = auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      // Supabase asks for no auth calls inside this callback: anything more waits a tick.
      if (session) setState({ status: 'ready', session, error: null });
      else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        setState({ status: 'loading', session: null, error: null });
        setTimeout(() => void startGuest(), 0);
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [auth, attempt]);

  // Another user's cached shelf is never shown, or kept, once this browser has switched users.
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || previousUser.current === userId) return;
    const before = previousUser.current;
    previousUser.current = userId;
    if (before) queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === before });
  }, [userId, queryClient]);

  const retry = useCallback(() => {
    if (!auth) return;
    setState({ status: 'loading', session: null, error: null });
    setAttempt((count) => count + 1);
  }, [auth]);

  const requireAuth = useCallback(() => {
    if (!auth) throw NOT_SET_UP;
    return auth;
  }, [auth]);

  /** Runs one Supabase call, turning both its thrown errors and its returned ones into AccountErrors. */
  const call = useCallback(async (run: () => Promise<{ error: unknown }>): Promise<void> => {
    let result: { error: unknown };
    try {
      result = await run();
    } catch (error) {
      throw toAccountError(error);
    }
    if (result.error) throw toAccountError(result.error);
  }, []);

  const sendSaveCode = useCallback(
    async (email: string) => {
      const authApi = requireAuth();
      await call(() => authApi.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/settings` }));
    },
    [requireAuth, call],
  );

  const confirmSaveCode = useCallback(
    async (email: string, code: string, password?: string) => {
      const authApi = requireAuth();
      await call(() => authApi.verifyOtp({ email, token: code, type: 'email_change' }));
      if (password) await call(() => authApi.updateUser({ password }));
      // The new token says "not a guest", which raises the daily cap.
      await call(() => authApi.refreshSession());
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
    [requireAuth, call, queryClient],
  );

  /** Logs in, then hands the guest shelf this browser had (if any) to the account. */
  const logIn = useCallback(
    async (signIn: (authApi: AuthClient) => Promise<{ error: unknown }>): Promise<LoginResult> => {
      const authApi = requireAuth();
      const { data: before } = await authApi.getSession();
      const guestToken = before.session?.user.is_anonymous ? before.session.access_token : null;
      await call(() => signIn(authApi));
      if (!guestToken) return { merged: null, mergeFailed: false };
      for (let tries = 0; ; tries++) {
        try {
          return { merged: await client.mergeGuest(guestToken), mergeFailed: false };
        } catch (error) {
          if (!(error instanceof NetworkError) || tries >= 2) return { merged: null, mergeFailed: true };
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    },
    [requireAuth, call, client],
  );

  const logInWithPassword = useCallback(
    (email: string, password: string) => logIn((authApi) => authApi.signInWithPassword({ email, password })),
    [logIn],
  );

  const sendLoginCode = useCallback(
    async (email: string) => {
      const authApi = requireAuth();
      await call(() => authApi.signInWithOtp({ email, options: { shouldCreateUser: false } }));
    },
    [requireAuth, call],
  );

  const confirmLoginCode = useCallback(
    (email: string, code: string) => logIn((authApi) => authApi.verifyOtp({ email, token: code, type: 'email' })),
    [logIn],
  );

  const setPassword = useCallback(
    async (password: string) => {
      const authApi = requireAuth();
      await call(() => authApi.updateUser({ password }));
    },
    [requireAuth, call],
  );

  const signOut = useCallback(async () => {
    const authApi = requireAuth();
    // Local only: other devices stay signed in. Supabase then reports SIGNED_OUT and a new guest starts.
    await call(() => authApi.signOut({ scope: 'local' }));
  }, [requireAuth, call]);

  const deleteAccount = useCallback(async () => {
    const authApi = requireAuth();
    try {
      await client.deleteAccount();
    } catch (error) {
      // Already gone (a retry after an answer that never arrived): carry on as deleted.
      if (!(error instanceof ApiRequestError && error.status === 401)) throw error;
    }
    // The user no longer exists, so the server may refuse to sign out: the local session goes anyway.
    await authApi.signOut({ scope: 'local' }).catch(() => {});
  }, [requireAuth, client]);

  const value: AccountContextValue = {
    status: state.status,
    user: state.session ? toUser(state.session) : null,
    error: state.error,
    durable,
    retry,
    sendSaveCode,
    confirmSaveCode,
    logInWithPassword,
    sendLoginCode,
    confirmLoginCode,
    setPassword,
    signOut,
    deleteAccount,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
