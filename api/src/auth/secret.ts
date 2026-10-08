import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Device secrets are 256 bits of CSPRNG output, so a single SHA-256 is enough:
 * there is nothing to brute-force, and a slow KDF would add latency to every
 * polled request. Only this hash is stored.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function verifySecret(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
