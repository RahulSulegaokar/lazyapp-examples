import type {
  CatalogProduct,
  ContactCard,
  CreateAuthenticationTemplateInput,
  CreateTemplateInput,
  FlowCategory,
  Interactive,
  LazyAppClient,
  SentMessage,
  TemplateSend,
  WebhookEnvelope,
  WebhookEventType,
} from '@lazyapp-examples/sdk';
import type { ZodType } from 'zod';
import type { Inbound } from './inbound.js';
import type { Logger } from './logger.js';
import type { KeyValueStore } from './store.js';
import type { ButtonsInput, CtaInput, HeaderInput, ListInput } from './ui.js';

// ---------------------------------------------------------------------------
// Manifest: everything `npm run setup` provisions for an example
// ---------------------------------------------------------------------------

export type TemplateSpec =
  | {
      readonly kind: 'standard';
      /** Why the example needs it; printed by setup. */
      readonly purpose: string;
      /** Name must be `demo_<exampleid>_<what>` (lowercase, underscores) to stay unique on a shared number. */
      readonly input: CreateTemplateInput;
    }
  | {
      readonly kind: 'authentication';
      readonly purpose: string;
      readonly input: CreateAuthenticationTemplateInput;
    };

export interface FlowSpec {
  /** Stable key used in code: `ctx.flows.send({ key })`. LazyApp name becomes `demo_<exampleid>_<key>`. */
  readonly key: string;
  readonly purpose: string;
  readonly categories: readonly FlowCategory[];
  /** The Flow JSON document (version 7.x). Keep it in `flows/<key>.json` next to the example. */
  readonly flowJson: Readonly<Record<string, unknown>>;
  /**
   * True when screens load data from this example's `flowEndpoints[key]`.
   * Setup points the flow's `data_endpoint_uri` at `${PUBLIC_BASE_URL}/flows/<exampleid>/<key>`.
   */
  readonly dataExchange: boolean;
}

export type Requirement = 'none' | 'optional' | 'required';

export interface ExampleManifest {
  readonly templates?: readonly TemplateSpec[];
  readonly flows?: readonly FlowSpec[];
  /**
   * Events beyond `message.received` this example handles in `onEvent`
   * (e.g. `payment.captured`, `message.failed`). The server subscribes to the union.
   */
  readonly webhookEvents?: readonly WebhookEventType[];
  readonly requires?: {
    /** Read-only Meta catalog. Optional = the example falls back to interactive lists without one. */
    readonly catalog?: Requirement;
    /** India payments (`order_details`). Optional = falls back to a payment link / UPI intent. */
    readonly payments?: Requirement;
    /** India address messages (both numbers +91). */
    readonly addressMessages?: boolean;
  };
  /** A `/command` in conversation starters, e.g. `{ name: 'shop', description: 'Try the WhatsApp store demo' }`. */
  readonly command?: { readonly name: string; readonly description: string };
  /** Text pre-typed by the QR code / chat link. Must start with the start code. Defaults to the start code. */
  readonly qrPrefill?: string;
  /** Optional ice breaker (≤ 80 chars, no emoji). Must start with the start code. Only set with `setup --ice-breakers`. */
  readonly iceBreaker?: string;
}

/** Shown in the demo hub and on the examples page. */
export interface ExampleDescription {
  readonly summary: string;
  /** Meta features the example exercises, e.g. `['Reply buttons', 'Catalog', 'Payments (India)']`. */
  readonly metaFeatures: readonly string[];
  /** Optional emoji for the hub list (WhatsApp lists render it fine). */
  readonly emoji?: string;
}

// ---------------------------------------------------------------------------
// Runtime context handed to every handler
// ---------------------------------------------------------------------------

export interface DemoUser {
  /** Phone (E.164) or business-scoped id: the session key. */
  readonly address: string;
  /** E.164 phone, when the user has a visible number. */
  readonly phone: string | null;
  readonly displayName: string | null;
  readonly contactUuid: string | null;
}

