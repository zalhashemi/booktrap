import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from './secret';

const SECRET = 'a'.repeat(43);

describe('device secret hashing', () => {
  it('never returns the secret itself', () => {
    const hash = hashSecret(SECRET);
    expect(hash).not.toContain(SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies the matching secret', () => {
    expect(verifySecret(SECRET, hashSecret(SECRET))).toBe(true);
  });

  it('rejects a different secret', () => {
    expect(verifySecret('b'.repeat(43), hashSecret(SECRET))).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', () => {
    expect(verifySecret(SECRET, 'not-hex')).toBe(false);
  });
});
