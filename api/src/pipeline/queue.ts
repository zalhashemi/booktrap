/**
 * In-process job queue. Items run `concurrency` at a time overall, but one at a time per device,
 * so two links from the same reader never race to insert the same book.
 * State lives in the database; on boot, unfinished items are re-enqueued (free hosting sleeps).
 */
export class JobQueue {
  private readonly pending: { itemId: string; deviceId: string }[] = [];
  private readonly queued = new Set<string>();
  private readonly activeItems = new Set<string>();
  /** Items re-enqueued while still running (e.g. Retry pressed the instant they failed). */
  private readonly rerun = new Map<string, string>();
  private readonly busyDevices = new Set<string>();
  private running = 0;
  private idleResolvers: (() => void)[] = [];

  constructor(
    private readonly run: (itemId: string) => Promise<void>,
    private readonly concurrency = 2,
  ) {}

  enqueue(itemId: string, deviceId: string): void {
    if (this.activeItems.has(itemId)) {
      this.rerun.set(itemId, deviceId);
      return;
    }
    if (this.queued.has(itemId)) return;
    this.queued.add(itemId);
    this.pending.push({ itemId, deviceId });
    this.pump();
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
      const index = this.pending.findIndex((entry) => !this.busyDevices.has(entry.deviceId));
      if (index === -1) break;
      const [next] = this.pending.splice(index, 1);
      this.start(next!);
    }
    if (this.running === 0 && this.pending.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve();
    }
  }

  private start(entry: { itemId: string; deviceId: string }): void {
    this.running++;
    this.activeItems.add(entry.itemId);
    this.busyDevices.add(entry.deviceId);
    void this.run(entry.itemId)
      .catch(() => {
        // processItem records its own failures; this only guards the queue itself.
      })
      .finally(() => {
        this.running--;
        this.activeItems.delete(entry.itemId);
        this.busyDevices.delete(entry.deviceId);
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
