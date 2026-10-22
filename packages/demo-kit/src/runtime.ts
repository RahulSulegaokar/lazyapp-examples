import { isTestDelivery, parseWebhookEvent, verifyWebhookSignature } from '@lazyapp-examples/sdk';
import type { WebhookEnvelope } from '@lazyapp-examples/sdk';
import type { FlowExchangeRequest } from './example.js';
import type { Logger } from './logger.js';
import { KeyedQueue } from './queue.js';
import { DemoRouter } from './router.js';
import type { FlowExchangeResult, RouteOutcome, RouterOptions } from './router.js';
import type { DemoStore } from './store.js';

export interface RuntimeOptions extends RouterOptions {
  /** Endpoint signing secret (`LAZYAPP_WEBHOOK_SECRET`). */
  readonly webhookSecret: string;
  /** Per-flow data endpoint secrets by `"<exampleId>/<flowKey>"` (shown in the LazyApp console). */
  readonly flowSecrets?: Readonly<Record<string, string>> | undefined;
  /** Accept unsigned flow requests (local development only). */
  readonly allowUnsignedFlowRequests?: boolean | undefined;
  readonly concurrency?: number | undefined;
}

export type IngestResult =
  | { readonly status: 'accepted'; readonly id: string }
  | { readonly status: 'duplicate'; readonly id: string }
  | { readonly status: 'ignored'; readonly reason: string }
  | { readonly status: 'rejected'; readonly httpStatus: 400 | 401; readonly reason: string };

/**
 * Durable, ordered webhook processing:
 *
 *   verify signature → persist to the inbox (dedupe on the event id) → ack →
 *   process on a per-person serial queue → mark done.
 *
 * On boot, `recover()` re-queues anything accepted but never processed.
 * Handlers are replay-safe because every send uses an idempotency key derived from the event id.
 */
export class DemoRuntime {
  readonly router: DemoRouter;
  private readonly queue: KeyedQueue;
  private readonly store: DemoStore;
  private readonly log: Logger;
  private readonly clock: () => Date;

  constructor(private readonly options: RuntimeOptions) {
    this.router = new DemoRouter(options);
    this.store = options.store;
    this.log = options.log;
    this.clock = options.clock ?? (() => new Date());
    this.queue = new KeyedQueue(options.concurrency ?? 16, (error, key) => {
      this.log.error('queued job crashed', { error, key });
    });
  }

  get queueDepth(): number {
    return this.queue.size;
  }

  /**
   * Verifies, deduplicates and queues one delivery. Call from the HTTP handler with the
   * body bytes exactly as received; it never waits for processing.
   */
  ingest(body: string | Uint8Array, signature: string | null | undefined): IngestResult {
    if (!verifyWebhookSignature(body, signature, this.options.webhookSecret)) {
      return { status: 'rejected', httpStatus: 401, reason: 'bad signature' };
    }
    const rawBody = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
    let event: WebhookEnvelope;
    try {
      event = parseWebhookEvent(rawBody);
    } catch (error) {
      return {
        status: 'rejected',
        httpStatus: 400,
        reason: error instanceof Error ? error.message : 'invalid body',
      };
    }
    if (isTestDelivery(event)) {
      this.log.info('test delivery received', { id: event.id, type: event.type });
      return { status: 'ignored', reason: 'test delivery' };
    }
    if (!this.store.recordInbound(event.id, event.type, rawBody, this.clock())) {
      return { status: 'duplicate', id: event.id };
    }
    this.enqueue(event);
    return { status: 'accepted', id: event.id };
  }

  /** Processes one event now (bypassing the queue). Used by `ingest` workers and the test harness. */
  async process(event: WebhookEnvelope): Promise<RouteOutcome> {
    try {
      const outcome = await this.router.handle(event);
      this.store.markInbound(
        event.id,
        'done',
        this.clock(),
        outcome.status === 'handled' ? outcome.error : undefined,
      );
      if (outcome.status === 'handled') {
        this.log.info('event handled', {
          id: event.id,
          type: event.type,
          example: outcome.exampleId,
          action: outcome.action,
        });
      } else {
        this.log.debug('event ignored', { id: event.id, type: event.type, reason: outcome.reason });
      }
      return outcome;
    } catch (error) {
      this.store.markInbound(
        event.id,
        'failed',
        this.clock(),
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** Re-queues deliveries that were accepted but not processed before the last shutdown. */
  recover(): number {
    const pending = this.store.pendingInbound();
    for (const record of pending) {
      try {
        this.enqueue(parseWebhookEvent(record.payload));
      } catch (error) {
        this.store.markInbound(record.id, 'failed', this.clock(), String(error));
      }
    }
    if (pending.length > 0) {
      this.log.info('recovered pending deliveries', { count: pending.length });
    }
    return pending.length;
  }

  /** Verifies and answers a flow data_exchange request, serialised with that person's messages. */
  async flowExchange(
    exampleId: string,
    flowKey: string,
    body: string | Uint8Array,
    signature: string | null | undefined,
  ): Promise<FlowExchangeResult | { readonly status: 400 | 401; readonly error: string }> {
    const secret = this.options.flowSecrets?.[`${exampleId}/${flowKey}`];
    const signed = secret !== undefined && verifyWebhookSignature(body, signature, secret);
    const rawBody = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
    if (!signed && this.options.allowUnsignedFlowRequests !== true) {
      return {
        status: 401,
        error: secret === undefined ? 'No signing secret configured for this flow' : 'Bad signature',
      };
    }
    let request: FlowExchangeRequest;
    try {
      request = parseFlowRequest(rawBody);
    } catch (error) {
      return { status: 400, error: error instanceof Error ? error.message : 'Invalid body' };
    }
    if (request.action === 'ping') {
      return this.router.flowExchange(exampleId, flowKey, request);
    }
    const key = this.store.getFlowToken(request.flow_token)?.address ?? `flow:${request.flow_token}`;
    return this.queue.run(key, () => this.router.flowExchange(exampleId, flowKey, request));
  }

  async sweep(): Promise<number> {
    return this.router.sweep();
  }

  /** Stops taking work and waits for the queue to drain. */
  async close(timeoutMs = 10_000): Promise<boolean> {
    return this.queue.close(timeoutMs);
  }

  private enqueue(event: WebhookEnvelope): void {
    this.queue.push(this.router.routingKey(event), async () => {
      await this.process(event);
    });
  }
}

function parseFlowRequest(rawBody: string): FlowExchangeRequest {
  const value: unknown = JSON.parse(rawBody);
  if (typeof value !== 'object' || value === null) {
    throw new Error('Flow request must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (action !== 'INIT' && action !== 'data_exchange' && action !== 'BACK' && action !== 'ping') {
    throw new Error(`Unknown flow action ${String(action)}`);
  }
  const data =
    typeof record.data === 'object' && record.data !== null
      ? (record.data as Record<string, unknown>)
      : undefined;
  return {
    version: typeof record.version === 'string' ? record.version : '3.0',
    action,
    screen: typeof record.screen === 'string' ? record.screen : undefined,
    data,
    flow_token: typeof record.flow_token === 'string' ? record.flow_token : '',
  };
}
