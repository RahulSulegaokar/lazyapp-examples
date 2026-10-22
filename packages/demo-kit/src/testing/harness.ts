import { LazyAppClient } from '@lazyapp-examples/sdk';
import type {
  CatalogProduct,
  Flow,
  InteractiveMessage,
  OutboundMessage,
  PaymentOrder,
  TemplateMessage,
  WebhookEnvelope,
  WebhookMessage,
} from '@lazyapp-examples/sdk';
import type { Example, FlowExchangeRequest, AnyExample } from '../example.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { DemoRuntime } from '../runtime.js';
import type { FlowExchangeResult, RouteOutcome, RouterConfig } from '../router.js';
import { flowName } from '../services.js';
import { DemoStore } from '../store.js';
import type { SessionRecord } from '../store.js';
import type { ApiCall } from './fake-api.js';
import { FakeLazyApp } from './fake-api.js';

export interface HarnessOptions {
  /** Default sender. */
  readonly phone?: string;
  readonly displayName?: string;
  /** Catalog products; omit to simulate a number with no catalog. */
  readonly catalog?: readonly CatalogProduct[];
  readonly catalogId?: string;
  /** Active payment configuration name; omit to simulate no payment setup. */
  readonly paymentConfiguration?: string;
  /** Flows are published by default; pass false to simulate an unprovisioned workspace. */
  readonly flowsPublished?: boolean;
  /** Start of the simulated clock. */
  readonly now?: Date;
  readonly config?: Partial<RouterConfig>;
  readonly log?: Logger;
  /** Other examples to register alongside (for switching tests). */
  readonly otherExamples?: readonly AnyExample[];
}

/** A fake WhatsApp user talking to the demo server. */
export interface SimulatedUser {
  readonly phone: string;
  /** Plain text, e.g. `send('DEMO SHOP')`. */
  send(text: string): Promise<RouteOutcome>;
  /** Taps a reply button (or carousel / template quick reply). */
  tap(id: string, title?: string): Promise<RouteOutcome>;
  /** Picks a list row. */
  choose(id: string, title?: string, description?: string): Promise<RouteOutcome>;
  /** Completes a flow. `token` defaults to the last flow token sent to this user. */
  submitFlow(response: Readonly<Record<string, unknown>>, token?: string): Promise<RouteOutcome>;
  submitAddress(values: Readonly<Record<string, string>>, savedAddressId?: string): Promise<RouteOutcome>;
  shareLocation(location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }): Promise<RouteOutcome>;
  sendMedia(
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker',
    media?: { id?: string; mime_type?: string; caption?: string; filename?: string; voice?: boolean },
  ): Promise<RouteOutcome>;
  /** Sends a catalog cart. Prices are major units, as Meta sends them. */
  sendOrder(
    items: readonly { retailerId: string; quantity: number; itemPrice?: number }[],
    note?: string,
  ): Promise<RouteOutcome>;
  react(emoji: string, wamid: string): Promise<RouteOutcome>;
  /** Raw `message.received` with any type/content. */
  message(type: string, content: Record<string, unknown>, body?: string | null): Promise<RouteOutcome>;
}

/**
 * Drives an example end to end: fake inbound webhooks in, real router + SDK in
 * the middle, recorded HTTP calls out. Time is simulated (`advance`).
 *
 * ```ts
 * const h = createHarness(shop, { catalog: products });
 * await h.user.send('DEMO SHOP');
 * expect(h.lastMessage()).toMatchObject({ type: 'interactive' });
 * ```
 */
export class Harness<S> {
  readonly api: FakeLazyApp;
  readonly client: LazyAppClient;
  readonly store: DemoStore;
  readonly runtime: DemoRuntime;
  readonly user: SimulatedUser;
  private nowMs: number;
  private sequence = 0;
  private lastEvent: WebhookEnvelope | undefined;
  private cursor = 0;

