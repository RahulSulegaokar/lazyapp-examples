import type { KeyValueStore } from '@lazyapp-examples/demo-kit';

/** At most `limit` hits per `windowMs`. */
export interface Limit {
  readonly limit: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;

/**
 * The admin demo's abuse limits. Every write reaches LazyApp with the demo's key, and the page is
 * public, so they are per IP and also global.
 */
export const LIMITS = {
  /** Page data and usage reads per IP. */
  readsPerIp: { limit: 120, windowMs: 10 * MINUTE },
  /** Creates, setup links, packs and simulations per IP. */
  writesPerIp: { limit: 20, windowMs: 10 * MINUTE },
  /** Embed tokens per IP (one per component view). */
  embedsPerIp: { limit: 30, windowMs: 10 * MINUTE },
  /** Every write from every visitor, so a botnet cannot spend the key's rate limit. */
  writesGlobal: { limit: 300, windowMs: 60 * MINUTE },
} as const satisfies Record<string, Limit>;

export interface GuardDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/** Sliding-window counters on the example's key-value store (synchronous, so no races in-process). */
export class RateGuard {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  /** Records a hit when every limit has room; otherwise records nothing and refuses. */
  hit(checks: readonly (readonly [key: string, limit: Limit])[]): GuardDecision {
    const now = this.now().getTime();
    const windows = checks.map(([key, limit]) => {
      const hits = (this.kv.get<number[]>(`rate:${key}`) ?? []).filter((at) => at > now - limit.windowMs);
      return { key, limit, hits };
    });
    const full = windows.find((window) => window.hits.length >= window.limit.limit);
    if (full !== undefined) {
      const oldest = full.hits[full.hits.length - full.limit.limit] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + full.limit.windowMs - now) / 1000)),
      };
    }
    for (const window of windows) {
      this.kv.set(`rate:${window.key}`, [...window.hits, now]);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
