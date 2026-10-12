import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthRetryableFetchError, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { useAccount, type AccountContextValue } from './account-context';
import { AccountProvider } from './AccountProvider';
import type { AuthClient } from './supabase';

function session(id: string, { guest = false, email = null as string | null } = {}): Session {
  return {
    access_token: `token-${id}`,
    refresh_token: `refresh-${id}`,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id, is_anonymous: guest, email: email ?? undefined, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  } as Session;
}

/** Just enough of Supabase's auth client: a stored session and the change events it reports. */
function fakeAuth(initial: Session | null) {
  let current = initial;
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const emit = (event: AuthChangeEvent, next: Session | null) => {
    current = next;
    for (const listener of listeners) listener(event, next);
  };
  const ok = (next: Session | null) => ({ data: { session: next, user: next?.user ?? null }, error: null });
  const auth = {
    onAuthStateChange: vi.fn((listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      listeners.add(listener);
      queueMicrotask(() => listener('INITIAL_SESSION', current));
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    }),
    getSession: vi.fn(async () => ok(current)),
    refreshSession: vi.fn(async () => ok(current)),
    signInAnonymously: vi.fn(async () => {
      const next = session(`guest-${Math.random().toString(36).slice(2, 8)}`, { guest: true });
      emit('SIGNED_IN', next);
      return ok(next);
    }),
    signInWithPassword: vi.fn(async ({ email }: { email: string }) => {
      const next = session('member', { email });
      emit('SIGNED_IN', next);
      return ok(next);
    }),
    signInWithOtp: vi.fn(async () => ({ data: { session: null, user: null }, error: null as unknown })),
    getUser: vi.fn(async () => ({ data: { user: current?.user ?? null }, error: null })),
    signOut: vi.fn(async () => {
      emit('SIGNED_OUT', null);
      return { error: null };
    }),
  };
  return { auth, emit, current: () => current };
}

function setup(auth: unknown, client = createApiClient('http://api.test')) {
  let account!: AccountContextValue;
  function Probe() {
    account = useAccount();
    return <p>{account.status === 'ready' ? `${account.user!.isGuest ? 'guest' : 'member'} ${account.user!.id}` : account.status}</p>;
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountProvider auth={auth as AuthClient | null} client={client}>
        <Probe />
      </AccountProvider>
    </QueryClientProvider>,
  );
  return { get: () => account, client };
}

afterEach(cleanup);

