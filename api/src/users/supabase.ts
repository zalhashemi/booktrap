import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserDirectory } from './types';

export function createSupabaseUserDirectory(db: SupabaseClient): UserDirectory {
  return {
    kind: 'supabase',
    async ping() {
      const { error } = await db.from('user_activity').select('user_id', { head: true }).limit(1);
      if (error) throw new Error(`ping failed: ${error.message}`);
    },
    async isGuest(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error) {
        if (error.status === 404) return false;
        throw new Error(`auth.getUser failed: ${error.message}`);
      }
      return data.user.is_anonymous ?? false;
    },
    async touch(userId, at) {
      const { error } = await db.from('user_activity').upsert({ user_id: userId, last_seen_at: at.toISOString() });
      if (error) throw new Error(`user_activity.touch failed: ${error.message}`);
    },
    async inactiveGuests(before, limit) {
      const { data, error } = await db.rpc('inactive_guests', { p_before: before.toISOString(), p_limit: limit });
      if (error) throw new Error(`inactive_guests failed: ${error.message}`);
      return (data as string[] | null) ?? [];
    },
    async remove(userId) {
      const { error } = await db.auth.admin.deleteUser(userId);
      if (error && error.status !== 404) throw new Error(`auth.deleteUser failed: ${error.message}`);
    },
  };
}