export interface SessionInfo {
  readonly id: string;
  readonly startedAt: Date;
  readonly lastInboundAt: Date;
  /** Inbound messages handled so far in this session. */
  readonly turns: number;
  /** False when the 24-hour customer service window has closed: only templates can be sent. */
  readonly windowOpen: boolean;
  readonly marketingOptIn: boolean;
}

/** Sends to the current user. Every call carries a deterministic Idempotency-Key, so replays never double-send. */
export interface Messenger {
  text(
    body: string,
    options?: { readonly previewUrl?: boolean; readonly replyTo?: string },
  ): Promise<SentMessage>;
  buttons(input: ButtonsInput): Promise<SentMessage>;
  list(input: ListInput): Promise<SentMessage>;
  cta(input: CtaInput): Promise<SentMessage>;
  image(url: string, caption?: string): Promise<SentMessage>;
  video(url: string, caption?: string): Promise<SentMessage>;
  audio(url: string): Promise<SentMessage>;
  document(url: string, filename: string, caption?: string): Promise<SentMessage>;
  sticker(url: string): Promise<SentMessage>;
  location(input: {
    readonly latitude: number;
    readonly longitude: number;
    readonly name?: string;
    readonly address?: string;
  }): Promise<SentMessage>;
  locationRequest(body: string): Promise<SentMessage>;
  contacts(cards: readonly ContactCard[]): Promise<SentMessage>;
  /** Reacts to a message (default: the inbound message being handled). Empty emoji removes the reaction. */
  react(emoji: string, wamid?: string): Promise<SentMessage | null>;
  /** Any interactive object (carousel, product, catalog, address, flow…). See `ui.*` builders. */
  interactive(interactive: Interactive): Promise<SentMessage>;
  /** An approved template. The only thing that can be sent once the 24h window has closed. */
  template(template: TemplateSend): Promise<SentMessage>;
  /** Blue ticks on the current inbound message, plus "typing…" for up to 25 seconds. */
  typing(): Promise<void>;
}

