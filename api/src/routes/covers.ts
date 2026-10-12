import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@booktrap/shared';
import { COVER_WIDTHS, type CoverCache, type CoverWidth } from '../covers';
import { HttpError } from '../errors';

/**
 * Book covers for the shelf, as small WebP. Public (an <img> can't send a sign-in), so it serves only
 * the catalogues' cover hosts, at fixed widths, and has its own per-network rate limit. A cover's URL
 * never changes what it shows, so browsers keep the answer for a year.
 */
export function coverRoutes(app: FastifyInstance, { covers }: { covers: CoverCache }) {
  app.get<{ Querystring: { u?: string; w?: string } }>(
    '/v1/covers',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { u, w } = request.query;
      const width = Number(w) as CoverWidth;
      if (!u || !COVER_WIDTHS.includes(width)) throw new HttpError(400, ERROR_CODES.badRequest, `Give a cover URL and a width (${COVER_WIDTHS.join(' or ')}).`);
      const image = await covers.get(u, width);
      // A 404 lets the shelf show its bookcloth plate, as it does for a cover that never loads.
      if (!image) throw new HttpError(404, ERROR_CODES.notFound, 'No cover there.');
      return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=31536000, immutable').send(image);
    },
  );
}
