import { LazyAppNotFoundError } from '@lazyapp-examples/sdk';
import type {
  AutomationPackResult,
  EmbedComponent,
  LazyAppClient,
  PlatformCustomerUsage,
} from '@lazyapp-examples/sdk';
import type { Logger } from '@lazyapp-examples/demo-kit';
import { renderSVG } from 'uqr';
import type { SalonRecord, SalonStore, SeedSalon, UsageSummary } from './salons.js';

/** Components SalonBook embeds. `connection` and `messages` exist too; three keep the page focused. */
export const EMBEDDED_COMPONENTS = [
  'inbox',
  'templates',
  'usage',
] as const satisfies readonly EmbedComponent[];
export type EmbeddedComponent = (typeof EMBEDDED_COMPONENTS)[number];

/** Embed tokens live 10 minutes (LazyApp's minimum is 5): minted per page view, never stored. */
export const EMBED_TTL_MINUTES = 10;
/** Usage is cached this long, so a busy dashboard does not spend the per-key rate limit. */
export const USAGE_TTL_MS = 60_000;
/** Setup links per salon per day: each one is a live Embedded Signup entry point. */
export const SETUP_LINKS_PER_DAY = 5;

export class SalonBookError extends Error {
  constructor(
    readonly status: 404 | 409 | 422 | 429 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SalonBookError';
  }
}

export interface IssuedSetupLink {
  readonly id: string;
  /** The one-time URL to hand to the salon. Returned to the admin page once; never logged or stored. */
  readonly url: string;
  readonly expiresAt: string | null;
  /** The same URL as a QR code (SVG), for opening on a phone. */
  readonly qrSvg: string;
}

export interface IssuedEmbed {
  readonly id: string;
  readonly component: EmbeddedComponent;
  readonly url: string;
  readonly expiresAt: string | null;
}

/**
 * SalonBook's server side of the LazyApp Platform API. The browser calls SalonBook; only this
 * class holds the API key. Secrets LazyApp returns (setup-link and embed URLs) are passed through
 * to the page and never written to logs or storage.
 */
export class SalonBook {
  constructor(
    private readonly api: LazyAppClient,
    private readonly store: SalonStore,
    private readonly options: {
      readonly log: Logger;
      readonly now: () => Date;
      /** SalonBook's own origin: the only one allowed to frame embedded components. */
      readonly appOrigin: string;
      /** LazyApp's origin: embeds must come from here (the page's CSP only allows this frame source). */
      readonly lazyappOrigin: string;
      /** Where the salon lands after Embedded Signup (UX only: `customer.connected` is the truth). */
      readonly redirectUrl: string;
      readonly automationPack: string;
    },
  ) {}

  /**
   * Starts a new demo day: yesterday's salons and their LazyApp workspaces are removed. They are
   * seed salons in test mode; for real customers prefer `archive`, which is reversible.
   */
  async resetIfNewDay(): Promise<number> {
    const stale = this.store.beginDay();
    for (const record of stale) {
      try {
        await this.api.platform.customers.delete(record.customerId ?? '');
      } catch (error) {
        if (!(error instanceof LazyAppNotFoundError)) {
          this.options.log.warn('could not remove a previous day salon', {
            customer: record.customerId,
            error,
          });
        }
      }
    }
    if (stale.length > 0) {
      this.options.log.info('demo day reset', { removed: stale.length });
    }
    return stale.length;
  }

  /** `POST /v1/platform/customers`, once per salon per day. Safe to repeat. */
  async ensureCustomer(salon: SeedSalon): Promise<SalonRecord> {
    const current = this.store.get(salon);
    if (current.customerId !== null) {
      return current;
    }
    // A previous attempt may have created it and crashed before saving: look it up by our own id.
    const existing = await this.api.platform.customers.findByExternalId(current.externalId);
    const customer =
      existing ??
      (await this.api.platform.customers.create(
        {
          name: salon.name,
          external_id: current.externalId,
          billing_mode: 'inherit',
          // ₹50: LazyApp sends customer.usage_alert when this salon's spend crosses it.
          usage_alert_cents: 5_000,
          metadata: { app: 'salonbook-demo', area: salon.area, stylists: salon.stylists },
        },
        { idempotencyKey: `salonbook:customer:${current.externalId}` },
      ));
    this.options.log.info('salon created in LazyApp', { salon: salon.slug, customer: customer.id });
    return this.store.update(salon, (record) => ({
      ...record,
      customerId: customer.id,
      ...(customer.connections !== undefined && customer.connections.length > 0
        ? {
            connection: 'connected' as const,
            connectedNumber: customer.connections[0]?.display_phone_number ?? null,
          }
        : {}),
    }));
  }

