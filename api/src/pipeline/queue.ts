/**
 * In-process job queue. Items run `concurrency` at a time overall, but one at a time per user,
 * so two links from the same reader never race to insert the same book.
 * Readers take turns (Phase 9): the next item comes from the reader whose turn came longest ago (a
 * newcomer joins the current round), so someone who pasted 30 links doesn't hold a slot while others
 * wait, and a steady stream of newcomers can't starve them either.
 * State lives in the database; on boot, unfinished items are re-enqueued (free hosting sleeps).
 */

/** How long an item takes until enough have been timed to know (a video, read for real, is about 40s). */
const DEFAULT_ITEM_SECONDS = 40;
/** Item times averaged for the estimate. */
const TIMED_ITEMS = 20;
/** Items that finish faster than this did no real reading (a cached post, an instant failure): not timed. */
const MIN_TIMED_SECONDS = 3;

export interface QueueEstimate {
  /** Other readers' items that start before this one (running ones included). Your own earlier links aren't counted: waiting on them isn't the queue being busy. */
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
  /** Estimates are computed once per change to the queue, not on every poll. */
  private cached: Map<string, QueueEstimate> | null = null;
  /** Who each running item belongs to. */
  private readonly runningOwner = new Map<string, string>();

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
    this.cached = null;
    if (!this.lastStart.has(userId)) this.lastStart.set(userId, this.newcomerTurn());
    this.pending.push({ itemId, userId });
    this.pump();
  }

  /** Drops a user's waiting items (their account was deleted). One already running finishes on its own. */
  forgetUser(userId: string): void {
    this.cached = null;
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
    this.cached = null;
    if (!this.lastStart.has(toUserId)) this.lastStart.set(toUserId, this.lastStart.get(fromUserId) ?? this.newcomerTurn());
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
   * A newcomer joins the current round: as if their last turn came one round of slots ago. So they go
   * ahead of a reader who has just had a turn, but newcomers arriving later can't keep jumping a long
   * paste forever (their place moves back as turns are taken).
   */
  private newcomerTurn(): number {
    return this.starts - this.concurrency - 0.5;
  }

  /**
   * Where each waiting item stands: readers take turns, so item k of a reader runs in round k, and
   * within a round readers go in turn order. `ahead` counts other readers' items only (a reader's own
   * earlier link isn't the queue being busy). Rough by design.
   */
  estimates(): Map<string, QueueEstimate> {
    if (this.cached) return this.cached;
    const byUser = new Map<string, string[]>();
    for (const entry of this.pending) {
      if (!byUser.has(entry.userId)) byUser.set(entry.userId, []);
      byUser.get(entry.userId)!.push(entry.itemId);
    }
    const users = [...byUser.keys()].sort((a, b) => (this.lastStart.get(a) ?? 0) - (this.lastStart.get(b) ?? 0));
    const order: { itemId: string; userId: string }[] = [];
    for (let round = 0; order.length < this.pending.length; round++) {
      for (const user of users) {
        const item = byUser.get(user)![round];
        if (item) order.push({ itemId: item, userId: user });
      }
    }
    const seconds = this.durations.length ? this.durations.reduce((sum, value) => sum + value, 0) / this.durations.length : DEFAULT_ITEM_SECONDS;
    const runningOwners = [...this.runningOwner.values()];
    const result = new Map<string, QueueEstimate>();
    order.forEach(({ itemId, userId }, index) => {
      const ahead = runningOwners.filter((owner) => owner !== userId).length + order.slice(0, index).filter((entry) => entry.userId !== userId).length;
      // Items start in waves of `concurrency`; a running wave is about half done.
      const waves = Math.floor(ahead / this.concurrency);
      result.set(itemId, { ahead, etaSeconds: Math.max(0, Math.round(waves * seconds - (this.running ? seconds / 2 : 0))) });
    });
    this.cached = result;
    return result;
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      // The waiting item whose reader's turn came longest ago, oldest first among equals.
      let index = -1;
      for (let i = 0; i < this.pending.length; i++) {
        const entry = this.pending[i]!;
        if (this.busyUsers.has(entry.userId)) continue;
        if (index === -1 || (this.lastStart.get(entry.userId) ?? 0) < (this.lastStart.get(this.pending[index]!.userId) ?? 0)) index = i;
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
    this.cached = null;
    this.runningOwner.set(entry.itemId, entry.userId);
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
        const took = began === undefined ? 0 : (Date.now() - began) / 1000;
        if (took >= MIN_TIMED_SECONDS) {
          this.durations.push(took);
          if (this.durations.length > TIMED_ITEMS) this.durations.shift();
        }
        this.runningOwner.delete(entry.itemId);
        this.cached = null;
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
