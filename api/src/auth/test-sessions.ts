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

  const token = (userId: string, { guest = false }: { guest?: boolean } = {}) =>
    new SignJWT({ role: 'authenticated', is_anonymous: guest })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(`${PROJECT}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

  /** A new user id and the headers that sign in as them. */
  const signIn = async ({ guest = false }: { guest?: boolean } = {}) => {
    const userId = randomUUID();
    return { userId, headers: { authorization: `Bearer ${await token(userId, { guest })}` } };
  };

  return { verify, token, signIn };
}