  /** `POST /v1/platform/setup-links`: a one-time Embedded Signup URL for the salon owner. */
  async createSetupLink(salon: SeedSalon): Promise<IssuedSetupLink> {
    const record = this.requireCustomer(salon);
    if (!this.store.takeQuota(`setup:${salon.slug}`, SETUP_LINKS_PER_DAY)) {
      throw new SalonBookError(
        429,
        'setup_link_quota',
        `${salon.name} already has ${SETUP_LINKS_PER_DAY} setup links today.`,
      );
    }
    const link = await this.api.platform.setupLinks.create({
      customer_id: record.customerId,
      expires_in_days: 1,
      use_policy: 'single',
      allowed_connection_type: 'new',
      redirect_url: this.options.redirectUrl,
      locale: 'en',
    });
    if (link.url === undefined || link.url === '') {
      throw new SalonBookError(502, 'setup_link_without_url', 'LazyApp did not return a setup URL.');
    }
    // The id is safe to log; the URL and token are not.
    this.options.log.info('setup link created', { salon: salon.slug, setupLink: link.id });
    this.store.update(salon, (current) => ({
      ...current,
      setupLink: { id: link.id, expiresAt: link.expires_at },
      connection: current.connection === 'connected' ? 'connected' : 'link_sent',
      failureReason: null,
    }));
    return {
      id: link.id,
      url: link.url,
      expiresAt: link.expires_at,
      qrSvg: renderSVG(link.url, { ecc: 'M', border: 2 }),
    };
  }

  /** `POST /v1/platform/embed-tokens`: one component, one salon, SalonBook's origin, 10 minutes. */
  async mintEmbed(salon: SeedSalon, component: EmbeddedComponent): Promise<IssuedEmbed> {
    const record = this.requireCustomer(salon);
    const token = await this.api.platform.embedTokens.create({
      customer_id: record.customerId,
      component,
      expires_in_minutes: EMBED_TTL_MINUTES,
      origin_allowlist: [this.options.appOrigin],
      locale: 'en',
    });
    if (originOf(token.url) !== this.options.lazyappOrigin) {
      // The page may only frame LazyApp; anything else is refused rather than rendered.
      throw new SalonBookError(
        502,
        'unexpected_embed_origin',
        'LazyApp returned an embed URL on another origin.',
      );
    }
    this.options.log.info('embed token minted', { salon: salon.slug, component, embedToken: token.id });
    return { id: token.id, component, url: token.url, expiresAt: token.expires_at };
  }

  /** `GET /v1/platform/customers/{id}/usage`, served from SalonBook's copy when it is fresh. */
  async usage(salon: SeedSalon, options: { readonly refresh?: boolean } = {}): Promise<UsageSummary> {
    const record = this.requireCustomer(salon);
    const now = this.options.now();
    const cached = record.usage;
    if (
      cached !== null &&
      options.refresh !== true &&
      now.getTime() - Date.parse(cached.fetchedAt) < USAGE_TTL_MS
    ) {
      return cached.summary;
    }
    const period = now.toISOString().slice(0, 7);
    const usage = await this.api.platform.customers.usage(record.customerId, { period });
    const summary = summariseUsage(usage, period);
    this.store.update(salon, (current) => ({ ...current, usage: { fetchedAt: now.toISOString(), summary } }));
    return summary;
  }

  /** `PUT /v1/automation-packs/provision` with `X-LazyApp-Customer`: the platform key acting for one salon. */
  async provisionPack(salon: SeedSalon): Promise<string> {
    const record = this.requireCustomer(salon);
    const result = await this.api.automationPacks.provision(
      { pack: this.options.automationPack },
      {
        customer: record.externalId,
        idempotencyKey: `salonbook:pack:${record.externalId}:${this.options.automationPack}`,
      },
    );
    const summary = describePack(this.options.automationPack, result);
    this.store.update(salon, (current) => ({
      ...current,
      pack: { at: this.options.now().toISOString(), summary },
    }));
    return summary;
  }

  private requireCustomer(salon: SeedSalon): SalonRecord & { readonly customerId: string } {
    const record = this.store.get(salon);
    if (record.customerId === null) {
      throw new SalonBookError(409, 'customer_missing', `Create ${salon.name} in LazyApp first.`);
    }
    return { ...record, customerId: record.customerId };
  }
}

/**
 * Normalises the usage response. LazyApp answers with its analytics (`totals`, `byCategory`) plus
 * billing fields; the published schema shows `data: { period, messages, total_charge }`. Read both.
 */
export function summariseUsage(usage: PlatformCustomerUsage, period: string): UsageSummary {
  const totals = usage.totals;
  return {
    period: usage.data?.period ?? period,
    messages: totals?.messages ?? usage.data?.messages ?? 0,
    totalCharge: String(totals?.totalCharge ?? usage.data?.total_charge ?? '0'),
    currency: totals?.currency ?? 'INR',
    billingMode: usage.billing_mode ?? null,
    walletBalanceCents: usage.wallet_balance_cents ?? null,
    spendingLimitCents: usage.spending_limit_cents ?? null,
    byCategory: (usage.byCategory ?? []).map((row) => ({
      category: row.category ?? 'other',
      messages: row.messages,
    })),
  };
}

function describePack(pack: string, result: AutomationPackResult): string {
  const part = (label: string, counts: AutomationPackResult['event_mappings']) =>
    counts === undefined ? null : `${label}: ${counts.created} created, ${counts.skipped} skipped`;
  const parts = [
    part('event mappings', result.event_mappings),
    part('workflows', result.workflows),
    part('flows', result.flows),
  ].filter((value): value is string => value !== null);
  return `${pack} · ${parts.length === 0 ? 'nothing to provision' : parts.join(' · ')}`;
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
