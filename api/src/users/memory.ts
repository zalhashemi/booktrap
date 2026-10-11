import type { UserDirectory } from './types';

interface MemoryUser {
  guest: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export type MemoryUserDirectory = UserDirectory & {
  /** Tests: register a user, as signing in (or starting as a guest) would in Supabase. */
  add(userId: string, options?: { guest?: boolean; createdAt?: Date }): void;
  /** Tests: a guest who added an email. */
  upgrade(userId: string): void;
  has(userId: string): boolean;
};

/** Development and test stand-in for Supabase Auth. */
export function createMemoryUserDirectory(): MemoryUserDirectory {
  const users = new Map<string, MemoryUser>();
  return {
    kind: 'memory',
    async ping() {},
    async isGuest(userId) {
      return users.get(userId)?.guest ?? false;
    },
    async touch(userId, at) {
      const user = users.get(userId);
      if (user) user.lastSeenAt = at;
    },
    async inactiveGuests(before, limit) {
      return [...users]
        .filter(([, user]) => user.guest && (user.lastSeenAt ?? user.createdAt) < before)
        .sort(([, a], [, b]) => (a.lastSeenAt ?? a.createdAt).getTime() - (b.lastSeenAt ?? b.createdAt).getTime())
        .slice(0, limit)
        .map(([id]) => id);
    },
    async remove(userId) {
      users.delete(userId);
    },
    add(userId, { guest = false, createdAt = new Date() } = {}) {
      users.set(userId, { guest, createdAt, lastSeenAt: null });
    },
    upgrade(userId) {
      const user = users.get(userId);
      if (user) user.guest = false;
    },
    has(userId) {
      return users.has(userId);
    },
  };
}
