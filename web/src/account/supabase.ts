import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase is used for sign-in only: the app never reads the database (RLS is on with no policies),
 * and every shelf request goes through the BookTrap API with the access token. Both values are public.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type AuthClient = SupabaseClient['auth'];

/** Null when the build has no Supabase settings: the app then explains it can't open a shelf. */
export const authClient: AuthClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'booktrap.auth' },
      }).auth
    : null;
