/**
 * In-process job queue. Items run `concurrency` at a time overall, but one at a time per user,
 * so two links from the same reader never race to insert the same book.
 * Readers take turns (Phase 9): the next item comes from the reader who started one longest ago, so
 * someone who pasted 30 links doesn't hold a slot while others wait.
 * State lives in the database; on boot, unfinished items are re-enqueued (free hosting sleeps).
 */

/** How long an item takes until enough have been timed to know (a video, read for real, is about 40s). */
const DEFAULT_ITEM_SECONDS = 40;
/** Item times averaged for the estimate. */
const TIMED_ITEMS = 20;

export interface QueueEstimate {
  /** Items that start before this one (those running included). */
  ahead: number;
  /** About how long until it starts. */
  etaSeconds: number;
}
export class JobQueue {
  private readonly pending: { itemId: string; userId: string }[] = [];
  private readonly queued = new Set<string>();
  private readonly activeItems = new Set<string>();
  /** Items re-enqueued while still running (e.g. Retry pressed the instant they failed). */
  private readonly rerun = new Map<string, string>();
  private readonly busyUsers = new Set<string>();
  private running = 0;
  private idleResolvers: (() => void)[] = [];
  /** When each user last had an item start (a counter, not a clock): lower goes first. */
  private readonly lastStart = new Map<string, number>();
  private starts = 0;
  private readonly durations: number[] = [];
  private readonly startedAt = new Map<string, number>();

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

  /**
   * Where each waiting item stands: readers take turns, so item k of a reader runs in round k, and
   * within a round readers go in the order they last started something. Rough by design: it ignores
   * that a busy reader's next item waits for their current one.
   */
  estimates(): Map<string, QueueEstimate> {
    const byUser = new Map<string, string[]>();
    for (const entry of this.pending) {
      if (!byUser.has(entry.userId)) byUser.set(entry.userId, []);
      byUser.get(entry.userId)!.push(entry.itemId);
    }
    const users = [...byUser.keys()].sort((a, b) => (this.lastStart.get(a) ?? -1) - (this.lastStart.get(b) ?? -1));
    const order: string[] = [];
    for (let round = 0; order.length < this.pending.length; round++) {
      for (const user of users) {
        const item = byUser.get(user)![round];
        if (item) order.push(item);
      }
    }
    const seconds = this.durations.length ? this.durations.reduce((sum, value) => sum + value, 0) / this.durations.length : DEFAULT_ITEM_SECONDS;
    const result = new Map<string, QueueEstimate>();
    order.forEach((itemId, index) => {
      const ahead = this.running + index;
      // Items start in waves of `concurrency`; the running wave is about half done.
      const waves = Math.floor(ahead / this.concurrency);
      result.set(itemId, { ahead, etaSeconds: Math.max(0, Math.round(waves * seconds - (this.running ? seconds / 2 : 0))) });
    });
    return result;
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      // The waiting item whose reader started something longest ago (never yet: first), oldest first among equals.
      let index = -1;
      for (let i = 0; i < this.pending.length; i++) {
        const entry = this.pending[i]!;
        if (this.busyUsers.has(entry.userId)) continue;
        if (index === -1 || (this.lastStart.get(entry.userId) ?? -1) < (this.lastStart.get(this.pending[index]!.userId) ?? -1)) index = i;
      }
      if (index === -1) break;
      const [next] = this.pending.splice(index, 1);
      this.start(next!);
    }
    if (this.running === 0 && this.pending.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve();
    }
  }

  private start(entry: { itemId: string; userId: string }): void {
    this.lastStart.set(entry.userId, this.starts++);
    // Only readers with something waiting or running need a turn order: forget the rest now and then.
    if (this.lastStart.size > 10_000) {
      const live = new Set([...this.pending.map((waiting) => waiting.userId), ...this.busyUsers, entry.userId]);
      for (const user of this.lastStart.keys()) if (!live.has(user)) this.lastStart.delete(user);
    }
    this.startedAt.set(entry.itemId, Date.now());
    this.running++;
    this.activeItems.add(entry.itemId);
    this.busyUsers.add(entry.userId);
    void this.run(entry.itemId)
      .catch(() => {
        // processItem records its own failures; this only guards the queue itself.
      })
      .finally(() => {
        const began = this.startedAt.get(entry.itemId);
        this.startedAt.delete(entry.itemId);
        if (began !== undefined) {
          this.durations.push((Date.now() - began) / 1000);
          if (this.durations.length > TIMED_ITEMS) this.durations.shift();
        }
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