  constructor(
    readonly example: Example<S>,
    private readonly options: HarnessOptions = {},
  ) {
    this.nowMs = (options.now ?? new Date('2026-10-23T09:00:00+05:30')).getTime();
    const examples = [example, ...(options.otherExamples ?? [])];
    const published = options.flowsPublished ?? true;
    const flows: Flow[] = published
      ? examples.flatMap((entry) =>
          (entry.manifest.flows ?? []).map((spec) => ({
            uuid: `flow-uuid-${entry.id}-${spec.key}`,
            name: flowName(entry.id, spec.key),
            status: 'published',
            categories: [...spec.categories],
            provider_flow_id: `meta-flow-${entry.id}-${spec.key}`,
            data_endpoint_uri: spec.dataExchange ? `https://demo.test/flows/${entry.id}/${spec.key}` : null,
            published_at: new Date(this.nowMs).toISOString(),
          })),
        )
      : [];
    this.api = new FakeLazyApp({
      catalog: options.catalog,
      catalogId: options.catalogId,
      paymentConfiguration: options.paymentConfiguration,
      flows,
    });
    this.client = new LazyAppClient({
      apiKey: 'sk_test_harness',
      baseUrl: 'https://lazyapp.test',
      fetch: this.api.fetch,
      maxRetries: 0,
      sleep: async () => undefined,
    });
    this.store = new DemoStore(':memory:');
    this.runtime = new DemoRuntime({
      examples,
      api: this.client,
      store: this.store,
      log: options.log ?? silentLogger,
      clock: () => new Date(this.nowMs),
      webhookSecret: 'whsec_harness',
      allowUnsignedFlowRequests: true,
      config: { publicBaseUrl: 'https://demo.test', phoneNumberId: null, ...options.config },
    });
    this.user = this.as(options.phone ?? '+919800000001', options.displayName);
  }

  /** Another simulated user (for isolation and multi-user tests). */
  as(phone: string, displayName?: string): SimulatedUser {
    const inbound = (type: string, content: Record<string, unknown>, body: string | null = null) =>
      this.deliverMessage(phone, displayName ?? null, type, content, body);
    return {
      phone,
      send: (text) => inbound('text', { text: { body: text } }, text),
      tap: (id, title = id) =>
        inbound('interactive', { interactive: { type: 'button_reply', button_reply: { id, title } } }, title),
      choose: (id, title = id, description) =>
        inbound(
          'interactive',
          {
            interactive: {
              type: 'list_reply',
              list_reply: { id, title, ...(description === undefined ? {} : { description }) },
            },
          },
          title,
        ),
      submitFlow: (response, token) => {
        const flowToken = token ?? this.lastFlowToken(phone);
        if (flowToken === undefined) {
          throw new Error('No flow was sent to this user; pass a token');
        }
        const payload = { ...response, flow_token: flowToken };
        return inbound(
          'interactive',
          {
            interactive: {
              type: 'nfm_reply',
              nfm_reply: {
                name: 'flow',
                body: 'Sent',
                response_json: JSON.stringify(payload),
                response: payload,
              },
            },
          },
          'Flow submitted',
        );
      },
      submitAddress: (values, savedAddressId) => {
        const payload = {
          values,
          ...(savedAddressId === undefined ? {} : { saved_address_id: savedAddressId }),
        };
        return inbound(
          'interactive',
          {
            interactive: {
              type: 'nfm_reply',
              nfm_reply: {
                name: 'address_message',
                body: null,
                response_json: JSON.stringify(payload),
                response: payload,
              },
            },
          },
          'Address shared',
        );
      },
      shareLocation: (location) =>
        inbound(
          'location',
          { location: { name: null, address: null, ...location } },
          location.name ?? 'Location',
        ),
      sendMedia: (type, media = {}) =>
        inbound(
          type,
          { [type]: { id: `media_${++this.sequence}`, ...media }, media_stub: true },
          media.caption ?? null,
        ),
      sendOrder: (items, note) =>
        inbound(
          'order',
          {
            order: {
              catalog_id: this.options.catalogId ?? 'catalog_1',
              text: note ?? null,
              product_items: items.map((item) => ({
                product_retailer_id: item.retailerId,
                quantity: item.quantity,
                ...(item.itemPrice === undefined ? {} : { item_price: item.itemPrice, currency: 'INR' }),
              })),
            },
          },
          `Order · ${items.length} items`,
        ),
      react: (emoji, wamid) =>
        inbound('reaction', { reaction: { emoji, message_id: wamid, removed: false } }, emoji),
      message: inbound,
    };
  }

