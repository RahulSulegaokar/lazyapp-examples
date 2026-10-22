import { LazyAppError, paginate } from '@lazyapp-examples/sdk';
import type { Flow, LazyAppClient } from '@lazyapp-examples/sdk';
import type { CatalogInfo, PaymentsInfo } from './example.js';
import type { Logger } from './logger.js';

/** LazyApp flow name for an example's flow key. Names are workspace-wide, so they are namespaced. */
export function flowName(exampleId: string, key: string): string {
  return `demo_${exampleId.replace(/-/g, '_')}_${key}`;
}

/** Caches a value for `ttlMs`, sharing one in-flight load between concurrent callers. */
class Cached<T> {
  private value: { readonly at: number; readonly data: T } | undefined;
  private inflight: Promise<T> | undefined;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly clock: () => Date,
  ) {}

  async get(): Promise<T> {
    const now = this.clock().getTime();
    if (this.value !== undefined && now - this.value.at < this.ttlMs) {
      return this.value.data;
    }
    this.inflight ??= this.load()
      .then((data) => {
        this.value = { at: this.clock().getTime(), data };
        return data;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  invalidate(): void {
    this.value = undefined;
  }
}

/** Resolves flow names to Meta flow ids (`provider_flow_id`) via `GET /v1/flows`. */
export class FlowDirectory {
  private readonly cache: Cached<ReadonlyMap<string, Flow>>;

  constructor(api: LazyAppClient, clock: () => Date, ttlMs = 5 * 60_000) {
    this.cache = new Cached(
      ttlMs,
      async () => {
        const flows = new Map<string, Flow>();
        for await (const flow of paginate((cursor) => api.flows.list({ limit: 100, cursor }))) {
          flows.set(flow.name, flow);
        }
        return flows;
      },
      clock,
    );
  }

  async find(name: string): Promise<Flow | undefined> {
    return (await this.cache.get()).get(name);
  }

  invalidate(): void {
    this.cache.invalidate();
  }
}

export interface CapabilityOptions {
  /** Name of an active payment configuration (`payment_gateway`). Auto-detected when unset. */
  readonly paymentConfiguration?: string | undefined;
  /** Gateway account id for `payment_link` fallback (Cashfree / Razorpay in LazyApp). */
  readonly paymentGatewayAccount?: string | undefined;
  readonly phoneNumberId?: string | undefined;
}

/**
 * Detects what the number can do right now, so examples degrade gracefully:
 * no catalog → interactive lists; no payment setup → payment link or "pay on delivery".
 */
export class CapabilityDirectory {
  private readonly catalogCache: Cached<CatalogInfo | null>;
  private readonly paymentsCache: Cached<PaymentsInfo | null>;

  constructor(
    api: LazyAppClient,
    options: CapabilityOptions,
    log: Logger,
    clock: () => Date,
    ttlMs = 10 * 60_000,
  ) {
    this.catalogCache = new Cached(
      ttlMs,
      async () => {
        try {
          const page = await api.catalog.listProducts({ limit: 100, phone_number_id: options.phoneNumberId });
          return page.data.length > 0 ? { catalogId: page.catalog_id, products: page.data } : null;
        } catch (error) {
          if (error instanceof LazyAppError && error.status < 500) {
            log.info('catalog unavailable, examples use list fallbacks', {
              status: error.status,
              reason: error.message,
            });
            return null;
          }
          throw error;
        }
      },
      clock,
    );
    this.paymentsCache = new Cached(
      ttlMs,
      async () => {
        try {
          const { data } = await api.payments.listConfigurations();
          const active = data.filter((configuration) => configuration.status === 'active');
          const chosen =
            options.paymentConfiguration === undefined
              ? active[0]
              : active.find(
                  (configuration) => configuration.configuration_name === options.paymentConfiguration,
                );
          if (chosen !== undefined) {
            return { method: 'payment_gateway', configuration: chosen.configuration_name };
          }
        } catch (error) {
          if (!(error instanceof LazyAppError && error.status < 500)) {
            throw error;
          }
          log.info('payment configurations unavailable', { status: error.status, reason: error.message });
        }
        return options.paymentGatewayAccount === undefined
          ? null
          : { method: 'payment_link', gatewayAccount: options.paymentGatewayAccount };
      },
      clock,
    );
  }

  catalog(): Promise<CatalogInfo | null> {
    return this.catalogCache.get();
  }

  payments(): Promise<PaymentsInfo | null> {
    return this.paymentsCache.get();
  }
}
