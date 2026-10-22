/**
 * In-process work queue that runs jobs for the same key strictly in order
 * (one user's messages never race each other) and different keys in parallel,
 * up to `concurrency`. `drain()` waits for everything queued so far.
 */
export class KeyedQueue {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;
  private pending = 0;
  private closed = false;

  constructor(
    private readonly concurrency = 16,
    private readonly onError: (error: unknown, key: string) => void = () => undefined,
  ) {}

  /** Jobs queued or running. */
  get size(): number {
    return this.pending;
  }

  push(key: string, job: () => Promise<void>): boolean {
    if (this.closed) {
      return false;
    }
    this.pending++;
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => this.withSlot(job))
      .catch((error: unknown) => {
        this.onError(error, key);
      })
      .finally(() => {
        this.pending--;
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
        }
      });
    this.chains.set(key, next);
    return true;
  }

  /** Queues `job` behind the key's earlier work and resolves with its result. */
  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const accepted = this.push(key, async () => {
        try {
          resolve(await job());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      if (!accepted) {
        reject(new Error('Queue is closed'));
      }
    });
  }

  /** Stops accepting jobs and resolves when queued work finishes, or after `timeoutMs`. */
  async close(timeoutMs = 10_000): Promise<boolean> {
    this.closed = true;
    return this.drain(timeoutMs);
  }

  async drain(timeoutMs = 10_000): Promise<boolean> {
    const all = (async () => {
      while (this.chains.size > 0) {
        await Promise.allSettled([...this.chains.values()]);
      }
      return true;
    })();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    });
    try {
      return await Promise.race([all, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async withSlot(job: () => Promise<void>): Promise<void> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      await job();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
