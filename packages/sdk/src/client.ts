import { HttpTransport } from './http.js';
import type { HttpMethod, RequestEvent, RequestOptions } from './http.js';
import type { InteractiveMessage, OutboundMessage, SendOptions, TemplateSend } from './messages.js';
import type {
  AutomationPackResult,
  CatalogProductPage,
  Capability,
  CommerceSettings,
  Connection,
  ConsentInput,
  Contact,
  ConversationStarters,
  CreateAuthenticationTemplateInput,
  CreatedWebhookEndpoint,
  CreateEmbedTokenInput,
  CreateFlowInput,
  CreatePaymentInput,
  CreatePlatformCustomerInput,
  CreateSetupLinkInput,
  CreateTemplateInput,
  CreateWebhookInput,
  EmbedToken,
  Flow,
  FlowDetail,
  FlowHealth,
  ListParams,
  OrderStatus,
  OtpChallenge,
  OtpVerification,
  Page,
  PaymentConfiguration,
  PaymentOrder,
  PaymentStatus,
  PlatformCustomer,
  PlatformCustomerUsage,
  ProvisionAutomationPackInput,
  QrCode,
  ReadReceipt,
  ScheduledMessageAccepted,
  SendEventInput,
  SendOtpInput,
  SentMessage,
  SetupLink,
  Template,
  UpsertContactInput,
  WebhookEndpoint,
} from './types.js';

export interface LazyAppClientOptions {
  /** `sk_live_…` or `sk_test_…`. */
  readonly apiKey: string;
  /** Defaults to `https://lazyapp.in`. */
  readonly baseUrl?: string | undefined;
  /** Retries after the first attempt for 409/429/5xx/network failures. Default 3. */
  readonly maxRetries?: number | undefined;
  /** Per-attempt timeout. Default 15s. */
  readonly timeoutMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly userAgent?: string | undefined;
  /** Observability hook, called once per HTTP attempt. */
  readonly onRequest?: ((event: RequestEvent) => void) | undefined;
  /** Injected in tests to make backoff instant and deterministic. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
}

/** Per-call options for writes. */
export interface WriteOptions {
  readonly idempotencyKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Acting for a platform customer with a platform key: sent as `X-LazyApp-Customer`. */
export interface CustomerScope {
  /** The customer's `cus_…` id, uuid or your `external_id`. Needs `customers:act` or `customers:write`. */
  readonly customer?: string | undefined;
}

/** `X-LazyApp-Customer` for a call made on a platform customer's behalf. */
export function customerHeaders(customer: string | undefined): Readonly<Record<string, string>> | undefined {
  return customer === undefined ? undefined : { 'X-LazyApp-Customer': customer };
}

const enc = encodeURIComponent;

/**
 * Typed client for the LazyApp REST API (`https://lazyapp.in/v1`).
 *
 * ```ts
 * const lazyapp = new LazyAppClient({ apiKey: process.env.LAZYAPP_API_KEY! });
 * await lazyapp.messages.send({ type: 'text', to: '+919812345670', body: 'Hello' });
 * ```
 */
export class LazyAppClient {
  readonly messages: MessagesResource;
  readonly templates: TemplatesResource;
  readonly flows: FlowsResource;
  readonly webhooks: WebhooksResource;
  readonly contacts: ContactsResource;
  readonly tags: TagsResource;
  readonly catalog: CatalogResource;
  readonly payments: PaymentsResource;
  readonly connections: ConnectionsResource;
  readonly conversations: ConversationsResource;
  readonly events: EventsResource;
  readonly otp: OtpResource;
  readonly capabilities: CapabilitiesResource;
  readonly platform: PlatformResource;
  readonly automationPacks: AutomationPacksResource;

  private readonly http: HttpTransport;

  constructor(options: LazyAppClientOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('LazyAppClient needs an API key (sk_live_… or sk_test_…)');
    }
    this.http = new HttpTransport({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'https://lazyapp.in',
      fetch: options.fetch ?? globalThis.fetch,
      maxRetries: options.maxRetries ?? 3,
      timeoutMs: options.timeoutMs ?? 15_000,
      userAgent: options.userAgent ?? 'lazyapp-examples-sdk/0.1',
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      random: options.random ?? Math.random,
      onRequest: options.onRequest,
    });
    const request = this.request.bind(this);
    this.messages = new MessagesResource(request);
    this.templates = new TemplatesResource(request);
    this.flows = new FlowsResource(request);
    this.webhooks = new WebhooksResource(request);
    this.contacts = new ContactsResource(request);
    this.tags = new TagsResource(request);
    this.catalog = new CatalogResource(request);
    this.payments = new PaymentsResource(request);
    this.connections = new ConnectionsResource(request);
    this.conversations = new ConversationsResource(request);
    this.events = new EventsResource(request);
    this.otp = new OtpResource(request);
    this.capabilities = new CapabilitiesResource(request);
    this.platform = new PlatformResource(request);
    this.automationPacks = new AutomationPacksResource(request);
  }

