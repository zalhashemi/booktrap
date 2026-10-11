import type { JobQueue } from './pipeline/queue';
import { isSameBook } from './pipeline/normalize';
import type { LibraryStore } from './store/types';
import type { UserDirectory } from './users/types';

export interface AccountDeps {
  store: LibraryStore;
  users: UserDirectory;
  queue: JobQueue;
}

/** An unclaimed guest shelf is deleted after this long without a visit (privacy policy). */
export const GUEST_IDLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Delete account": everything the user owns, then the user. Their networks' recent posts keep counting
 * against those networks' caps. Running it again after a partial failure finishes the job.
 */
export async function deleteAccount(userId: string, { store, users, queue }: AccountDeps): Promise<void> {
  queue.forgetUser(userId);
  await store.eraseUser(userId);
  await users.remove(userId);
}

/**
 * A guest logged in to an account they already had: the guest's books join the account's shelf, so
 * nothing is lost. A book the account already has gains the guest's sources and shelves instead of a
 * second entry (the same rule as pasting a post again). Then the guest user is deleted.
 * Returns how many books were added and how many were folded into books already there.
 */
export async function mergeGuestShelf(guestId: string, userId: string, { store, users }: AccountDeps): Promise<{ added: number; folded: number }> {
  const [incoming, existing] = await Promise.all([store.listBooks(guestId), store.dedupCandidates(userId)]);
  await store.transferShelf(guestId, userId);

  let folded = 0;
  for (const book of incoming) {
    const match = existing.find((shelved) => isSameBook(shelved, book));
    if (!match) continue;
    await store.mergeBooks(userId, match.id, [book.id]);
    folded++;
  }
  await users.remove(guestId);
  return { added: incoming.length - folded, folded };
}

/** Deletes guests nobody has visited for GUEST_IDLE_DAYS, a batch at a time. Returns how many. */
export async function purgeIdleGuests(deps: AccountDeps, now = new Date(), batch = 100): Promise<number> {
  const idle = await deps.users.inactiveGuests(new Date(now.getTime() - GUEST_IDLE_DAYS * DAY_MS), batch);
  for (const userId of idle) await deleteAccount(userId, deps);
  return idle.length;
}
