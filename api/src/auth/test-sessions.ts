import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createSessionVerifier } from './session-auth';

const PROJECT = 'https://test-project.supabase.co';

/**
 * Tests only: Supabase-shaped access tokens signed with a key made for this run, and a verifier that
 * trusts that key, so route tests sign in the way the web app does.
 */
export async function testSessions() {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256' };
  const verify = createSessionVerifier({ supabaseUrl: PROJECT, getKey: createLocalJWKSet({ keys: [jwk] }) });

  /** `amr`: how the session signed in, e.g. [{ method: 'otp', timestamp }], as Supabase records it. */
  const token = (userId: string, { guest = false, amr }: { guest?: boolean; amr?: { method: string; timestamp: number }[] } = {}) =>
    new SignJWT({ role: 'authenticated', is_anonymous: guest, ...(amr && { amr }) })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(`${PROJECT}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

  /** A new user id and the headers that sign in as them. */
  const signIn = async (options: Parameters<typeof token>[1] = {}) => {
    const userId = randomUUID();
    return { userId, headers: { authorization: `Bearer ${await token(userId, options)}` } };
  };

  return { verify, token, signIn };
}