  /** Delivers any webhook event (payment.captured, message.failed…) through the runtime. */
  async event(type: string, data: Record<string, unknown>): Promise<RouteOutcome> {
    const event: WebhookEnvelope = {
      id: `evt_${++this.sequence}`,
      type,
      created_at: new Date(this.nowMs).toISOString(),
      data,
    };
    this.lastEvent = event;
    return this.runtime.process(event);
  }

  /** Re-delivers the last event with the same id, as LazyApp's at-least-once delivery may. */
  async replayLast(): Promise<RouteOutcome> {
    if (this.lastEvent === undefined) {
      throw new Error('Nothing to replay');
    }
    return this.runtime.process(this.lastEvent);
  }

  /** Simulates the contact paying a payment request created through `POST /v1/payments`. */
  async payPayment(paymentId?: string): Promise<RouteOutcome> {
    const order =
      paymentId === undefined ? [...this.api.payments.values()].at(-1) : this.api.payments.get(paymentId);
    if (order === undefined) {
      throw new Error('No payment request was created');
    }
    const paid: PaymentOrder = {
      ...order,
      payment_status: 'captured',
      amount_paid: order.total_amount,
      paid_with: 'upi',
      paid_at: new Date(this.nowMs).toISOString(),
    };
    this.api.payments.set(order.id, paid);
    return this.event('payment.captured', { payment: paid });
  }

  /** Calls the example's flow data endpoint as LazyApp would (signature checks are skipped). */
  async flowExchange(
    flowKey: string,
    request: Omit<FlowExchangeRequest, 'flow_token' | 'version'> & { flow_token?: string },
    phone = this.user.phone,
  ): Promise<FlowExchangeResult | { readonly status: 400 | 401; readonly error: string }> {
    const token = request.flow_token ?? this.lastFlowToken(phone) ?? '';
    return this.runtime.flowExchange(
      this.example.id,
      flowKey,
      JSON.stringify({ version: '3.0', ...request, flow_token: token }),
      null,
    );
  }

