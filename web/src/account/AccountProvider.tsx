import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { ERROR_CODES } from '@booktrap/shared';
import { api as defaultApi, ApiRequestError, NetworkError, type ApiClient } from '../api/client';
import { captchaToken } from './captcha';
import { toAccountError } from './errors';
import { AccountContext, AccountError, type AccountContextValue, type AccountUser, type LoginResult } from './account-context';
import { authClient, type AuthClient } from './supabase';

const GUEST_LOCK = 'booktrap-start-guest';
const NOT_SET_UP = new AccountError('unknown', 'Sign-in isn’t set up on this copy of BookTrap.');

type State = { status: 'loading'; session: null; error: null } | { status: 'ready'; session: Session; error: null } | { status: 'error'; session: null; error: Error };

/** A guest shelf whose merge into `accountId` failed, kept until the guest's token expires. */
interface PendingMerge {
  token: string;
  expiresAt: number;
  accountId: string;
}

const PENDING_MERGE_KEY = 'booktrap.pending-merge';

function savePendingMerge(pending: PendingMerge) {
  try {
    localStorage.setItem(PENDING_MERGE_KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked: only the toast's Try again is left.
  }
}

function clearPendingMerge() {
  try {
    localStorage.removeItem(PENDING_MERGE_KEY);
  } catch {
    // Nothing stored.
  }
}

function loadPendingMerge(accountId: string | null): PendingMerge | null {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_MERGE_KEY) ?? 'null') as PendingMerge | null;
    if (!pending || pending.accountId !== accountId) return null;
    if (pending.expiresAt <= Date.now()) {
      clearPendingMerge();
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

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
        const { data, error } = await auth.signInAnonymously({ options: { captchaToken: await captchaToken() } });
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

  // A guest who asked to save their shelf may confirm it from the email's link in another tab or on
  // another device: coming back to this tab checks, so the account shows as saved without a reload.
  const awaitingConfirmation = Boolean(state.session?.user.is_anonymous && state.session.user.new_email);
  useEffect(() => {
    if (!auth || !awaitingConfirmation) return;
    const check = () => {
      if (document.visibilityState === 'visible') void auth.refreshSession().catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [auth, awaitingConfirmation]);

  // Saving the shelf (here or from the email's link) raises the daily limit: read it again.
  const isGuestNow = state.session?.user.is_anonymous;
  useEffect(() => {
    if (isGuestNow === false) void queryClient.invalidateQueries({ queryKey: ['usage'] });
  }, [isGuestNow, queryClient]);

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
      try {
        await call(() => authApi.verifyOtp({ email, token: code, type: 'email_change' }));
      } catch (error) {
        // The email's link and its code are one token: if the link was opened first (in another tab, or
        // by a mail scanner), the code is refused although the shelf is already saved. Ask Supabase.
        if (!(error instanceof AccountError && error.code === 'bad_code')) throw error;
        const { data } = await authApi.refreshSession().catch(() => ({ data: { session: null } }));
        if (!data.session || data.session.user.is_anonymous) throw error;
      }
      if (password) await call(() => authApi.updateUser({ password }));
      // The new token says "not a guest", which raises the daily cap.
      await call(() => authApi.refreshSession());
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
    [requireAuth, call, queryClient],
  );

  /**
   * Hands a guest shelf to the signed-in account. A "still reading a link" answer and network trouble
   * are waited out; if it still fails, the guest's token is kept (it's valid for up to an hour) so the
   * merge can be tried again, from the toast or on the next visit, before the guest shelf is lost.
   */
  const mergeGuest = useCallback(
    async (pending: PendingMerge): Promise<LoginResult> => {
      for (let tries = 0; ; tries++) {
        try {
          const merged = await client.mergeGuest(pending.token);
          clearPendingMerge();
          // The account's shelf may have loaded before the guest's books arrived: read it again.
          await queryClient.invalidateQueries();
          return { merged, mergeFailed: false };
        } catch (error) {
          const retryable = error instanceof NetworkError || (error instanceof ApiRequestError && error.code === ERROR_CODES.busy);
          // Refused outright (the token expired, or it was already merged): nothing more can be done.
          if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
            clearPendingMerge();
            return { merged: null, mergeFailed: true };
          }
          if (!retryable || tries >= 3) {
            savePendingMerge(pending);
            return { merged: null, mergeFailed: true };
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    },
    [client, queryClient],
  );

  /** Logs in, then hands the guest shelf this browser had (if any) to the account. */
  const logIn = useCallback(
    async (signIn: (authApi: AuthClient) => Promise<{ error: unknown }>): Promise<LoginResult> => {
      const authApi = requireAuth();
      const { data: before } = await authApi.getSession();
      let guest = before.session?.user.is_anonymous ? before.session : null;
      // A fresh guest token is good for a full hour, so a merge that has to wait or be retried still can.
      if (guest) {
        const refreshed = await authApi.refreshSession().catch(() => null);
        if (refreshed?.data.session) guest = refreshed.data.session;
      }
      await call(() => signIn(authApi));
      if (!guest) return { merged: null, mergeFailed: false };
      const { data: after } = await authApi.getSession();
      return mergeGuest({ token: guest.access_token, expiresAt: (guest.expires_at ?? 0) * 1000, accountId: after.session?.user.id ?? '' });
    },
    [requireAuth, call, mergeGuest],
  );

  const retryGuestMerge = useCallback(async (): Promise<LoginResult> => {
    const pending = loadPendingMerge(userId);
    if (!pending) return { merged: null, mergeFailed: true };
    return mergeGuest(pending);
  }, [mergeGuest, userId]);

  // A merge that failed last time is tried again once this account is open (while the guest token lasts).
  const isMember = state.session ? !state.session.user.is_anonymous : false;
  useEffect(() => {
    if (!isMember || !loadPendingMerge(userId)) return;
    void retryGuestMerge();
  }, [isMember, userId, retryGuestMerge]);

  const logInWithPassword = useCallback(
    (email: string, password: string) => logIn(async (authApi) => authApi.signInWithPassword({ email, password, options: { captchaToken: await captchaToken() } })),
    [logIn],
  );

  const sendLoginCode = useCallback(
    async (email: string) => {
      const authApi = requireAuth();
      try {
        await call(async () => authApi.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken: await captchaToken() } }));
      } catch (error) {
        // An email with no account looks the same as one with: whether an address is registered stays private.
        if (!(error instanceof AccountError && error.code === 'no_account')) throw error;
      }
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
      if (!(error instanceof ApiRequestError && error.status === 401)) throw error;
      // A 401 may mean it's already gone (a retry after an answer that never arrived), or only that the
      // sign-in lapsed. Only Supabase saying the user no longer exists counts as deleted.
      const { error: lookup } = await authApi.getUser();
      if (!(lookup && 'code' in lookup && lookup.code === 'user_not_found')) throw error;
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
    retryGuestMerge,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
