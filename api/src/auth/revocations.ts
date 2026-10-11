/**
 * Users deleted in this process. Their access tokens stay valid until they expire (up to an hour), so
 * requests from a tab still open elsewhere are refused here with a 401, rather than failing on the
 * missing user deeper down. Kept only for a token's lifetime.
 */
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

export interface Revocations {
  revoke(userId: string): void;
  isRevoked(userId: string): boolean;
}

export function createRevocations(now: () => number = Date.now): Revocations {
  const until = new Map<string, number>();
  return {
    revoke(userId) {
      for (const [id, expiry] of until) if (expiry <= now()) until.delete(id);
      until.set(userId, now() + TOKEN_LIFETIME_MS);
    },
    isRevoked(userId) {
      const expiry = until.get(userId);
      return expiry !== undefined && expiry > now();
    },
  };
}