  /**
   * Requests one of the example's web pages, e.g. `h.web('/api/send', { method: 'POST', body })`.
   * `path` is relative to `/x/<exampleId>`; JSON object bodies are serialised for you.
   */
  async web(
    path: string,
    init: {
      method?: 'GET' | 'POST';
      body?: unknown;
      headers?: Record<string, string>;
      clientIp?: string;
    } = {},
  ): Promise<Response> {
    const isJson = init.body !== undefined && typeof init.body !== 'string';
    const request = new Request(`https://demo.test/x/${this.example.id}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...init.headers },
      ...(init.body === undefined
        ? {}
        : { body: isJson ? JSON.stringify(init.body) : (init.body as string) }),
    });
    return this.runtime.web(
      this.example.id,
      new URL(request.url).pathname.slice(`/x/${this.example.id}`.length) || '/',
      request,
      {
        clientIp: init.clientIp ?? '203.0.113.7',
      },
    );
  }

  /** Moves the simulated clock forward. */
  advance(ms: number): void {
    this.nowMs += ms;
  }

  now(): Date {
    return new Date(this.nowMs);
  }

  // --- Assertions helpers -------------------------------------------------------

  /** Every API call since the last `clear()`. */
  get calls(): readonly ApiCall[] {
    return this.api.calls.slice(this.cursor);
  }

  /** Bodies of `POST /v1/messages` since the last `clear()`. */
  messages(): OutboundMessage[] {
    return this.calls
      .filter((call) => call.method === 'POST' && call.path === '/v1/messages')
      .map((call) => call.body as OutboundMessage);
  }

  lastMessage(): OutboundMessage | undefined {
    return this.messages().at(-1);
  }

  /** Text bodies sent since the last `clear()`. */
  texts(): string[] {
    return this.messages().flatMap((message) => (message.type === 'text' ? [message.body] : []));
  }

  /** Interactive objects sent since the last `clear()`. */
  interactives(): InteractiveMessage['interactive'][] {
    return this.messages().flatMap((message) =>
      message.type === 'interactive' ? [message.interactive] : [],
    );
  }

  lastInteractive(): InteractiveMessage['interactive'] | undefined {
    return this.interactives().at(-1);
  }

  templates(): TemplateMessage['template'][] {
    return this.messages().flatMap((message) => (message.type === 'template' ? [message.template] : []));
  }

  /** Ids of the buttons / list rows in the last interactive message. */
  lastChoices(): string[] {
    const last = this.lastInteractive();
    if (last?.type === 'button') {
      return last.action.buttons.map((button) => button.reply.id);
    }
    if (last?.type === 'list') {
      return last.action.sections.flatMap((section) => section.rows.map((row) => row.id));
    }
    return [];
  }

  /** Calls matching method + path (string or regex) since the last `clear()`. */
  callsTo(method: string, path: string | RegExp): ApiCall[] {
    return this.calls.filter(
      (call) =>
        call.method === method && (typeof path === 'string' ? call.path === path : path.test(call.path)),
    );
  }

  /** Forgets calls made so far, so the next assertions see only new traffic. */
  clear(): void {
    this.cursor = this.api.calls.length;
  }

  session(phone = this.user.phone): SessionRecord | undefined {
    return this.store.getSession(phone);
  }

  state(phone = this.user.phone): S | undefined {
    return this.session(phone)?.state as S | undefined;
  }

  close(): void {
    this.store.close();
  }

  private lastFlowToken(phone: string): string | undefined {
    const flows = this.api.calls
      .filter((call) => call.method === 'POST' && call.path === '/v1/messages')
      .map((call) => call.body as OutboundMessage)
      .filter(
        (message): message is InteractiveMessage =>
          message.type === 'interactive' && message.interactive.type === 'flow' && message.to === phone,
      );
    const last = flows.at(-1)?.interactive;
    return last?.type === 'flow' ? last.action.parameters.flow_token : undefined;
  }

  private async deliverMessage(
    phone: string,
    displayName: string | null,
    type: string,
    content: Record<string, unknown>,
    body: string | null,
  ): Promise<RouteOutcome> {
    const id = ++this.sequence;
    const message: WebhookMessage = {
      uuid: `in_${id}`,
      conversation_id: `cnv_${phone.slice(-4)}`,
      direction: 'inbound',
      status: 'received',
      type,
      to: '+910000000000',
      from: phone,
      contact: { uuid: `contact-${phone.slice(1)}`, phone_number: phone, bsuid: null, username: displayName },
      body,
      provider_message_id: `wamid.in_${id}`,
      error_message: null,
      content,
      request_id: null,
      group: null,
      metadata: null,
      provider_timestamp: new Date(this.nowMs).toISOString(),
      created_at: new Date(this.nowMs).toISOString(),
    };
    const event: WebhookEnvelope = {
      id: `evt_in_${id}`,
      type: 'message.received',
      created_at: new Date(this.nowMs).toISOString(),
      data: { message },
    };
    this.lastEvent = event;
    return this.runtime.process(event);
  }
}

export function createHarness<S>(example: Example<S>, options?: HarnessOptions): Harness<S> {
  return new Harness(example, options);
}
