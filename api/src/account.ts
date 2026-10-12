import type { Revocations } from './auth/revocations';
import type { ExportJobs } from './export-jobs';
import type { JobQueue } from './pipeline/queue';
import { isSameBook } from './pipeline/normalize';
import type { LibraryStore } from './store/types';
import type { UserDirectory } from './users/types';

export interface AccountDeps {
  store: LibraryStore;
  users: UserDirectory;
  queue: JobQueue;
  /** Refuses a deleted user's still-valid tokens. */
  revocations?: Revocations;
  /** "Download my data" files waiting for the user. */
  exports?: ExportJobs;
}

/** How long a merge waits for a link the guest pasted to finish reading. */
const HAND_OVER_WAIT_MS = 45_000;

/** The guest still has a link being read; merging now would leave that post's books behind. */
export class GuestBusyError extends Error {
  constructor() {
    super('The guest shelf is still reading a link');
    this.name = 'GuestBusyError';
  }
}

/** An unclaimed guest shelf is deleted after this long without a visit (privacy policy). */
export const GUEST_IDLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Delete account": everything the user owns, then the user. Their networks' recent posts keep counting
 * against those networks' caps. Running it again after a partial failure finishes the job.
 */
export async function deleteAccount(userId: string, { store, users, queue, revocations, exports }: AccountDeps): Promise<void> {
  queue.forgetUser(userId);
  exports?.forgetUser(userId);
  await store.eraseUser(userId);
  await users.remove(userId);
  revocations?.revoke(userId);
}

/**
 * A guest logged in to an account they already had: the guest's books join the account's shelf, so
 * nothing is lost. A book the account already has gains the guest's sources and shelves instead of a
 * second entry (the same rule as pasting a post again). Then the guest user is deleted.
 *
 * Links the guest is still reading finish first, and waiting ones move to the account, so no book is
 * written under the guest afterwards. Books move one at a time, each folded as it arrives, so a retry
 * after a failure carries on where it stopped. Returns how many books were added and how many folded.
 *
 * The book limit is deliberately not applied here: a guest holds at most 500 books, and "never lose a
 * book" outranks a storage limit. An account past its limit can't add more until it makes room.
 */
export async function mergeGuestShelf(guestId: string, userId: string, deps: AccountDeps): Promise<{ added: number; folded: number }> {
  const { store, users, queue } = deps;
  if (!(await queue.handOver(guestId, userId, HAND_OVER_WAIT_MS))) throw new GuestBusyError();
  await store.transferShelf(guestId, userId);

  const existing = await store.dedupCandidates(userId);
  let added = 0;
  let folded = 0;
  for (const book of await store.listBooks(guestId)) {
    await store.moveBooks(guestId, userId, [book.id]);
    const match = existing.find((shelved) => isSameBook(shelved, book));
    if (match) {
      await store.mergeBooks(userId, match.id, [book.id]);
      folded++;
    } else added++;
  }
  // What's left is the guest's Undo bin: it comes along as it is.
  await store.moveBooks(guestId, userId, 'all');
  await users.remove(guestId);
  deps.revocations?.revoke(guestId);
  return { added, folded };
}

/** Deletes guests nobody has visited for GUEST_IDLE_DAYS, a batch at a time. Returns how many. */
export async function purgeIdleGuests(deps: AccountDeps, now = new Date(), batch = 100): Promise<number> {
  const idle = await deps.users.inactiveGuests(new Date(now.getTime() - GUEST_IDLE_DAYS * DAY_MS), batch);
  for (const userId of idle) await deleteAccount(userId, deps);
  return idle.length;
}