  /** Escape hatch for endpoints without a typed method. Same retries and errors. */
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
    return this.http.request<T>(method, path, options);
  }
}

type Requester = <T>(method: HttpMethod, path: string, options?: RequestOptions) => Promise<T>;

abstract class Resource {
  constructor(protected readonly request: Requester) {}
}

/** Async-iterates every item across cursor pages. */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    yield* page.data;
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
}

export class MessagesResource extends Resource {
  /** `POST /v1/messages`. Returns the message, or the scheduled id when `send_at` is set. */
  send(message: OutboundMessage, options: WriteOptions = {}): Promise<SentMessage> {
    return this.request<SentMessage>('POST', '/v1/messages', { body: message, ...options });
  }

  /** `POST /v1/messages` with `send_at`: answers `202` with a cancellable id. */
  schedule(
    message: OutboundMessage & { readonly send_at: string },
    options: WriteOptions = {},
  ): Promise<ScheduledMessageAccepted> {
    return this.request<ScheduledMessageAccepted>('POST', '/v1/messages', { body: message, ...options });
  }

  /** `DELETE /v1/messages/scheduled/{id}`. */
  cancelScheduled(id: string): Promise<undefined> {
    return this.request<undefined>('DELETE', `/v1/messages/scheduled/${enc(id)}`);
  }

  text(
    to: string,
    body: string,
    extra: Omit<SendOptions, 'to'> = {},
    options?: WriteOptions,
  ): Promise<SentMessage> {
    return this.send({ ...extra, type: 'text', to, body }, options);
  }

  interactive(
    to: string,
    interactive: InteractiveMessage['interactive'],
    extra: Omit<SendOptions, 'to'> = {},
    options?: WriteOptions,
  ): Promise<SentMessage> {
    return this.send({ ...extra, type: 'interactive', to, interactive }, options);
  }

  template(
    to: string,
    template: TemplateSend,
    extra: Omit<SendOptions, 'to'> = {},
    options?: WriteOptions,
  ): Promise<SentMessage> {
    return this.send({ ...extra, type: 'template', to, template }, options);
  }

  /** `POST /v1/messages/{uuid}/read`: blue ticks, optionally with "typing…" for up to 25s. */
  markRead(messageUuid: string, options: { readonly typing?: boolean } = {}): Promise<ReadReceipt> {
    return this.request<ReadReceipt>('POST', `/v1/messages/${enc(messageUuid)}/read`, {
      body: { typing: options.typing ?? false },
    });
  }
}

export class TemplatesResource extends Resource {
  list(
    params: ListParams & { readonly status?: string | undefined; readonly q?: string } = {},
  ): Promise<Page<Template>> {
    return this.request<Page<Template>>('GET', '/v1/templates', { query: params });
  }

  get(uuid: string): Promise<Template> {
    return this.request<Template>('GET', `/v1/templates/${enc(uuid)}`);
  }

  create(input: CreateTemplateInput, options?: WriteOptions): Promise<Template> {
    return this.request<Template>('POST', '/v1/templates', { body: input, ...options });
  }

  /** Copy-code, one-tap or zero-tap OTP templates, one per language. */
  createAuthentication(
    input: CreateAuthenticationTemplateInput,
    options?: WriteOptions,
  ): Promise<{ readonly data: readonly Template[] }> {
    return this.request('POST', '/v1/templates/authentication', { body: input, ...options });
  }

  /** Pulls the latest statuses from Meta. */
  sync(): Promise<unknown> {
    return this.request('POST', '/v1/templates/sync');
  }
}

export class FlowsResource extends Resource {
  list(params: ListParams = {}): Promise<Page<Flow>> {
    return this.request<Page<Flow>>('GET', '/v1/flows', { query: params });
  }

  get(uuid: string): Promise<FlowDetail> {
    return this.request<FlowDetail>('GET', `/v1/flows/${enc(uuid)}`);
  }

