import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import {
  BookIdsRequestSchema,
  ERROR_CODES,
  MergeBooksRequestSchema,
  TagNameSchema,
  UpdateBookRequestSchema,
  type Book,
  type Tag,
} from '@booktrap/shared';
import { z } from 'zod';
import { HttpError } from '../errors';
import { isSameBook, normalizedKey } from '../pipeline/normalize';
import { COVER_HOSTS, safeFetch } from '../pipeline/safe-fetch';
import { verifyBook } from '../pipeline/verify';
import { TagNameTakenError, type BookPatch, type LibraryStore } from '../store/types';

export interface LibraryRouteDeps {
  auth: preHandlerAsyncHookHandler;
  store: LibraryStore;
  googleBooksApiKey?: string;
  /** Test seams. */
  verify?: typeof verifyBook;
  fetchImpl?: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids reach uuid columns: anything else is simply not found (never a database error). */
const isUuid = (value: string) => UUID.test(value);

const COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** The body, or null once it passes `maxBytes` (content-length can be missing or wrong). */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'That change isn’t valid.';
}

export function libraryRoutes(app: FastifyInstance, deps: LibraryRouteDeps) {
  const { store } = deps;
  const auth = { preHandler: deps.auth };
  const verify = deps.verify ?? verifyBook;

  app.get('/v1/books', auth, async (request): Promise<{ books: Book[] }> => {
    return { books: await store.listBooks(request.user!.id) };
  });

  /**
   * Edit a book (brief §7). Changing the title or author re-runs verification against
   * Google Books / Open Library and fills the ISBN and cover when a match is found.
   */
  app.patch<{ Params: { bookId: string } }>('/v1/books/:bookId', auth, async (request): Promise<Book> => {
    const userId = request.user!.id;
    const parsed = UpdateBookRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, firstIssue(parsed.error));
    const body = parsed.data;

    const current = isUuid(request.params.bookId) ? await store.getBook(userId, request.params.bookId) : null;
    if (!current) throw new HttpError(404, ERROR_CODES.notFound, 'That book isn’t on your shelf.');

    const patch: BookPatch = {
      title: body.title,
      author: body.author,
      isbn10: body.isbn10,
      isbn13: body.isbn13,
      status: body.status,
      notes: body.notes,
      isNew: body.isNew,
    };

    const title = body.title ?? current.title;
    const author = body.author !== undefined ? body.author : current.author;
    const identityChanged = title !== current.title || author !== current.author;
    if (identityChanged) {
      patch.normalizedKey = normalizedKey(title, author);
      const result = await verify(title, author, {
        googleBooksApiKey: deps.googleBooksApiKey,
        log: (message, detail) => request.log.warn({ detail }, message),
      });
      // The reader's wording stays. Identifiers, cover and year now describe the new identity:
      // the match's when one is found, and nothing (rather than the old book's) when not.
      patch.verified = result.verified;
      if (body.isbn13 === undefined) patch.isbn13 = result.verified ? result.isbn13 : null;
      if (body.isbn10 === undefined) patch.isbn10 = result.verified ? result.isbn10 : null;
      patch.coverUrl = result.verified ? result.coverUrl : null;
      patch.publishedYear = result.verified ? result.publishedYear : null;
      // Editing a book counts as reviewing it.
      patch.isNew = false;
    }

    // Fields first, tags second: a failed field update never leaves tags already changed.
    const updated = await store.updateBook(userId, current.id, patch);
    if (!updated) throw new HttpError(404, ERROR_CODES.notFound, 'That book isn’t on your shelf.');
    if (!body.tagIds) return updated;
    await store.setBookTags(userId, current.id, body.tagIds.filter(isUuid));
    return (await store.getBook(userId, current.id)) ?? updated;
  });

  /**
   * A book's cover, for the PDF export: Google Books images can't be read by the browser (no
   * CORS), so the API passes the stored cover through. Only that book's own cover, only from
   * the cover hosts, only images, and never more than 2 MB. A PDF of a big shelf asks for hundreds
   * at once, so covers have their own rate limit rather than spending the app's general one. The
   * client adds the cover's version (?v=) to the URL, so a re-matched book never gets a stale cover.
   */
  app.get<{ Params: { bookId: string } }>(
    '/v1/books/:bookId/cover',
    { ...auth, config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const book = isUuid(request.params.bookId) ? await store.getBook(request.user!.id, request.params.bookId) : null;
      if (!book) throw new HttpError(404, ERROR_CODES.notFound, 'That book isn’t on your shelf.');
      const missing = () => new HttpError(404, ERROR_CODES.notFound, 'No cover for this book.');
      if (!book.coverUrl) throw missing();

      let image: { bytes: Buffer; type: string };
      try {
        const { response } = await safeFetch(book.coverUrl, { hosts: COVER_HOSTS, timeoutMs: 10_000, fetchImpl: deps.fetchImpl });
        const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
        if (!response.ok || !COVER_TYPES.has(type)) {
          await response.body?.cancel();
          throw missing();
        }
        const bytes = await readCapped(response, MAX_COVER_BYTES);
        if (!bytes) throw missing();
        image = { bytes, type };
      } catch (error) {
        if (!(error instanceof HttpError)) request.log.warn({ err: error, bookId: book.id }, 'cover fetch failed');
        throw missing();
      }
      reply.header('content-type', image.type).header('cache-control', 'private, max-age=86400');
      return reply.send(image.bytes);
    },
  );

  app.post('/v1/books/delete', auth, async (request) => {
    const parsed = BookIdsRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose at least one book.');
    return { count: await store.deleteBooks(request.user!.id, parsed.data.ids.filter(isUuid)) };
  });

  /**
   * Undo a delete. A restored book that now duplicates a live one (the same book was found
   * again while it sat deleted) is merged into that copy instead of coming back twice.
   */
  app.post('/v1/books/restore', auth, async (request) => {
    const userId = request.user!.id;
    const parsed = BookIdsRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose at least one book.');
    const ids = parsed.data.ids.filter(isUuid);
    const count = await store.restoreBooks(userId, ids);
    for (const id of ids) {
      const restored = await store.getBook(userId, id);
      if (!restored) continue;
      const twin = (await store.dedupCandidates(userId)).find((candidate) => candidate.id !== id && isSameBook(candidate, restored));
      if (twin) await store.mergeBooks(userId, twin.id, [id]);
    }
    return { count };
  });

  app.post('/v1/books/mark-seen', auth, async (request) => {
    return { count: await store.markAllSeen(request.user!.id) };
  });

  /** Manual "Merge duplicates" for pairs the automatic matching missed (brief §7). */
  app.post('/v1/books/merge', auth, async (request): Promise<Book> => {
    const parsed = MergeBooksRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose at least two books to merge.');
    const { keepId, mergeIds } = parsed.data;
    const merged = isUuid(keepId) ? await store.mergeBooks(request.user!.id, keepId, mergeIds.filter(isUuid)) : null;
    if (!merged) throw new HttpError(404, ERROR_CODES.notFound, 'That book isn’t on your shelf.');
    return merged;
  });

  app.get('/v1/tags', auth, async (request): Promise<{ tags: Tag[] }> => {
    return { tags: await store.listTags(request.user!.id) };
  });

  app.post('/v1/tags', auth, async (request, reply): Promise<Tag> => {
    const parsed = z.object({ name: TagNameSchema }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, firstIssue(parsed.error));
    reply.code(201);
    return store.createTag(request.user!.id, parsed.data.name);
  });

  app.patch<{ Params: { tagId: string } }>('/v1/tags/:tagId', auth, async (request): Promise<Tag> => {
    const parsed = z.object({ name: TagNameSchema }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, firstIssue(parsed.error));
    try {
      const tag = isUuid(request.params.tagId) ? await store.renameTag(request.user!.id, request.params.tagId, parsed.data.name) : null;
      if (!tag) throw new HttpError(404, ERROR_CODES.notFound, 'That shelf doesn’t exist.');
      return tag;
    } catch (error) {
      if (error instanceof TagNameTakenError) throw new HttpError(409, ERROR_CODES.badRequest, error.message);
      throw error;
    }
  });

  app.delete<{ Params: { tagId: string } }>('/v1/tags/:tagId', auth, async (request, reply) => {
    const removed = isUuid(request.params.tagId) && (await store.deleteTag(request.user!.id, request.params.tagId));
    if (!removed) throw new HttpError(404, ERROR_CODES.notFound, 'That shelf doesn’t exist.');
    reply.code(204);
  });
}