export interface FlowSendInput {
  /** `FlowSpec.key`. */
  readonly key: string;
  readonly body: string;
  /** Button label, ≤ 20 chars. */
  readonly cta: string;
  readonly header?: HeaderInput;
  readonly footer?: string;
  /** First screen and its data for `navigate`. Omit for a data_exchange flow: the endpoint answers INIT. */
  readonly screen?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface FlowsApi {
  /** True when the flow exists in LazyApp with a Meta id and can be sent. */
  isAvailable(key: string): Promise<boolean>;
  /** Sends the flow with a fresh single-session token. Throws `FlowUnavailableError` when not provisioned. */
  send(input: FlowSendInput): Promise<{ readonly token: string; readonly message: SentMessage }>;
}

export interface CatalogInfo {
  readonly catalogId: string;
  readonly products: readonly CatalogProduct[];
}

export type PaymentsInfo =
  | { readonly method: 'payment_gateway'; readonly configuration: string }
  | { readonly method: 'payment_link' | 'upi_intent_link'; readonly gatewayAccount: string };

/** What the number can do right now. Cached for a few minutes; null means "fall back". */
export interface CapabilitiesApi {
  catalog(): Promise<CatalogInfo | null>;
  payments(): Promise<PaymentsInfo | null>;
}

export interface FollowUpInput {
  /** Unique per session, e.g. `abandoned-cart`. Scheduling the same key again replaces it. */
  readonly key: string;
  readonly sendAt: Date;
  readonly template: TemplateSend;
  /** Marketing follow-ups require `ctx.consent.optInToMarketing` first; utility ones do not. */
  readonly category: 'utility' | 'marketing';
}

export interface FollowUpsApi {
  /** Schedules a template with LazyApp (`send_at`). Cancelled automatically on EXIT, STOP or expiry. */
  schedule(input: FollowUpInput): Promise<void>;
  cancel(key: string): Promise<void>;
}

export interface ConsentApi {
  readonly marketingOptIn: boolean;
  /** Call only from an explicit in-chat action (e.g. tapping "Remind me"). Records consent on the LazyApp contact. */
  optInToMarketing(consentText: string): Promise<void>;
  optOutOfMarketing(): Promise<void>;
}

export interface ExampleContext<S> {
  readonly example: { readonly id: string; readonly title: string; readonly startCode: string };
  readonly user: DemoUser;
  readonly session: SessionInfo;
  /** The example's state for this user. Treat as immutable; change it with `setState`. */
  readonly state: Readonly<S>;
  setState(next: S | ((previous: Readonly<S>) => S)): void;
  readonly send: Messenger;
  readonly flows: FlowsApi;
  readonly capabilities: CapabilitiesApi;
  readonly followUps: FollowUpsApi;
  readonly consent: ConsentApi;
  /** Example-wide storage (shared by every user of this example). */
  readonly kv: KeyValueStore;
  /** Full client for everything else (payments, contacts, tags…). Pass `ctx.idempotencyKey(label)` on writes. */
  readonly api: LazyAppClient;
  /** Deterministic per-event key: the same inbound event always yields the same key for the same label. */
  idempotencyKey(label: string): string;
  /** Ends the demo for this user (follow-ups are cancelled). Send any goodbye first. */
  end(): Promise<void>;
  readonly now: () => Date;
  readonly log: Logger;
  readonly config: { readonly publicBaseUrl: string; readonly phoneNumberId: string | null };
}

// ---------------------------------------------------------------------------
// Flow data_exchange
// ---------------------------------------------------------------------------

/** The decrypted request LazyApp forwards to a flow's data endpoint (Meta's shape). */
export interface FlowExchangeRequest {
  readonly version: string;
  readonly action: 'INIT' | 'data_exchange' | 'BACK' | 'ping';
  readonly screen?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  readonly flow_token: string;
}

/** Next screen and its data, or close the flow with `SUCCESS`. */
export type FlowExchangeResponse =
  | { readonly screen: string; readonly data: Readonly<Record<string, unknown>> }
  | {
      readonly screen: 'SUCCESS';
      readonly data: {
        readonly extension_message_response: {
          readonly params: Readonly<Record<string, unknown>> & { readonly flow_token: string };
        };
      };
    };

export interface FlowExchangeContext<S> {
  readonly user: DemoUser;
  readonly state: Readonly<S>;
  setState(next: S | ((previous: Readonly<S>) => S)): void;
  readonly kv: KeyValueStore;
  readonly now: () => Date;
  readonly log: Logger;
}

export type FlowEndpointHandler<S> = (
  ctx: FlowExchangeContext<S>,
  request: FlowExchangeRequest,
) => Promise<FlowExchangeResponse>;

// ---------------------------------------------------------------------------
// Web pages (sign-in pages, check-in scanners, ticket images)
// ---------------------------------------------------------------------------

/** Session facts a web page may read about a WhatsApp user of this example. */
export interface WebSessionInfo {
  readonly sessionId: string;
  readonly startedAt: Date;
  readonly lastInboundAt: Date;
  /** False once the 24h customer service window has closed. */
  readonly windowOpen: boolean;
}

/** `failed`: the handler threw (logged; the user may have been sent an apology). */
export type NotifyResult = 'sent' | 'no-session' | 'duplicate' | 'failed';

/** What a web route handler can do. Pages never send to a number that is not in this example's session. */
export interface WebContext<S> {
  readonly example: { readonly id: string; readonly title: string; readonly startCode: string };
  /** Shared example storage: the same `kv` handlers see. */
  readonly kv: KeyValueStore;
  readonly api: LazyAppClient;
  readonly now: () => Date;
  readonly log: Logger;
  readonly config: { readonly publicBaseUrl: string; readonly phoneNumberId: string | null };
  /** Absolute URL of this example's web root: `${publicBaseUrl}/x/<exampleId>`. */
  readonly baseUrl: string;
  /** Best-effort client IP (from the trusted reverse proxy), for rate limiting. */
  readonly clientIp: string;
  /** The live session of `address` in this example, or null (no session, another demo, or idle). */
  session(address: string): WebSessionInfo | null;
  /**
   * Runs `handler` as a turn of `address`'s live session in this example (serialised with their
   * messages), e.g. to say "you're checked in". `key` makes it exactly-once: the same key never runs
   * twice for a session. Returns `no-session` (and does nothing) when the person is not in this demo.
   */
  notify(
    address: string,
    key: string,
    handler: (ctx: ExampleContext<S>) => Promise<void>,
  ): Promise<NotifyResult>;
}

export type WebRouteHandler<S> = (
  web: WebContext<S>,
  request: Request,
  params: Readonly<Record<string, string>>,
) => Promise<Response>;

export interface WebRoute<S> {
  readonly method: 'GET' | 'POST';
  /** Relative to `/x/<exampleId>`, e.g. `/` or `/tickets/:code`. `:name` segments become `params`. */
  readonly path: string;
  readonly handler: WebRouteHandler<S>;
}

// ---------------------------------------------------------------------------
// The Example contract
// ---------------------------------------------------------------------------

export type DemoEvent = WebhookEnvelope;

export type EndReason = 'exit' | 'stop' | 'expired' | 'switched' | 'ended';

export interface Example<S = unknown> {
  /** kebab-case, unique: `shop`, `food`, `real-estate`. */
  readonly id: string;
  readonly title: string;
  /**
   * Upper-case phrase that starts the demo, e.g. `DEMO SHOP`. Matched case-insensitively
   * as the whole message or its first words, so a QR prefill like "DEMO SHOP - hi" works.
   */
  readonly startCode: string;
  readonly manifest: ExampleManifest;
  describe(): ExampleDescription;
  initialState(): S;
  /** Validates stored state on load; state that no longer parses (after a deploy) is reset. */
  readonly stateSchema?: ZodType<S>;
  /** The user sent the start code. State is fresh. */
  onStart(ctx: ExampleContext<S>, inbound: Inbound): Promise<void>;
  /** Every other inbound message in the session (MENU / EXIT / STOP never reach here). */
  onMessage(ctx: ExampleContext<S>, inbound: Inbound): Promise<void>;
  /** "MENU" or a `demo:menu` button. Defaults to `onStart`. */
  onMenu?(ctx: ExampleContext<S>): Promise<void>;
  /** Webhook events declared in `manifest.webhookEvents` for a user in this example's session. */
  onEvent?(ctx: ExampleContext<S>, event: DemoEvent): Promise<void>;
  /** Cleanup hook. The router sends the goodbye for exit/stop; do not send here. */
  onEnd?(ctx: ExampleContext<S>, reason: EndReason): Promise<void>;
  /** data_exchange handlers by `FlowSpec.key`. */
  readonly flowEndpoints?: Readonly<Record<string, FlowEndpointHandler<S>>>;
  /** Public web pages served at `/x/<id>/…` (a sign-in page, a check-in scanner, ticket images). */
  readonly web?: readonly WebRoute<S>[];
}

/**
 * An example of any state type. Collections (registry, router, server) hold examples whose
 * state types differ and never read the state themselves, so `any` is contained here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExample = Example<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExampleContext = ExampleContext<any>;

/** Identity function that keeps `S` inferred across the whole definition. */
export function defineExample<S>(example: Example<S>): Example<S> {
  return example;
}

/** Reserved interactive ids the router handles for every example. */
export const RESERVED_IDS = {
  menu: 'demo:menu',
  exit: 'demo:exit',
  hub: 'demo:hub',
  /** `demo:start:<exampleId>` starts that example from the hub. */
  startPrefix: 'demo:start:',
} as const;

export class FlowUnavailableError extends Error {
  constructor(
    readonly flowKey: string,
    reason: string,
  ) {
    super(`Flow "${flowKey}" is not available: ${reason}`);
    this.name = 'FlowUnavailableError';
  }
}

export class ServiceWindowClosedError extends Error {
  constructor() {
    super('The 24-hour customer service window is closed: only templates can be sent');
    this.name = 'ServiceWindowClosedError';
  }
}

export class ConsentRequiredError extends Error {
  constructor(what: string) {
    super(`${what} needs an explicit in-chat marketing opt-in first`);
    this.name = 'ConsentRequiredError';
  }
}