  create(input: CreateFlowInput, options?: WriteOptions): Promise<Flow> {
    return this.request<Flow>('POST', '/v1/flows', { body: input, ...options });
  }

  /** Replaces a draft. A published flow answers 422 `flow_not_editable`. */
  update(uuid: string, input: CreateFlowInput, options?: WriteOptions): Promise<Flow> {
    return this.request<Flow>('PUT', `/v1/flows/${enc(uuid)}`, { body: input, ...options });
  }

  publish(uuid: string, options?: WriteOptions): Promise<Flow> {
    return this.request<Flow>('POST', `/v1/flows/${enc(uuid)}/publish`, options);
  }

  deprecate(uuid: string, options?: WriteOptions): Promise<Flow> {
    return this.request<Flow>('POST', `/v1/flows/${enc(uuid)}/deprecate`, options);
  }

  health(uuid: string): Promise<FlowHealth> {
    return this.request<FlowHealth>('GET', `/v1/flows/${enc(uuid)}/health`);
  }
}

export class WebhooksResource extends Resource {
  list(params: ListParams = {}): Promise<Page<WebhookEndpoint>> {
    return this.request<Page<WebhookEndpoint>>('GET', '/v1/webhooks', { query: params });
  }

  /** The response carries the signing `secret`, shown once. */
  create(input: CreateWebhookInput, options?: WriteOptions): Promise<CreatedWebhookEndpoint> {
    return this.request<CreatedWebhookEndpoint>('POST', '/v1/webhooks', { body: input, ...options });
  }

  delete(id: number): Promise<undefined> {
    return this.request<undefined>('DELETE', `/v1/webhooks/${id}`);
  }

  /** Queues a signed delivery flagged `test: true`. */
  test(id: number, event = 'message.sent'): Promise<unknown> {
    return this.request('POST', `/v1/webhooks/${id}/test`, { body: { event } });
  }

  resume(id: number): Promise<WebhookEndpoint> {
    return this.request<WebhookEndpoint>('POST', `/v1/webhooks/${id}/resume`);
  }

  rotateSecret(id: number): Promise<CreatedWebhookEndpoint> {
    return this.request<CreatedWebhookEndpoint>('POST', `/v1/webhooks/${id}/rotate-secret`);
  }
}

export class ContactsResource extends Resource {
  list(params: ListParams & { readonly q?: string } = {}): Promise<Page<Contact>> {
    return this.request<Page<Contact>>('GET', '/v1/contacts', { query: params });
  }

  get(contact: string): Promise<Contact> {
    return this.request<Contact>('GET', `/v1/contacts/${enc(contact)}`);
  }

  /** Creates or updates by phone number / bsuid / external id. */
  upsert(input: UpsertContactInput, options?: WriteOptions): Promise<Contact> {
    return this.request<Contact>('POST', '/v1/contacts', { body: input, ...options });
  }

  /** Attaches tags by name (created on first use) or uuid. Additive: existing tags stay. */
  addTags(contact: string, tags: readonly string[], options?: WriteOptions): Promise<Contact> {
    return this.request<Contact>('POST', `/v1/contacts/${enc(contact)}/tags`, { body: { tags }, ...options });
  }

  removeTags(contact: string, tags: readonly string[], options?: WriteOptions): Promise<undefined> {
    return this.request<undefined>('DELETE', `/v1/contacts/${enc(contact)}/tags`, {
      body: { tags },
      ...options,
    });
  }

  recordConsent(contact: string, input: ConsentInput, options?: WriteOptions): Promise<unknown> {
    return this.request('POST', `/v1/contacts/${enc(contact)}/consent`, { body: input, ...options });
  }
}

export class TagsResource extends Resource {
  list(): Promise<unknown> {
    return this.request('GET', '/v1/tags');
  }

  create(name: string, color?: string): Promise<unknown> {
    return this.request('POST', '/v1/tags', { body: color === undefined ? { name } : { name, color } });
  }
}

export class CatalogResource extends Resource {
  /** Reads Meta's catalog for the connection. 422 when no catalog is connected. */
  listProducts(
    params: ListParams & {
      readonly connection_uuid?: string | undefined;
      readonly phone_number_id?: string | undefined;
    } = {},
  ): Promise<CatalogProductPage> {
    return this.request<CatalogProductPage>('GET', '/v1/catalog/products', { query: params });
  }
}

export class PaymentsResource extends Resource {
  /** Sends an India `order_details` payment request (or a payment link / UPI intent). */
  create(input: CreatePaymentInput, options?: WriteOptions): Promise<PaymentOrder> {
    return this.request<PaymentOrder>('POST', '/v1/payments', { body: input, ...options });
  }

