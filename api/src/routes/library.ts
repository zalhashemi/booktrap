import type { FastifyInstance } from 'fastify';
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
import { requireDevice } from '../auth/device-auth';
import { HttpError } from '../errors';
import { isSameBook, normalizedKey } from '../pipeline/normalize';
import { verifyBook } from '../pipeline/verify';
import type { DeviceRepo } from '../repo/types';
import { TagNameTakenError, type BookPatch, type LibraryStore } from '../store/types';

export interface LibraryRouteDeps {
  devices: DeviceRepo;
  store: LibraryStore;
  googleBooksApiKey?: string;
  /** Test seam. */
  verify?: typeof verifyBook;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids reach uuid columns: anything else is simply not found (never a database error). */
const isUuid = (value: string) => UUID.test(value);

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'That change isn’t valid.';
}

export function libraryRoutes(app: FastifyInstance, deps: LibraryRouteDeps) {
  const { store } = deps;
  const auth = { preHandler: requireDevice(deps.devices) };
  const verify = deps.verify ?? verifyBook;

  app.get('/v1/books', auth, async (request): Promise<{ books: Book[] }> => {
    return { books: await store.listBooks(request.device!.id) };
  });

  /**
   * Edit a book (brief §7). Changing the title or author re-runs verification against
   * Google Books / Open Library and fills the ISBN and cover when a match is found.
   */
  app.patch<{ Params: { bookId: string } }>('/v1/books/:bookId', auth, async (request): Promise<Book> => {
    const deviceId = request.device!.id;
    const parsed = UpdateBookRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, firstIssue(parsed.error));
    const body = parsed.data;

    const current = isUuid(request.params.bookId) ? await store.getBook(deviceId, request.params.bookId) : null;
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
    const updated = await store.updateBook(deviceId, current.id, patch);
    if (!updated) throw new HttpError(404, ERROR_CODES.notFound, 'That book isn’t on your shelf.');
    if (!body.tagIds) return updated;
    await store.setBookTags(deviceId, current.id, body.tagIds.filter(isUuid));
    return (await store.getBook(deviceId, current.id)) ?? updated;
  });

  app.post('/v1/books/delete', auth, async (request) => {
    const parsed = BookIdsRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose at least one book.');
    return { count: await store.deleteBooks(request.device!.id, parsed.data.ids.filter(isUuid)) };
  });

  /**
   * Undo a delete. A restored book that now duplicates a live one (the same book was found
   * again while it sat deleted) is merged into that copy instead of coming back twice.
   */
  app.post('/v1/books/restore', auth, async (request) => {
    const deviceId = request.device!.id;
    const parsed = BookIdsRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose at least one book.');
    const ids = parsed.data.ids.filter(isUuid);
    const count = await store.restoreBooks(deviceId, ids);
    for (const id of ids) {
      const restored = await store.getBook(deviceId, id);
      if (!restored) continue;
      const twin = (await store.dedupCandidates(deviceId)).find((candidate) => candidate.id !== id && isSameBook(candidate, restored));
      if (twin) await store.mergeBooks(deviceId, twin.id, [id]);
    }
    return { count };
  });

  app.post('/v1/books/mark-seen', auth, async (request) => {
    return { count: await store.markAllSeen(request.device!.id) };
  });

  /** Manual "Merge duplicates" for pairs the automatic matching missed (brief §7). */
  app.post('/v1/books/merge', auth, async (request): Promise<Book> => {
    const parsed = MergeBooksRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, 'Choose at least two books to merge.');
    const { keepId, mergeIds } = parsed.data;
    const merged = isUuid(keepId) ? await store.mergeBooks(request.device!.id, keepId, mergeIds.filter(isUuid)) : null;
    if (!merged) throw new HttpError(404, ERROR_CODES.notFound, 'That book isn’t on your shelf.');
    return merged;
  });

  app.get('/v1/tags', auth, async (request): Promise<{ tags: Tag[] }> => {
    return { tags: await store.listTags(request.device!.id) };
  });

  app.post('/v1/tags', auth, async (request, reply): Promise<Tag> => {
    const parsed = z.object({ name: TagNameSchema }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, firstIssue(parsed.error));
    reply.code(201);
    return store.createTag(request.device!.id, parsed.data.name);
  });

  app.patch<{ Params: { tagId: string } }>('/v1/tags/:tagId', auth, async (request): Promise<Tag> => {
    const parsed = z.object({ name: TagNameSchema }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, ERROR_CODES.badRequest, firstIssue(parsed.error));
    try {
      const tag = isUuid(request.params.tagId) ? await store.renameTag(request.device!.id, request.params.tagId, parsed.data.name) : null;
      if (!tag) throw new HttpError(404, ERROR_CODES.notFound, 'That shelf doesn’t exist.');
      return tag;
    } catch (error) {
      if (error instanceof TagNameTakenError) throw new HttpError(409, ERROR_CODES.badRequest, error.message);
      throw error;
    }
  });

  app.delete<{ Params: { tagId: string } }>('/v1/tags/:tagId', auth, async (request, reply) => {
    const removed = isUuid(request.params.tagId) && (await store.deleteTag(request.device!.id, request.params.tagId));
    if (!removed) throw new HttpError(404, ERROR_CODES.notFound, 'That shelf doesn’t exist.');
    reply.code(204);
  });
}
