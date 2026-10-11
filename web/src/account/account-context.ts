import { createContext, useContext } from 'react';
import type { MergeGuestResponse } from '@booktrap/shared';

export interface AccountUser {
  id: string;
  /** Null for a guest who hasn't saved their shelf yet. */
  email: string | null;
  /** An anonymous Supabase user: the shelf lives only in this browser until an email is added. */
  isGuest: boolean;
}

/** After logging in: what happened to the guest shelf this browser had (none: `merged` is null). */
export interface LoginResult {
  merged: MergeGuestResponse | null;
  /** The login worked, but the guest's books couldn't be added. They stay on the server for 30 days. */
  mergeFailed: boolean;
}

/** Kept apart from the provider component so hot reloads never re-create the context mid-session. */
export interface AccountContextValue {
  status: 'loading' | 'error' | 'ready';
  user: AccountUser | null;
  error: Error | null;
  /** False when the browser blocks storage, so the session ends with the tab. */
  durable: boolean;
  retry: () => void;

  /** Saving a guest's shelf, step 1: emails a code to confirm the address. Throws AccountError('email_taken') if it has an account. */
  sendSaveCode: (email: string) => Promise<void>;
  /** Step 2: the code from the email, and a password if the reader chose one. The shelf and user id stay the same. */
  confirmSaveCode: (email: string, code: string, password?: string) => Promise<void>;

  /** Logging in to an existing account. A guest shelf open in this browser joins that account's shelf. */
  logInWithPassword: (email: string, password: string) => Promise<LoginResult>;
  /** Emails a login code (or a code to reset a forgotten password). Never creates an account. */
  sendLoginCode: (email: string) => Promise<void>;
  confirmLoginCode: (email: string, code: string) => Promise<LoginResult>;

  /** Sets or changes the signed-in reader's password. */
  setPassword: (password: string) => Promise<void>;
  /** Signs out of this browser; it opens a new, empty guest shelf. */
  signOut: () => Promise<void>;
  /** Deletes the account (or guest shelf) and everything on it, then opens a new guest shelf. */
  deleteAccount: () => Promise<void>;
  /** Tries again to add the guest shelf whose merge failed at login (while its token lasts). */
  retryGuestMerge: () => Promise<LoginResult>;
}

export type AccountErrorCode = 'email_taken' | 'bad_code' | 'bad_login' | 'weak_password' | 'rate_limited' | 'network' | 'unknown';

/** A sign-in problem the screens can explain in words. */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside <AccountProvider>');
  return value;
}

/** The signed-in user, for components that only render once the account is ready. */
export function useUser(): AccountUser {
  const { user } = useAccount();
  if (!user) throw new Error('useUser needs a ready account');
  return user;
}
