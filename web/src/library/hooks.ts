import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Book, Job, Tag, UpdateBookRequest } from '@booktrap/shared';
import { api } from '../api/client';
import { useUser } from '../account/account-context';

/**
 * Every library query is keyed by user: logging in or out switches users, and one shelf's cached
 * books must never be shown (or written) under another's session.
 */
const keys = {
  jobs: (userId: string) => ['jobs', userId] as const,
  books: (userId: string) => ['books', userId] as const,
  tags: (userId: string) => ['tags', userId] as const,
  export: (userId: string) => ['export', userId] as const,
};

const isActive = (job: Job) => job.status === 'queued' || job.status === 'running';
const doneCount = (jobs: Job[]) => jobs.reduce((sum, job) => sum + job.items.filter((item) => item.status === 'done').length, 0);

function useUserId(): string {
  return useUser().id;
}

/** Recent jobs. Polls every 2s while anything is still being read, then stops. */
export function useJobs() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const jobsKey = keys.jobs(userId);
  return useQuery({
    queryKey: jobsKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<Job[]>(jobsKey);
      const { jobs } = await api.listJobs(signal);
      // Books arrive as items finish: refresh the shelf only when another item has finished.
      if (previous === undefined || doneCount(jobs) !== doneCount(previous)) {
        void queryClient.invalidateQueries({ queryKey: keys.books(userId) });
      }
      return jobs;
    },
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 2000 : false),
  });
}

export function useCreateJob() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const jobsKey = keys.jobs(userId);
  return useMutation({
    mutationFn: (urls: string[]) => api.createJob(urls),
    onSuccess: (job) => {
      queryClient.setQueryData<Job[]>(jobsKey, (jobs = []) => [job, ...jobs.filter((existing) => existing.id !== job.id)]);
      void queryClient.invalidateQueries({ queryKey: jobsKey });
    },
  });
}

export function useRetryItem() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const jobsKey = keys.jobs(userId);
  return useMutation({
    mutationFn: ({ jobId, itemId }: { jobId: string; itemId: string }) => api.retryItem(jobId, itemId),
    onSuccess: (job) => {
      queryClient.setQueryData<Job[]>(jobsKey, (jobs = []) => jobs.map((existing) => (existing.id === job.id ? job : existing)));
      void queryClient.invalidateQueries({ queryKey: jobsKey });
    },
  });
}

/** "Download my data": the reader's recent export, or null. Polls every 2s while it's being made, then stops. */
export function useDataExport() {
  const userId = useUserId();
  return useQuery({
    queryKey: keys.export(userId),
    queryFn: ({ signal }) => api.exportStatus(signal),
    refetchInterval: (query) => (query.state.data?.status === 'queued' || query.state.data?.status === 'running' ? 2000 : false),
  });
}

/** Asks for an export. The server answers at once and makes it in the background. */
export function useRequestDataExport() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.requestExport(),
    onSuccess: (status) => queryClient.setQueryData(keys.export(userId), status),
  });
}

export function useBooks() {
  const userId = useUserId();
  return useQuery({
    queryKey: keys.books(userId),
    queryFn: async ({ signal }) => (await api.listBooks(signal)).books,
  });
}

export function useTags() {
  const userId = useUserId();
  return useQuery({
    queryKey: keys.tags(userId),
    queryFn: async ({ signal }) => (await api.listTags(signal)).tags,
  });
}

function editBooks(queryClient: QueryClient, userId: string, change: (books: Book[]) => Book[]) {
  queryClient.setQueryData<Book[]>(keys.books(userId), (books) => (books ? change(books) : books));
}

/**
 * The latest edit sent for each book. One-tap status and shelf changes can overlap, and an older
 * response landing late must not overwrite the newer state shown on screen.
 */
const latestEdit = new Map<string, number>();
let editSeq = 0;

