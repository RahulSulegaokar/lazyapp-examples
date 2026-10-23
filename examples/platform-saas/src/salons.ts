import type { KeyValueStore } from '@lazyapp-examples/demo-kit';

/**
 * SalonBook's tenants. The demo only ever creates these three, so no visitor can put real
 * business or personal data into LazyApp through it.
 */
export interface SeedSalon {
  readonly slug: string;
  readonly name: string;
  readonly area: string;
  readonly stylists: number;
}

export const SEED_SALONS: readonly SeedSalon[] = [
  { slug: 'glow-studio', name: 'Glow Studio', area: 'Indiranagar, Bengaluru', stylists: 6 },
  { slug: 'mane-street', name: 'Mane Street', area: 'Bandra West, Mumbai', stylists: 9 },
  { slug: 'trim-room', name: 'The Trim Room', area: 'Koramangala, Bengaluru', stylists: 4 },
];

export function findSalon(slug: string): SeedSalon | undefined {
  return SEED_SALONS.find((salon) => salon.slug === slug);
}

/**
 * Calendar day in India, the demo's reset boundary (`2026-10-23`). Customers are created with a
 * day-stamped `external_id`, so yesterday's salons can never be confused with today's.
 */
export function demoDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** SalonBook's own account id for a salon, sent to LazyApp as `external_id`. */
export function externalIdFor(salon: SeedSalon, day: string): string {
  return `salonbook-demo-${salon.slug}-${day.replace(/-/g, '')}`;
}

export type ConnectionState = 'not_connected' | 'link_sent' | 'connected' | 'failed' | 'attention';

export interface ActivityEntry {
  readonly at: string;
  readonly type: string;
  /** `webhook`: a signed LazyApp delivery. `simulated`: the demo's "simulate" button. */
  readonly source: 'webhook' | 'simulated';
  readonly summary: string;
}

export interface UsageSummary {
  readonly period: string;
  readonly messages: number;
  readonly totalCharge: string;
  readonly currency: string;
  readonly billingMode: string | null;
  readonly walletBalanceCents: number | null;
  readonly spendingLimitCents: number | null;
  readonly byCategory: readonly { readonly category: string; readonly messages: number }[];
}

/** What SalonBook's database holds about one salon's WhatsApp. Never a setup-link or embed token. */
export interface SalonRecord {
  readonly slug: string;
  readonly externalId: string;
  /** LazyApp customer (`cus_…`), once created. */
  readonly customerId: string | null;
  readonly connection: ConnectionState;
  readonly connectedNumber: string | null;
  readonly failureReason: string | null;
  /** Only the id and expiry: the URL is a secret handed to the salon, not stored. */
  readonly setupLink: { readonly id: string; readonly expiresAt: string | null } | null;
  readonly usageAlert: { readonly at: string; readonly detail: string } | null;
  readonly usage: { readonly fetchedAt: string; readonly summary: UsageSummary } | null;
  readonly pack: { readonly at: string; readonly summary: string } | null;
  readonly activity: readonly ActivityEntry[];
}

const ACTIVITY_LIMIT = 15;

/**
 * SalonBook's tenant table, on the example's key-value store. Everything is keyed by the demo day;
 * `beginDay` wipes yesterday's rows and returns them so the caller can remove their customers.
 */
export class SalonStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  get today(): string {
    return demoDay(this.now());
  }

  /**
   * Starts today's demo if the stored day is older. Returns the previous day's records that had a
   * LazyApp customer (empty when nothing changed). Synchronous, so two requests cannot both reset.
   */
  beginDay(): SalonRecord[] {
    const today = this.today;
    if (this.kv.get<string>('day') === today) {
      return [];
    }
    const previous = this.kv.list<SalonRecord>('salon:').map((entry) => entry.value);
    for (const prefix of ['salon:', 'evt:', 'quota:']) {
      for (const entry of this.kv.list(prefix)) {
        this.kv.delete(entry.key);
      }
    }
    this.kv.set('day', today);
    return previous.filter((record) => record.customerId !== null);
  }

  get(salon: SeedSalon): SalonRecord {
    return (
      this.kv.get<SalonRecord>(`salon:${salon.slug}`) ?? {
        slug: salon.slug,
        externalId: externalIdFor(salon, this.today),
        customerId: null,
        connection: 'not_connected',
        connectedNumber: null,
        failureReason: null,
        setupLink: null,
        usageAlert: null,
        usage: null,
        pack: null,
        activity: [],
      }
    );
  }

  update(salon: SeedSalon, change: (record: SalonRecord) => SalonRecord): SalonRecord {
    const next = change(this.get(salon));
    this.kv.set(`salon:${salon.slug}`, next);
    return next;
  }

  /** The salon a platform delivery is about, by our `external_id` or LazyApp's customer id. */
  byCustomer(customer: { readonly id: string; readonly external_id: string | null }): SeedSalon | undefined {
    return SEED_SALONS.find((salon) => {
      const record = this.kv.get<SalonRecord>(`salon:${salon.slug}`);
      return (
        record !== undefined &&
        ((customer.external_id !== null && record.externalId === customer.external_id) ||
          record.customerId === customer.id)
      );
    });
  }

  addActivity(salon: SeedSalon, entry: ActivityEntry): SalonRecord {
    return this.update(salon, (record) => ({
      ...record,
      activity: [entry, ...record.activity].slice(0, ACTIVITY_LIMIT),
    }));
  }

  /** Records a webhook event id; false when it was already applied (LazyApp delivers at least once). */
  markEvent(id: string): boolean {
    if (this.kv.get(`evt:${id}`) !== undefined) {
      return false;
    }
    this.kv.set(`evt:${id}`, this.now().toISOString());
    return true;
  }

  /** Counts a per-day action (e.g. setup links for one salon); false once `limit` is reached. */
  takeQuota(key: string, limit: number): boolean {
    const used = this.kv.get<number>(`quota:${key}`) ?? 0;
    if (used >= limit) {
      return false;
    }
    this.kv.set(`quota:${key}`, used + 1);
    return true;
  }
}
