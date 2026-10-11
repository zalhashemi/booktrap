import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { ERROR_CODES } from '@booktrap/shared';
import { HttpError } from '../errors';

/** Seconds of clock drift allowed between Supabase and this server. */
const CLOCK_TOLERANCE_S = 5;

export interface AuthedUser {
  id: string;
  /** A guest: a Supabase anonymous user who hasn't added an email yet. */
  isAnonymous: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

// Supabase access tokens: `sub` is the user id, `role` is "authenticated" for every signed-in user
// (guests included), and `is_anonymous` marks guests.
const ClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  is_anonymous: z.boolean().optional().default(false),
});

export type SessionVerifier = (token: string) => Promise<AuthedUser>;

export interface SessionVerifierOptions {
  /** The project URL, e.g. https://abc.supabase.co. Tokens are issued by `<url>/auth/v1`. */
  supabaseUrl: string;
  /** Signing keys. Defaults to the project's published JWKS, cached and refetched on an unknown key id. */
  getKey?: JWTVerifyGetKey;
}

/**
 * Verifies Supabase access tokens locally against the project's asymmetric signing keys (ES256),
 * so no request waits on Supabase. Throws on any invalid token.
 */
export function createSessionVerifier({ supabaseUrl, getKey }: SessionVerifierOptions): SessionVerifier {
  const origin = new URL(supabaseUrl).origin;
  const keys = getKey ?? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', origin));
  const issuer = `${origin}/auth/v1`;

  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
      clockTolerance: CLOCK_TOLERANCE_S,
      requiredClaims: ['exp', 'sub'],
    });
    const claims = ClaimsSchema.parse(payload);
    return { id: claims.sub, isAnonymous: claims.is_anonymous };
  };
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/** A visit is noted at most this often per user (guests not seen for 30 days are deleted). */
const SEEN_INTERVAL_MS = 60 * 60 * 1000;
/** Bounds the "recently noted" memory; forgetting early only costs one extra write. */
const SEEN_MEMORY = 10_000;

export interface RequireUserOptions {
  /** Called at most hourly per user, never awaited by the request. */
  onSeen?: (userId: string, at: Date) => Promise<void>;
  now?: () => Date;
}

/**
 * preHandler that authorizes a request by its Supabase access token and attaches the user.
 * Every failure gives the same 401, so the response says nothing about why a token was refused.
 */
export function requireUser(verify: SessionVerifier, { onSeen, now = () => new Date() }: RequireUserOptions = {}) {
  const lastSeen = new Map<string, number>();
  const noteVisit = (request: FastifyRequest, userId: string) => {
    if (!onSeen) return;
    const at = now();
    if (at.getTime() - (lastSeen.get(userId) ?? 0) < SEEN_INTERVAL_MS) return;
    if (lastSeen.size >= SEEN_MEMORY) lastSeen.clear();
    lastSeen.set(userId, at.getTime());
    onSeen(userId, at).catch((error: unknown) => {
      lastSeen.delete(userId);
      request.log.warn({ err: error }, 'failed to note a visit');
    });
  };

  return async function sessionAuth(request: FastifyRequest, _reply: FastifyReply) {
    const unauthorized = new HttpError(401, ERROR_CODES.unauthorized, 'Sign-in is missing or has expired.');

    const header = request.headers.authorization;
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) throw unauthorized;

    try {
      request.user = await verify(match[1]!);
    } catch (error) {
      request.log.debug({ err: error }, 'access token refused');
      throw unauthorized;
    }
    noteVisit(request, request.user.id);
  };
}