export function useUpdateBook() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateBookRequest }) => api.updateBook(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: keys.books(userId) });
      // Only fields with no server-side consequences are applied early; the response is the truth.
      const early: Partial<Book> = {};
      if (patch.status) early.status = patch.status;
      if (patch.isNew === false) early.isNew = false;
      // Shelves are toggled with one tap in the book sheet, so they show at once too.
      const before = queryClient.getQueryData<Book[]>(keys.books(userId))?.find((book) => book.id === id);
      if (patch.tagIds) {
        // From the shelves list, or the book's own tags for any shelf the list doesn't have yet.
        const known = [...(queryClient.getQueryData<Tag[]>(keys.tags(userId)) ?? []), ...(before?.tags ?? [])];
        early.tags = patch.tagIds.map((tagId) => known.find((tag) => tag.id === tagId)).filter((tag): tag is Tag => tag !== undefined);
      }
      const seq = ++editSeq;
      latestEdit.set(id, seq);
      editBooks(queryClient, userId, (books) => books.map((book) => (book.id === id ? { ...book, ...early } : book)));
      // Undo only this book's early fields, leaving any other change made meanwhile alone.
      return {
        seq,
        rollback: () => {
          if (!before) return;
          const restore: Partial<Book> = {};
          for (const key of Object.keys(early) as (keyof Book)[]) Object.assign(restore, { [key]: before[key] });
          editBooks(queryClient, userId, (books) => books.map((book) => (book.id === id ? { ...book, ...restore } : book)));
        },
      };
    },
    // Only the newest edit to a book decides what's shown; an older one finishing late is ignored.
    onError: (_error, { id }, context) => {
      if (context && latestEdit.get(id) === context.seq) context.rollback();
    },
    onSuccess: (updated, { id }, context) => {
      if (context && latestEdit.get(id) !== context.seq) return;
      editBooks(queryClient, userId, (books) => books.map((book) => (book.id === updated.id ? updated : book)));
    },
  });
}

export function useDeleteBooks() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteBooks(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: keys.books(userId) });
      const removed = (queryClient.getQueryData<Book[]>(keys.books(userId)) ?? []).filter((book) => ids.includes(book.id));
      editBooks(queryClient, userId, (books) => books.filter((book) => !ids.includes(book.id)));
      // Put back only these books: another delete made meanwhile stays deleted.
      return {
        rollback: () =>
          editBooks(queryClient, userId, (books) =>
            [...books, ...removed.filter((book) => !books.some((other) => other.id === book.id))].sort((a, b) =>
              b.createdAt.localeCompare(a.createdAt),
            ),
          ),
      };
    },
    onError: (_error, _ids, context) => context?.rollback(),
  });
}

export function useRestoreBooks() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.restoreBooks(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.books(userId) }),
  });
}

export function useMarkAllSeen() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllSeen(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: keys.books(userId) });
      const wereNew = new Set((queryClient.getQueryData<Book[]>(keys.books(userId)) ?? []).filter((book) => book.isNew).map((book) => book.id));
      editBooks(queryClient, userId, (books) => books.map((book) => ({ ...book, isNew: false })));
      return {
        rollback: () => editBooks(queryClient, userId, (books) => books.map((book) => (wereNew.has(book.id) ? { ...book, isNew: true } : book))),
      };
    },
    onError: (_error, _vars, context) => context?.rollback(),
  });
}

export function useMergeBooks() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ keepId, mergeIds }: { keepId: string; mergeIds: string[] }) => api.mergeBooks(keepId, mergeIds),
    onSuccess: (merged, { mergeIds }) =>
      editBooks(queryClient, userId, (books) =>
        books.filter((book) => !mergeIds.includes(book.id)).map((book) => (book.id === merged.id ? merged : book)),
      ),
  });
}

export function useCreateTag() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createTag(name),
    onSuccess: (tag) => {
      queryClient.setQueryData<Tag[]>(keys.tags(userId), (tags = []) =>
        (tags.some((existing) => existing.id === tag.id) ? tags : [...tags, tag]).sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
  });
}

export function useRenameTag() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameTag(id, name),
    onSuccess: (tag) => {
      queryClient.setQueryData<Tag[]>(keys.tags(userId), (tags = []) => tags.map((existing) => (existing.id === tag.id ? tag : existing)));
      editBooks(queryClient, userId, (books) =>
        books.map((book) => ({ ...book, tags: book.tags.map((existing) => (existing.id === tag.id ? tag : existing)) })),
      );
    },
  });
}

export function useDeleteTag() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<Tag[]>(keys.tags(userId), (tags = []) => tags.filter((tag) => tag.id !== id));
      editBooks(queryClient, userId, (books) => books.map((book) => ({ ...book, tags: book.tags.filter((tag) => tag.id !== id) })));
    },
  });
}
