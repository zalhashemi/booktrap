import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Job } from '@booktrap/shared';
import { api } from '../api/client';
import { useDevice } from '../device/DeviceProvider';

export const JOBS_KEY = ['jobs'] as const;
export const BOOKS_KEY = ['books'] as const;

const isActive = (job: Job) => job.status === 'queued' || job.status === 'running';
const doneCount = (jobs: Job[]) => jobs.reduce((sum, job) => sum + job.items.filter((item) => item.status === 'done').length, 0);

function useCredentials() {
  const { session } = useDevice();
  if (!session) throw new Error('library hooks need a ready device session');
  return session.credentials;
}

/** Recent jobs. Polls every 2s while anything is still being read, then stops. */
export function useJobs() {
  const credentials = useCredentials();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<Job[]>(JOBS_KEY);
      const { jobs } = await api.listJobs(credentials, signal);
      // Books arrive as items finish: refresh the shelf only when another item has finished.
      if (previous === undefined || doneCount(jobs) !== doneCount(previous)) {
        void queryClient.invalidateQueries({ queryKey: BOOKS_KEY });
      }
      return jobs;
    },
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 2000 : false),
  });
}

export function useCreateJob() {
  const credentials = useCredentials();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (urls: string[]) => api.createJob(credentials, urls),
    onSuccess: (job) => {
      queryClient.setQueryData<Job[]>(JOBS_KEY, (jobs = []) => [job, ...jobs.filter((existing) => existing.id !== job.id)]);
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useRetryItem() {
  const credentials = useCredentials();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, itemId }: { jobId: string; itemId: string }) => api.retryItem(credentials, jobId, itemId),
    onSuccess: (job) => {
      queryClient.setQueryData<Job[]>(JOBS_KEY, (jobs = []) => jobs.map((existing) => (existing.id === job.id ? job : existing)));
      void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useBooks() {
  const credentials = useCredentials();
  return useQuery({
    queryKey: BOOKS_KEY,
    queryFn: async ({ signal }) => (await api.listBooks(credentials, signal)).books,
  });
}
