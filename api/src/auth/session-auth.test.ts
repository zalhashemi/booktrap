import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { ERROR_CODES } from '@booktrap/shared';
import { errorBody, HttpError } from '../errors';
import { createSessionVerifier, requireUser, type SessionVerifier } from './session-auth';

const PROJECT = 'https://abcdefgh.supabase.co';
const ISSUER = `${PROJECT}/auth/v1`;
const KID = 'current-key';

let privateKey: CryptoKey;
let publicJwk: JWK;
let verify: SessionVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  verify = createSessionVerifier({ supabaseUrl: PROJECT, getKey: createLocalJWKSet({ keys: [publicJwk] }) });
});

interface TokenOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresAt?: number | string;
  key?: CryptoKey | Uint8Array;
  alg?: string;
  kid?: string;
}

/** A token shaped like Supabase's: sub, role, is_anonymous, aud "authenticated", 1 hour. */
function token({ claims = {}, issuer = ISSUER, audience = 'authenticated', expiresAt = '1h', key, alg = 'ES256', kid = KID }: TokenOptions = {}) {
  return new SignJWT({ role: 'authenticated', is_anonymous: false, ...claims })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setSubject(typeof claims.sub === 'string' ? claims.sub : randomUUID())
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key ?? privateKey);
}

describe('createSessionVerifier', () => {
  it('accepts a signed-in user', async () => {
    const id = randomUUID();
    await expect(verify(await token({ claims: { sub: id } }))).resolves.toEqual({ id, isAnonymous: false, emailCodeAt: null });
  });

  it('accepts a guest and says so', async () => {
    const id = randomUUID();
    await expect(verify(await token({ claims: { sub: id, is_anonymous: true } }))).resolves.toEqual({
      id,
      isAnonymous: true,
      emailCodeAt: null,
    });
  });

  it('treats a token without is_anonymous as a signed-in user', async () => {
    const id = randomUUID();
    await expect(verify(await token({ claims: { sub: id, is_anonymous: undefined } }))).resolves.toEqual({
      id,
      isAnonymous: false,
      emailCodeAt: null,
    });
  });

  it('notes when the session last signed in by an emailed code, ignoring other methods', async () => {
    const id = randomUUID();
    const amr = [
      { method: 'otp', timestamp: 1_700_000_000 },
      { method: 'password', timestamp: 1_800_000_000 },
      { method: 'magiclink', timestamp: 1_750_000_000 },
    ];
    await expect(verify(await token({ claims: { sub: id, amr } }))).resolves.toEqual({
      id,
      isAnonymous: false,
      emailCodeAt: new Date(1_750_000_000_000),
    });
  });

  it('refuses an expired token', async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    await expect(verify(await token({ expiresAt: expired }))).rejects.toThrow(/exp/);
  });

  it('allows a few seconds of clock drift', async () => {
    const justExpired = Math.floor(Date.now() / 1000) - 2;
    await expect(verify(await token({ expiresAt: justExpired }))).resolves.toBeDefined();
  });

  it('refuses another issuer', async () => {
    await expect(verify(await token({ issuer: 'https://other.supabase.co/auth/v1' }))).rejects.toThrow(/iss/);
  });

  it('refuses another audience', async () => {
    await expect(verify(await token({ audience: 'anon' }))).rejects.toThrow(/aud/);
  });

  it.each(['anon', 'service_role'])('refuses role %s', async (role) => {
    await expect(verify(await token({ claims: { role } }))).rejects.toThrow();
  });

  it('refuses a token whose sub is not a user id', async () => {
    await expect(verify(await token({ claims: { sub: 'not-a-uuid' } }))).rejects.toThrow();
  });

  it('refuses a token signed by a key the project does not publish', async () => {
    const stranger = await generateKeyPair('ES256');
    await expect(verify(await token({ key: stranger.privateKey }))).rejects.toThrow();
    await expect(verify(await token({ key: stranger.privateKey, kid: 'unknown' }))).rejects.toThrow();
  });

  it('refuses an HS256 token (the legacy shared secret)', async () => {
    const secret = new TextEncoder().encode('super-secret-jwt-token-with-at-least-32-characters');
    await expect(verify(await token({ key: secret, alg: 'HS256' }))).rejects.toThrow();
  });

  it('refuses a tampered payload', async () => {
    const [header, , signature] = (await token()).split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: randomUUID(), role: 'authenticated', aud: 'authenticated', iss: ISSUER, exp: 9999999999 }),
    ).toString('base64url');
    await expect(verify(`${header}.${forged}.${signature}`)).rejects.toThrow();
  });

  it('fetches the signing keys from the project when none are given', async () => {
    const server = createServer((request, response) => {
      if (request.url !== '/auth/v1/.well-known/jwks.json') return void response.writeHead(404).end();
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    onTestFinished(() => void server.close());
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const remote = createSessionVerifier({ supabaseUrl: `${origin}/rest/v1/` });
    const id = randomUUID();
    await expect(remote(await token({ claims: { sub: id }, issuer: `${origin}/auth/v1` }))).resolves.toEqual({
      id,
      isAnonymous: false,
      emailCodeAt: null,
    });
  });
});

describe('requireUser', () => {
  async function app() {
    const fastify = Fastify();
    fastify.setErrorHandler((error, _request, reply) =>
      error instanceof HttpError
        ? reply.code(error.statusCode).send(errorBody(error.code, error.message))
        : reply.code(500).send(error),
    );
    fastify.get('/me', { preHandler: requireUser(verify) }, async (request) => request.user);
    await fastify.ready();
    onTestFinished(() => fastify.close());
    return fastify;
  }

  it('attaches the user from a valid bearer token', async () => {
    const fastify = await app();
    const id = randomUUID();
    const response = await fastify.inject({
      url: '/me',
      headers: { authorization: `Bearer ${await token({ claims: { sub: id, is_anonymous: true } })}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id, isAnonymous: true, emailCodeAt: null });
  });

  it('gives every failure the same 401', async () => {
    const fastify = await app();
    const expired = await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    const headers = [
      {},
      { authorization: '' },
      { authorization: 'Basic abc' },
      { authorization: `bearer ${await token()}` },
      { authorization: 'Bearer not-a-jwt' },
      { authorization: `Bearer ${expired}` },
      { authorization: `Bearer ${await token({ issuer: 'https://evil.example/auth/v1' })}` },
    ];
    const bodies = new Set<string>();
    for (const header of headers) {
      const response = await fastify.inject({ url: '/me', headers: header });
      expect(response.statusCode).toBe(401);
      bodies.add(response.body);
    }
    expect([...bodies]).toHaveLength(1);
    expect(JSON.parse([...bodies][0]!)).toMatchObject({ error: { code: ERROR_CODES.unauthorized } });
  });
});