  get(id: string): Promise<PaymentOrder> {
    return this.request<PaymentOrder>('GET', `/v1/payments/${enc(id)}`);
  }

  list(
    params: ListParams & {
      readonly payment_status?: PaymentStatus | undefined;
      readonly reference_id?: string | undefined;
      readonly to?: string | undefined;
    } = {},
  ): Promise<Page<PaymentOrder>> {
    return this.request<Page<PaymentOrder>>('GET', '/v1/payments', { query: params });
  }

  /** Asks WhatsApp for the latest state (`payment_gateway` only). */
  lookup(id: string): Promise<PaymentOrder> {
    return this.request<PaymentOrder>('POST', `/v1/payments/${enc(id)}/lookup`);
  }

  /** Sends an `order_status` update; WhatsApp only allows forward moves. */
  updateStatus(
    id: string,
    input: {
      readonly status: Exclude<OrderStatus, 'pending'>;
      readonly description?: string;
      readonly body?: string;
    },
    options?: WriteOptions,
  ): Promise<PaymentOrder> {
    return this.request<PaymentOrder>('POST', `/v1/payments/${enc(id)}/status`, { body: input, ...options });
  }

  refund(
    id: string,
    input: { readonly amount: number; readonly speed?: 'normal' | 'instant' },
    options?: WriteOptions,
  ): Promise<PaymentOrder> {
    return this.request<PaymentOrder>('POST', `/v1/payments/${enc(id)}/refund`, { body: input, ...options });
  }

  listConfigurations(params: { readonly refresh?: boolean } = {}): Promise<{
    readonly data: readonly PaymentConfiguration[];
  }> {
    return this.request('GET', '/v1/payments/configurations', { query: params });
  }
}

export class ConnectionsResource extends Resource {
  list(): Promise<{ readonly data: readonly Connection[] }> {
    return this.request('GET', '/v1/connections');
  }

  get(uuid: string): Promise<Connection> {
    return this.request<Connection>('GET', `/v1/connections/${enc(uuid)}`);
  }

  commerce(uuid: string): Promise<CommerceSettings> {
    return this.request<CommerceSettings>('GET', `/v1/connections/${enc(uuid)}/commerce`);
  }

  listQrCodes(uuid: string): Promise<{ readonly data: readonly QrCode[] }> {
    return this.request('GET', `/v1/connections/${enc(uuid)}/qr-codes`);
  }

  createQrCode(
    uuid: string,
    input: { readonly prefilled_message: string; readonly image_format?: 'PNG' | 'SVG' },
  ): Promise<QrCode> {
    return this.request<QrCode>('POST', `/v1/connections/${enc(uuid)}/qr-codes`, { body: input });
  }

  updateQrCode(uuid: string, code: string, prefilledMessage: string): Promise<QrCode> {
    return this.request<QrCode>('PATCH', `/v1/connections/${enc(uuid)}/qr-codes/${enc(code)}`, {
      body: { prefilled_message: prefilledMessage },
    });
  }

  getConversationStarters(uuid: string): Promise<ConversationStarters> {
    return this.request<ConversationStarters>('GET', `/v1/connections/${enc(uuid)}/conversation-starters`);
  }

  /** Replaces every ice breaker and command. Read, merge, then write. */
  putConversationStarters(
    uuid: string,
    input: Required<Pick<ConversationStarters, 'ice_breakers' | 'commands'>> & {
      readonly welcome_message: boolean;
    },
  ): Promise<ConversationStarters> {
    return this.request<ConversationStarters>('PUT', `/v1/connections/${enc(uuid)}/conversation-starters`, {
      body: input,
    });
  }
}

export class ConversationsResource extends Resource {
  /** Shows "typing…" in a conversation (`cnv_…`). Prefer `messages.markRead(uuid, { typing: true })`. */
  typing(conversationId: string): Promise<{ readonly success: boolean }> {
    return this.request('POST', `/v1/conversations/${enc(conversationId)}/typing`);
  }
}

export class EventsResource extends Resource {
  /** Records a business event; mapped events send their template. */
  send(input: SendEventInput, options?: WriteOptions): Promise<unknown> {
    return this.request('POST', '/v1/events', { body: input, ...options });
  }
}

export class OtpResource extends Resource {
  send(input: SendOtpInput, options?: WriteOptions): Promise<OtpChallenge> {
    return this.request<OtpChallenge>('POST', '/v1/otp', { body: input, ...options });
  }

