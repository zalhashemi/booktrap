/**
 * In-process job queue. Items run `concurrency` at a time overall, but one at a time per user,
 * so two links from the same reader never race to insert the same book.
 * State lives in the database; on boot, unfinished items are re-enqueued (free hosting sleeps).
 */
export class JobQueue {
  private readonly pending: { itemId: string; userId: string }[] = [];
  private readonly queued = new Set<string>();
  private readonly activeItems = new Set<string>();
  /** Items re-enqueued while still running (e.g. Retry pressed the instant they failed). */
  private readonly rerun = new Map<string, string>();
  private readonly busyUsers = new Set<string>();
  private running = 0;
  private idleResolvers: (() => void)[] = [];

  constructor(
    private readonly run: (itemId: string) => Promise<void>,
    private readonly concurrency = 2,
  ) {}

  enqueue(itemId: string, userId: string): void {
    if (this.activeItems.has(itemId)) {
      this.rerun.set(itemId, userId);
      return;
    }
    if (this.queued.has(itemId)) return;
    this.queued.add(itemId);
    this.pending.push({ itemId, userId });
    this.pump();
  }

  /** Drops a user's waiting items (their account was deleted). One already running finishes on its own. */
  forgetUser(userId: string): void {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const entry = this.pending[index]!;
      if (entry.userId !== userId) continue;
      this.pending.splice(index, 1);
      this.queued.delete(entry.itemId);
    }
    for (const [itemId, owner] of this.rerun) if (owner === userId) this.rerun.delete(itemId);
  }

  /**
   * A guest's shelf is joining an account: their waiting items now belong to the account (so they run
   * one at a time with the account's own), and this resolves once the guest has nothing running, so no
   * book is still being written under the guest. False if something is still running after `timeoutMs`.
   */
  async handOver(fromUserId: string, toUserId: string, timeoutMs: number): Promise<boolean> {
    for (const entry of this.pending) if (entry.userId === fromUserId) entry.userId = toUserId;
    for (const [itemId, owner] of this.rerun) if (owner === fromUserId) this.rerun.set(itemId, toUserId);
    const deadline = Date.now() + timeoutMs;
    while (this.busyUsers.has(fromUserId)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
  }

  /** Resolves when nothing is pending or running (tests and graceful shutdown). */
  idle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  /** Stop starting new items (shutdown); queued ones stay in the database and resume on boot. */
  drain(): Promise<void> {
    this.pending.length = 0;
    return this.idle();
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const index = this.pending.findIndex((entry) => !this.busyUsers.has(entry.userId));
      if (index === -1) break;
      const [next] = this.pending.splice(index, 1);
      this.start(next!);
    }
    if (this.running === 0 && this.pending.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve();
    }
  }

  private start(entry: { itemId: string; userId: string }): void {
    this.running++;
    this.activeItems.add(entry.itemId);
    this.busyUsers.add(entry.userId);
    void this.run(entry.itemId)
      .catch(() => {
        // processItem records its own failures; this only guards the queue itself.
      })
      .finally(() => {
        this.running--;
        this.activeItems.delete(entry.itemId);
        this.busyUsers.delete(entry.userId);
        this.queued.delete(entry.itemId);
        const again = this.rerun.get(entry.itemId);
        if (again) {
          this.rerun.delete(entry.itemId);
          this.enqueue(entry.itemId, again);
        }
        this.pump();
      });
  }
}
