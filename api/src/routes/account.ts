import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { ERROR_CODES, MergeGuestRequestSchema, type MeResponse, type MergeGuestResponse } from '@booktrap/shared';
import { deleteAccount, mergeGuestShelf, type AccountDeps } from '../account';
import type { SessionVerifier } from '../auth/session-auth';
import { HttpError } from '../errors';

export function accountRoutes(app: FastifyInstance, deps: AccountDeps & { auth: preHandlerAsyncHookHandler; verify: SessionVerifier }) {
  const auth = { preHandler: deps.auth };

  app.get('/v1/me', auth, async (request): Promise<MeResponse> => {
    const user = request.user!;
    return { userId: user.id, isGuest: user.isAnonymous };
  });

  /**
   * "Delete account" (privacy policy: the right to erasure): every book, source, shelf and job the user
   * owns, then the user in Supabase Auth. A guest deleting their shelf goes through here too.
   */
  app.delete('/v1/account', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    await deleteAccount(request.user!.id, deps);
    request.log.info('account deleted by its owner');
    reply.code(204);
  });

  /**
   * Logged in on a browser that had a guest shelf: the guest's books join the account. The request is
   * signed in as the account; the guest's own access token, sent in the body, proves the browser owned
   * that guest shelf.
   */
  app.post(
    '/v1/account/merge-guest',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request): Promise<MergeGuestResponse> => {
      const user = request.user!;
      if (user.isAnonymous) throw new HttpError(400, ERROR_CODES.badRequest, 'Log in to an account first.');
      const body = MergeGuestRequestSchema.safeParse(request.body);
      if (!body.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Send the guest shelf’s sign-in token.');

      const guest = await deps.verify(body.data.guestToken).catch(() => null);
      // Only a guest shelf can be merged: a signed-in account's token here would hand its books away.
      if (!guest || !guest.isAnonymous || guest.id === user.id) {
        throw new HttpError(403, ERROR_CODES.unauthorized, 'That guest shelf can’t be added to this account.');
      }
      const result = await mergeGuestShelf(guest.id, user.id, deps);
      request.log.info(result, 'guest shelf merged into an account');
      return result;
    },
  );
}
