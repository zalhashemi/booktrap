import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceRepo } from './types';

const UNIQUE_VIOLATION = '23505';

export function createSupabaseDeviceRepo(db: SupabaseClient): DeviceRepo {
  return {
    kind: 'supabase',
    async find(id) {
      const { data, error } = await db
        .from('devices')
        .select('id, secret_hash, created_at, last_seen_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`devices.find failed: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        secretHash: data.secret_hash,
        createdAt: data.created_at,
        lastSeenAt: data.last_seen_at,
      };
    },
    async insert(id, secretHash) {
      const { error } = await db.from('devices').insert({ id, secret_hash: secretHash });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`devices.insert failed: ${error.message}`);
    },
    async touch(id, at) {
      const { error } = await db.from('devices').update({ last_seen_at: at.toISOString() }).eq('id', id);
      if (error) throw new Error(`devices.touch failed: ${error.message}`);
    },
    async ping() {
      const { error } = await db.from('devices').select('id').limit(1);
      if (error) throw new Error(`database unreachable: ${error.message}`);
    },
  };
}