describe('AccountProvider', () => {
  it('starts a guest when this browser has no session, and hands its token to the API client', async () => {
    const { auth } = fakeAuth(null);
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ userId: 'x', isGuest: true }));
    const { get, client } = setup(auth, createApiClient('http://api.test', fetchImpl));
    await screen.findByText(/^guest /);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(get().user).toMatchObject({ isGuest: true, email: null });

    await client.me();
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer token-${get().user!.id}`);
  });

  it('tries a refused request once more with a refreshed token', async () => {
    const { auth } = fakeAuth(session('guest-1', { guest: true }));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'unauthorized', message: 'expired' } }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ userId: 'guest-1', isGuest: true }));
    const { client } = setup(auth, createApiClient('http://api.test', fetchImpl));
    await screen.findByText('guest guest-1');
    await expect(client.me()).resolves.toEqual({ userId: 'guest-1', isGuest: true });
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('opens a saved session as it is, without starting a guest', async () => {
    const { auth } = fakeAuth(session('member', { email: 'reader@example.com' }));
    const { get } = setup(auth);
    await screen.findByText('member member');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
    expect(get().user).toEqual({ id: 'member', email: 'reader@example.com', isGuest: false });
  });

  it('shows an error when no guest can be started, and recovers on retry', async () => {
    const { auth } = fakeAuth(null);
    auth.signInAnonymously.mockResolvedValueOnce({ data: { session: null, user: null }, error: new AuthRetryableFetchError('offline', 0) } as never);
    const { get } = setup(auth);
    await screen.findByText('error');
    expect(get().error).toMatchObject({ code: 'network' });
    act(() => get().retry());
    await screen.findByText(/^guest /);
  });

  it('explains that sign-in is not set up when the build has no Supabase settings', async () => {
    const { get } = setup(null);
    await screen.findByText('error');
    expect(get().error?.message).toMatch(/isn’t set up/);
  });

  it('logs in from a guest shelf and hands that shelf to the account', async () => {
    const { auth } = fakeAuth(session('guest-1', { guest: true }));
    const client = createApiClient('http://api.test');
    const merge = vi.spyOn(client, 'mergeGuest').mockResolvedValue({ added: 3, folded: 1 });
    const { get } = setup(auth, client);
    await screen.findByText('guest guest-1');

    let result: Awaited<ReturnType<AccountContextValue['logInWithPassword']>> | undefined;
    await act(async () => {
      result = await get().logInWithPassword('reader@example.com', 'correct-horse');
    });
    expect(merge).toHaveBeenCalledWith('token-guest-1');
    expect(result).toEqual({ merged: { added: 3, folded: 1 }, mergeFailed: false });
    await screen.findByText('member member');
  });

  it('says so when the login works but the guest books can’t be added', async () => {
    const { auth } = fakeAuth(session('guest-1', { guest: true }));
    const client = createApiClient('http://api.test');
    vi.spyOn(client, 'mergeGuest').mockRejectedValue(new Error('500'));
    const { get } = setup(auth, client);
    await screen.findByText('guest guest-1');
    let result: Awaited<ReturnType<AccountContextValue['logInWithPassword']>> | undefined;
    await act(async () => {
      result = await get().logInWithPassword('reader@example.com', 'correct-horse');
    });
    expect(result).toEqual({ merged: null, mergeFailed: true });
  });

  it('turns a wrong password into words the sheet can show', async () => {
    const { auth } = fakeAuth(session('guest-1', { guest: true }));
    const { AuthApiError } = await import('@supabase/supabase-js');
    auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null, user: null }, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') } as never);
    const { get } = setup(auth);
    await screen.findByText('guest guest-1');
    await expect(get().logInWithPassword('reader@example.com', 'nope')).rejects.toMatchObject({ code: 'bad_login' });
  });

  it('answers a login code for an email with no account exactly as for one with', async () => {
    const { auth } = fakeAuth(session('guest-1', { guest: true }));
    const { AuthApiError } = await import('@supabase/supabase-js');
    auth.signInWithOtp.mockResolvedValueOnce({ data: { session: null, user: null }, error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled') });
    const { get } = setup(auth);
    await screen.findByText('guest guest-1');
    await expect(get().sendLoginCode('stranger@example.com')).resolves.toBeUndefined();
    auth.signInWithOtp.mockResolvedValueOnce({ data: { session: null, user: null }, error: new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit') });
    await expect(get().sendLoginCode('stranger@example.com')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('never reports an account deleted when the API only refused an expired sign-in', async () => {
    const { auth } = fakeAuth(session('member', { email: 'reader@example.com' }));
    const client = createApiClient('http://api.test');
    const { ApiRequestError } = await import('../api/client');
    vi.spyOn(client, 'deleteAccount').mockRejectedValue(new ApiRequestError(401, 'unauthorized', 'Sign-in is missing or has expired.'));
    const { get } = setup(auth, client);
    await screen.findByText('member member');
    await expect(get().deleteAccount()).rejects.toMatchObject({ status: 401 });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('treats a 401 as done when Supabase says the user is already gone', async () => {
    const { auth } = fakeAuth(session('member', { email: 'reader@example.com' }));
    const client = createApiClient('http://api.test');
    const { ApiRequestError } = await import('../api/client');
    const { AuthApiError } = await import('@supabase/supabase-js');
    vi.spyOn(client, 'deleteAccount').mockRejectedValue(new ApiRequestError(401, 'unauthorized', 'gone'));
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthApiError('User from sub claim in JWT does not exist', 403, 'user_not_found') } as never);
    const { get } = setup(auth, client);
    await screen.findByText('member member');
    await act(async () => {
      await get().deleteAccount();
    });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('opens a new guest shelf after signing out', async () => {
    const { auth } = fakeAuth(session('member', { email: 'reader@example.com' }));
    const { get } = setup(auth);
    await screen.findByText('member member');
    await act(async () => {
      await get().signOut();
    });
    await waitFor(() => expect(auth.signInAnonymously).toHaveBeenCalledTimes(1));
    await screen.findByText(/^guest /);
  });
});