  verify(input: {
    readonly code: string;
    readonly id?: string;
    readonly to?: string;
  }): Promise<OtpVerification> {
    return this.request<OtpVerification>('POST', '/v1/otp/verify', { body: input });
  }
}

export class CapabilitiesResource extends Resource {
  list(): Promise<{ readonly data: readonly Capability[] }> {
    return this.request('GET', '/v1/capabilities');
  }
}

/**
 * The Platform API: one isolated workspace per customer of your product. Needs a key on a
 * platform workspace with `customers:write`.
 *
 * @see https://lazyapp.in/docs/platform/overview
 */
export class PlatformResource extends Resource {
  readonly customers: PlatformCustomersResource;
  readonly setupLinks: SetupLinksResource;
  readonly embedTokens: EmbedTokensResource;

  constructor(request: Requester) {
    super(request);
    this.customers = new PlatformCustomersResource(request);
    this.setupLinks = new SetupLinksResource(request);
    this.embedTokens = new EmbedTokensResource(request);
  }
}

export class PlatformCustomersResource extends Resource {
  /** `GET /v1/platform/customers`, optionally filtered by your `external_id`. */
  list(
    params: ListParams & { readonly external_id?: string | undefined } = {},
  ): Promise<Page<PlatformCustomer>> {
    return this.request<Page<PlatformCustomer>>('GET', '/v1/platform/customers', { query: params });
  }

  /** The customer with this `external_id`, or null. */
  async findByExternalId(externalId: string): Promise<PlatformCustomer | null> {
    const page = await this.list({ external_id: externalId, limit: 1 });
    return page.data.find((customer) => customer.external_id === externalId) ?? null;
  }

  create(input: CreatePlatformCustomerInput, options?: WriteOptions): Promise<PlatformCustomer> {
    return this.request<PlatformCustomer>('POST', '/v1/platform/customers', { body: input, ...options });
  }

  /** `id` is the `cus_…` public id. */
  get(id: string): Promise<PlatformCustomer> {
    return this.request<PlatformCustomer>('GET', `/v1/platform/customers/${enc(id)}`);
  }

  /** Erases the customer's workspace. Irreversible: prefer `archive` for real customers. */
  delete(id: string): Promise<undefined> {
    return this.request<undefined>('DELETE', `/v1/platform/customers/${enc(id)}`);
  }

  archive(id: string, options?: WriteOptions): Promise<PlatformCustomer> {
    return this.request<PlatformCustomer>('POST', `/v1/platform/customers/${enc(id)}/archive`, options);
  }

  /** Usage for a billing period (`YYYY-MM`, default this month). */
  usage(id: string, params: { readonly period?: string | undefined } = {}): Promise<PlatformCustomerUsage> {
    return this.request<PlatformCustomerUsage>('GET', `/v1/platform/customers/${enc(id)}/usage`, {
      query: params,
    });
  }
}

export class SetupLinksResource extends Resource {
  /** The response's `url` and `token` are secrets: hand them to the customer, never log them. */
  create(input: CreateSetupLinkInput, options?: WriteOptions): Promise<SetupLink> {
    return this.request<SetupLink>('POST', '/v1/platform/setup-links', { body: input, ...options });
  }

  revoke(id: string): Promise<undefined> {
    return this.request<undefined>('DELETE', `/v1/platform/setup-links/${enc(id)}`);
  }
}

export class EmbedTokensResource extends Resource {
  /** Mint per page view, server-side, with a short expiry and your origins only. */
  create(input: CreateEmbedTokenInput, options?: WriteOptions): Promise<EmbedToken> {
    return this.request<EmbedToken>('POST', '/v1/platform/embed-tokens', { body: input, ...options });
  }

  revoke(id: string): Promise<undefined> {
    return this.request<undefined>('DELETE', `/v1/platform/embed-tokens/${enc(id)}`);
  }
}

export class AutomationPacksResource extends Resource {
  /** `PUT /v1/automation-packs/provision`: event mappings, workflows and flows for a vertical. */
  provision(
    input: ProvisionAutomationPackInput,
    options: WriteOptions & CustomerScope = {},
  ): Promise<AutomationPackResult> {
    return this.request<AutomationPackResult>('PUT', '/v1/automation-packs/provision', {
      body: input,
      idempotencyKey: options.idempotencyKey,
      signal: options.signal,
      headers: customerHeaders(options.customer),
    });
  }
}
