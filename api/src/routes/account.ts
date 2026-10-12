import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { ERROR_CODES, MergeGuestRequestSchema, type ExportStatus, type ExportStatusResponse, type MeResponse, type MergeGuestResponse } from '@booktrap/shared';
import { deleteAccount, GuestBusyError, mergeGuestShelf, type AccountDeps } from '../account';
import type { SessionVerifier } from '../auth/session-auth';
import type { ExportJobs } from '../export-jobs';
import { HttpError } from '../errors';

/** An account is deleted only by a session signed in with an emailed code this recently, so a stolen sign-in alone can't delete it. */
export const DELETE_CODE_WINDOW_MS = 10 * 60 * 1000;

export function accountRoutes(app: FastifyInstance, deps: AccountDeps & { auth: preHandlerAsyncHookHandler; verify: SessionVerifier; exports: ExportJobs }) {
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
    const user = request.user!;
    // A guest has no email to send a code to: their shelf lives only in this browser anyway.
    if (!user.isAnonymous && (!user.emailCodeAt || Date.now() - user.emailCodeAt.getTime() > DELETE_CODE_WINDOW_MS)) {
      throw new HttpError(403, ERROR_CODES.reauthRequired, 'Confirm with the code we email you, then delete the account.');
    }
    await deleteAccount(user.id, deps);
    request.log.info('account deleted by its owner');
    reply.code(204);
  });

  /**
   * "Download my data" (privacy policy: the right of access): every book with its sources, shelves and
   * notes, as JSON. Made in the background; the reader polls the status, then fetches the file.
   */
  app.post('/v1/account/export', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply): Promise<ExportStatus> => {
    reply.code(202);
    return deps.exports.request(request.user!.id);
  });

  app.get('/v1/account/export', auth, async (request): Promise<ExportStatusResponse> => ({ export: deps.exports.status(request.user!.id) }));

  app.get('/v1/account/export/file', auth, async (request, reply) => {
    const file = deps.exports.file(request.user!.id);
    if (!file) throw new HttpError(404, ERROR_CODES.notFound, 'The export isn’t ready, or has expired. Ask for a new one.');
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="booktrap-my-data.json"')
      .header('cache-control', 'no-store')
      .send(file);
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
      // The token's claim isn't enough on its own: one issued before the guest saved their shelf still
      // says "guest" for up to an hour, so Supabase is asked too.
      const refused = new HttpError(403, ERROR_CODES.unauthorized, 'That guest shelf can’t be added to this account.');
      if (!guest || !guest.isAnonymous || guest.id === user.id) throw refused;
      if (!(await deps.users.isGuest(guest.id))) throw refused;
      let result;
      try {
        result = await mergeGuestShelf(guest.id, user.id, deps);
      } catch (error) {
        if (error instanceof GuestBusyError) {
          throw new HttpError(409, ERROR_CODES.busy, 'A link from this browser is still being read. Try again in a minute.');
        }
        throw error;
      }
      request.log.info(result, 'guest shelf merged into an account');
      return result;
    },
  );
}
