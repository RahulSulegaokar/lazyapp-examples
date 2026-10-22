import type { KeyValueStore } from '@lazyapp-examples/demo-kit';

export interface GuardDecision {
  readonly allowed: boolean;
  /** When refused: how long until the oldest hit leaves the window. */
  readonly retryAfterSeconds: number;
}

/** A named limit: at most `limit` hits per `windowMs`. */
export interface Limit {
  readonly limit: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The demo's own abuse limits, applied before LazyApp is called. LazyApp enforces its own
 * (30s resend cool-off, 20 codes per number per day, 10 numbers per IP per hour, attempt
 * lock-out); these are tighter because the demo number is shared and every code costs money.
 */
export const LIMITS = {
  /** Codes one number can receive from the demo per hour (chat + web together). */
  codesPerNumber: { limit: 5, windowMs: HOUR },
  /** Codes one IP can request per hour, whatever the number. */
  codesPerIp: { limit: 10, windowMs: HOUR },
  /** Distinct numbers one IP can target per hour: stops enumeration and SMS-pumping-style abuse. */
  numbersPerIp: { limit: 3, windowMs: HOUR },
  /** Sign-in attempts (number look-ups) per IP per 10 minutes. */
  lookupsPerIp: { limit: 20, windowMs: 10 * MINUTE },
  /** Wrong codes per number per hour before verification pauses. */
  wrongCodesPerNumber: { limit: 5, windowMs: HOUR },
} as const satisfies Record<string, Limit>;

/** Minimum gap between two codes to the same number (LazyApp's own resend delay is the same). */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Sliding-window counters on the example's key-value store. Each check-and-record is synchronous
 * (SQLite), so two requests in the same process cannot both slip under a limit.
 */
export class RateGuard {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  /** Records a hit for `key` if it is under `limit`; otherwise refuses without recording. */
  hit(key: string, limit: Limit): GuardDecision {
    const decision = this.check(key, limit);
    if (decision.allowed) {
      this.kv.set(`rate:${key}`, [...this.recent(key, limit), this.now().getTime()]);
    }
    return decision;
  }

  /** Whether one more hit would be allowed, without recording it. */
  check(key: string, limit: Limit): GuardDecision {
    const hits = this.recent(key, limit);
    if (hits.length < limit.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const oldest = hits[hits.length - limit.limit] ?? this.now().getTime();
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + limit.windowMs - this.now().getTime()) / 1000)),
    };
  }

  /**
   * Counts distinct `member`s seen under `key` in the window (e.g. numbers per IP). A member already
   * seen is always allowed; a new one only while under the limit.
   */
  hitDistinct(key: string, member: string, limit: Limit): GuardDecision {
    const cutoff = this.now().getTime() - limit.windowMs;
    const seen = this.kv.get<Record<string, number>>(`distinct:${key}`) ?? {};
    const live = Object.fromEntries(Object.entries(seen).filter(([, at]) => at > cutoff));
    if (!(member in live) && Object.keys(live).length >= limit.limit) {
      const oldest = Math.min(...Object.values(live));
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + limit.windowMs - this.now().getTime()) / 1000)),
      };
    }
    this.kv.set(`distinct:${key}`, { ...live, [member]: this.now().getTime() });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private recent(key: string, limit: Limit): number[] {
    const cutoff = this.now().getTime() - limit.windowMs;
    return (this.kv.get<number[]>(`rate:${key}`) ?? []).filter((at) => at > cutoff);
  }
}
