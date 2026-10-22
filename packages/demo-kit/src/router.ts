import { randomUUID } from 'node:crypto';
import {
  isEventType,
  LazyAppError,
  LazyAppNetworkError,
  LazyAppNotFoundError,
  LazyAppRefusalError,
} from '@lazyapp-examples/sdk';
import type { LazyAppClient, WebhookEnvelope, WebhookEventType } from '@lazyapp-examples/sdk';
import { CommandParser } from './commands.js';
import type { Command } from './commands.js';
import { createContext, recipientFor, SERVICE_WINDOW_MS, userFor } from './context.js';
import type { ContextDeps, Turn } from './context.js';
import { RESERVED_IDS, ServiceWindowClosedError } from './example.js';
import type {
  AnyExampleContext,
  EndReason,
  FlowExchangeRequest,
  FlowExchangeResponse,
  AnyExample,
} from './example.js';
import { normalizeAddress, toInbound } from './inbound.js';
import type { Inbound } from './inbound.js';
import type { Logger } from './logger.js';
import { maskPhone } from './logger.js';
import { CapabilityDirectory, FlowDirectory } from './services.js';
import type { CapabilityOptions } from './services.js';
import { EMPTY_META } from './store.js';
import type { DemoStore, SessionRecord } from './store.js';
import * as ui from './ui.js';

/** Hub "session" id: the user asked for the list of demos but has not picked one. */
export const HUB_ID = '__hub__';

/** Footer for example messages, so the escape hatches are always visible. */
export const DEMO_FOOTER = 'MENU · EXIT · STOP';

export interface RouterConfig {
  /** Public HTTPS origin of the demo server, e.g. `https://demo.lazyapp.in`. */
  readonly publicBaseUrl: string;
  /** Send from this number (`phone_number_id`); required when the workspace has several. */
  readonly phoneNumberId?: string | null | undefined;
  /** A session with no inbound message for this long ends silently. Default 24h. */
  readonly sessionIdleMs?: number | undefined;
  /** Blue ticks + "typing…" on every in-session message. Default true. */
  readonly autoMarkRead?: boolean | undefined;
  /** Exact messages that open the demo hub. Default `DEMO`, `DEMOS`. */
  readonly hubCodes?: readonly string[] | undefined;
  /** Send unpublished flows with `mode: draft` (testing only). Default false. */
  readonly allowDraftFlows?: boolean | undefined;
  readonly flowTokenTtlMs?: number | undefined;
  readonly capabilities?: CapabilityOptions | undefined;
}

export interface RouterOptions {
  readonly examples: readonly AnyExample[];
  readonly api: LazyAppClient;
  readonly store: DemoStore;
  readonly log: Logger;
  readonly config: RouterConfig;
  readonly clock?: (() => Date) | undefined;
}

export type RouteOutcome =
  | { readonly status: 'ignored'; readonly reason: string }
  | {
      readonly status: 'handled';
      readonly exampleId: string;
      readonly action: 'start' | 'message' | 'menu' | 'exit' | 'stop' | 'hub' | 'event';
      readonly error?: string;
    };

export type FlowExchangeResult =
  | {
      readonly status: 200;
      readonly body: FlowExchangeResponse | { readonly data: Readonly<Record<string, unknown>> };
    }
  | { readonly status: 404 | 427 | 500; readonly error: string };

/**
 * The demo gatekeeper. Enforces the shared-number rules before any example code runs:
 *
 * 1. Silent for everyone who has not sent a start code (or is not in a live session).
 * 2. One active example per person; a new start code switches.
 * 3. MENU, EXIT and STOP work everywhere; STOP also records an opt-out.
 * 4. Sessions end after 24h without an inbound message; nothing is sent after that
 *    except follow-ups the person explicitly opted into (and those are cancelled on end).
 */
export class DemoRouter {
  private readonly examples: ReadonlyMap<string, AnyExample>;
  private readonly parser: CommandParser;
  private readonly deps: ContextDeps;
  private readonly idleMs: number;
  private readonly autoMarkRead: boolean;
  private readonly clock: () => Date;
  private readonly log: Logger;

  constructor(private readonly options: RouterOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.log = options.log;
    this.examples = new Map(options.examples.map((example) => [example.id, example]));
    if (this.examples.size !== options.examples.length) {
      throw new Error('Two examples share an id');
    }
    this.parser = new CommandParser(
      options.examples.map((example) => ({
        exampleId: example.id,
        startCode: example.startCode,
        command: example.manifest.command?.name,
      })),
      options.config.hubCodes,
    );
    this.idleMs = options.config.sessionIdleMs ?? SERVICE_WINDOW_MS;
    this.autoMarkRead = options.config.autoMarkRead ?? true;
    const phoneNumberId = options.config.phoneNumberId ?? null;
    this.deps = {
      api: options.api,
      store: options.store,
      flows: new FlowDirectory(options.api, this.clock),
      capabilities: new CapabilityDirectory(
        options.api,
        { ...options.config.capabilities, phoneNumberId: phoneNumberId ?? undefined },
        options.log,
        this.clock,
      ),
      clock: this.clock,
      log: options.log,
      publicBaseUrl: options.config.publicBaseUrl.replace(/\/+$/, ''),
      phoneNumberId,
      allowDraftFlows: options.config.allowDraftFlows ?? false,
      flowTokenTtlMs: options.config.flowTokenTtlMs ?? SERVICE_WINDOW_MS,
    };
  }

  get registeredExamples(): readonly AnyExample[] {
    return [...this.examples.values()];
  }

  /** Every webhook event the examples need, `message.received` first. */
  requiredEvents(): WebhookEventType[] {
    const events = new Set<WebhookEventType>(['message.received']);
    for (const example of this.examples.values()) {
      for (const type of example.manifest.webhookEvents ?? []) {
        events.add(type);
      }
    }
    return [...events];
  }

  /** The key that serialises work: the person the event is about, or the event itself. */
  routingKey(event: WebhookEnvelope): string {
    return eventAddress(event) ?? event.id;
  }

  async handle(event: WebhookEnvelope): Promise<RouteOutcome> {
    if (isEventType(event, 'message.received')) {
      const inbound = toInbound(event.data.message);
      return inbound === null
        ? { status: 'ignored', reason: 'not a 1:1 inbound message' }
        : this.handleInbound(event.id, inbound);
    }
    return this.handleEvent(event);
  }

  /** Ends sessions idle for longer than the idle window. Returns how many ended. */
  async sweep(): Promise<number> {
    const now = this.clock();
    const idle = this.options.store.idleSessions(new Date(now.getTime() - this.idleMs));
    for (const session of idle) {
      await this.endSession(session, 'expired', `sweep:${session.sessionId}`);
    }
    this.options.store.pruneFlowTokens(now);
    this.options.store.pruneInbound(new Date(now.getTime() - 7 * SERVICE_WINDOW_MS));
    return idle.length;
  }

  /** Answers a flow data_exchange call forwarded by LazyApp for `exampleId/flowKey`. */
  async flowExchange(
    exampleId: string,
    flowKey: string,
    request: FlowExchangeRequest,
  ): Promise<FlowExchangeResult> {
    if (request.action === 'ping') {
      return { status: 200, body: { data: { status: 'active' } } };
    }
    if (request.data !== undefined && 'error' in request.data) {
      this.log.warn('flow client reported an error', { exampleId, flowKey, data: request.data });
      return { status: 200, body: { data: { acknowledged: true } } };
    }
    const example = this.examples.get(exampleId);
    const handler = example?.flowEndpoints?.[flowKey];
    if (example === undefined || handler === undefined) {
      return { status: 404, error: `No data endpoint for ${exampleId}/${flowKey}` };
    }
    const now = this.clock();
    const token = this.options.store.getFlowToken(request.flow_token);
    const session = token === undefined ? undefined : this.options.store.getSession(token.address);
    const valid =
      token !== undefined &&
      session !== undefined &&
      token.exampleId === exampleId &&
      token.flowKey === flowKey &&
      token.expiresAt > now &&
      session.sessionId === token.sessionId &&
      !this.isExpired(session, now);
    if (!valid) {
      return { status: 427, error: 'Flow token is unknown or expired' };
    }
    const loaded = this.loadState(example, session);
    let state = loaded;
    try {
      const response = await handler(
        {
          user: userFor(session),
          // The handler's state type is the example's `S`; the router only carries it.
          get state(): never {
            return state as never;
          },
          setState: (next) => {
            state = typeof next === 'function' ? (next as (previous: unknown) => unknown)(state) : next;
          },
          kv: this.options.store.keyValue(`example:${example.id}`, this.clock),
          now: this.clock,
          log: this.log.child({ example: example.id, flow: flowKey }),
        },
        request,
      );
      this.options.store.saveSession({ ...session, state, updatedAt: this.clock() });
      return { status: 200, body: response };
    } catch (error) {
      this.log.error('flow data endpoint failed', { exampleId, flowKey, error });
      return { status: 500, error: 'The data endpoint failed' };
    }
  }

  // --- Inbound messages -------------------------------------------------------

  private async handleInbound(eventId: string, inbound: Inbound): Promise<RouteOutcome> {
    const now = this.clock();
    let session = this.options.store.getSession(inbound.from);
    if (session !== undefined && this.isExpired(session, now)) {
      await this.endSession(session, 'expired', eventId);
      session = undefined;
    }

    if (session === undefined) {
      const command = this.parser.parseEntry(inbound);
      if (command.type === 'start' && this.examples.has(command.exampleId)) {
        return this.start(eventId, inbound, command.exampleId, undefined);
      }
      if (command.type === 'hub') {
        return this.hub(eventId, inbound, undefined, command.page);
      }
      return { status: 'ignored', reason: 'not in a demo' };
    }

    const command: Command = this.parser.parseInSession(inbound);
    const touched = this.touch(session, inbound, now);
    void this.acknowledge(inbound);

    switch (command.type) {
      case 'start':
        return this.examples.has(command.exampleId)
          ? this.start(eventId, inbound, command.exampleId, touched)
          : { status: 'ignored', reason: `unknown example ${command.exampleId}` };
      case 'hub':
        return this.hub(eventId, inbound, touched, command.page);
      case 'exit':
      case 'stop':
        return this.leave(eventId, touched, command.type);
      case 'menu':
        if (touched.exampleId === HUB_ID) {
          return this.hub(eventId, inbound, touched, 1);
        }
        return this.run(eventId, touched, inbound, 'menu', (example, ctx) =>
          example.onMenu === undefined ? example.onStart(ctx, inbound) : example.onMenu(ctx),
        );
      case 'none':
        if (touched.exampleId === HUB_ID) {
          return this.hub(eventId, inbound, touched, 1);
        }
        return this.run(eventId, touched, inbound, 'message', (example, ctx) =>
          example.onMessage(ctx, inbound),
        );
    }
  }

  private async start(
    eventId: string,
    inbound: Inbound,
    exampleId: string,
    current: SessionRecord | undefined,
  ): Promise<RouteOutcome> {
    const example = this.examples.get(exampleId);
    if (example === undefined) {
      return { status: 'ignored', reason: `unknown example ${exampleId}` };
    }
    if (current !== undefined && current.exampleId !== HUB_ID) {
      await this.endSession(current, current.exampleId === exampleId ? 'ended' : 'switched', eventId);
    } else if (current === undefined) {
      void this.acknowledge(inbound);
    }
    const now = this.clock();
    // `current` was already touched by handleInbound; a brand-new person is touched here.
    const base = current ?? this.touch(this.newSession(inbound, HUB_ID, now), inbound, now);
    const session: SessionRecord = {
      ...base,
      sessionId: randomUUID(),
      exampleId,
      state: example.initialState(),
      startedAt: now,
      meta: {
        ...EMPTY_META,
        contactUuid: base.meta.contactUuid,
        displayName: base.meta.displayName,
        turns: 1,
      },
    };
    this.options.store.setOptedOut(session.address, false, now);
    this.log.info('demo started', { example: exampleId, user: maskPhone(session.address) });
    return this.run(eventId, session, inbound, 'start', (target, ctx) => target.onStart(ctx, inbound));
  }

  private async hub(
    eventId: string,
    inbound: Inbound,
    current: SessionRecord | undefined,
    page: number,
  ): Promise<RouteOutcome> {
    const now = this.clock();
    const session = current ?? this.touch(this.newSession(inbound, HUB_ID, now), inbound, now);
    if (current === undefined) {
      void this.acknowledge(inbound);
    }
    const examples = [...this.examples.values()];
    const perPage = examples.length > 10 ? 9 : 10;
    const pages = Math.max(1, Math.ceil(examples.length / perPage));
    const index = Math.min(Math.max(1, page), pages);
    const shown = examples.slice((index - 1) * perPage, index * perPage);
    const rows = shown.map((example) => {
      const description = example.describe();
      return {
        id: `${RESERVED_IDS.startPrefix}${example.id}`,
        title: description.emoji === undefined ? example.title : `${description.emoji} ${example.title}`,
        description: description.summary,
      };
    });
    if (index < pages) {
      rows.push({
        id: `${RESERVED_IDS.hub}:${index + 1}`,
        title: 'More demos',
        description: `Page ${index + 1} of ${pages}`,
      });
    }
    try {
      await this.options.api.messages.send(
        {
          type: 'interactive',
          ...recipientFor(session.address),
          ...(this.deps.phoneNumberId === null ? {} : { phone_number_id: this.deps.phoneNumberId }),
          interactive: ui.list({
            header: 'LazyApp live demos',
            body:
              'Real WhatsApp apps built on the LazyApp API, running on this number. Pick one to try it.\n\n' +
              'Type *MENU* any time for the demo menu, *EXIT* to leave, or *STOP* to opt out.',
            footer: 'Built with lazyapp.in',
            button: 'Choose a demo',
            sections: [{ title: 'Demos', rows }],
          }),
          metadata: { demo: HUB_ID },
        },
        { idempotencyKey: `${eventId}:hub` },
      );
    } catch (error) {
      this.log.error('could not send the demo hub', { error, user: maskPhone(session.address) });
    }
    this.options.store.saveSession({ ...session, updatedAt: now });
    return { status: 'handled', exampleId: session.exampleId, action: 'hub' };
  }

  private async leave(eventId: string, session: SessionRecord, kind: 'exit' | 'stop'): Promise<RouteOutcome> {
    const example = this.examples.get(session.exampleId);
    const restart = example?.startCode ?? 'DEMO';
    const body =
      kind === 'exit'
        ? `Thanks for trying ${example?.title ?? 'the LazyApp demos'}! Send *${restart}* to start again, or *DEMO* to see every demo.`
        : `You're opted out and the demo has ended. We won't message you again. If you ever want to try again, send *${restart}*.`;
    try {
      await this.options.api.messages.send(
        {
          type: 'text',
          ...recipientFor(session.address),
          ...(this.deps.phoneNumberId === null ? {} : { phone_number_id: this.deps.phoneNumberId }),
          body,
          metadata: { demo: session.exampleId },
        },
        { idempotencyKey: `${eventId}:${kind}` },
      );
    } catch (error) {
      this.log.warn('could not send the goodbye', { error, user: maskPhone(session.address) });
    }
    await this.endSession(session, kind, eventId);
    if (kind === 'stop') {
      this.options.store.setOptedOut(session.address, true, this.clock());
    }
    return { status: 'handled', exampleId: session.exampleId, action: kind };
  }

  // --- Other webhook events ----------------------------------------------------

  private async handleEvent(event: WebhookEnvelope): Promise<RouteOutcome> {
    const address = eventAddress(event);
    if (address === null) {
      return { status: 'ignored', reason: `${event.type} is not about a person` };
    }
    const session = this.options.store.getSession(address);
    if (session === undefined || session.exampleId === HUB_ID || this.isExpired(session, this.clock())) {
      return { status: 'ignored', reason: 'not in a demo' };
    }
    const example = this.examples.get(session.exampleId);
    if (
      example?.onEvent === undefined ||
      !(example.manifest.webhookEvents ?? []).includes(event.type as WebhookEventType)
    ) {
      return { status: 'ignored', reason: `${session.exampleId} does not handle ${event.type}` };
    }
    // Message status events fire for the whole workspace; only follow this example's own sends.
    const message = event.type.startsWith('message.')
      ? (event.data.message as { metadata?: unknown } | undefined)
      : undefined;
    if (
      message !== undefined &&
      (message.metadata as Record<string, unknown> | null | undefined)?.demo !== example.id
    ) {
      return { status: 'ignored', reason: 'message was not sent by this demo' };
    }
    return this.run(
      event.id,
      session,
      null,
      'event',
      (target, ctx) => target.onEvent?.(ctx, event) ?? Promise.resolve(),
    );
  }

  // --- Plumbing -----------------------------------------------------------------

  /**
   * Runs one handler with a fresh context, then persists. An event already applied to
   * the session is skipped, so state changes happen exactly once. If the process died
   * after sending but before saving, the replay re-runs from the old state and its
   * deterministic idempotency keys make LazyApp return the original sends.
   */
  private async run(
    eventId: string,
    session: SessionRecord,
    inbound: Inbound | null,
    action: 'start' | 'message' | 'menu' | 'event',
    handler: (example: AnyExample, ctx: AnyExampleContext) => Promise<void>,
  ): Promise<RouteOutcome> {
    const example = this.examples.get(session.exampleId);
    if (example === undefined) {
      this.options.store.deleteSession(session.address);
      return { status: 'ignored', reason: `example ${session.exampleId} is no longer registered` };
    }
    if (session.meta.recentEvents.includes(eventId)) {
      return { status: 'ignored', reason: 'event already applied to this session' };
    }
    const turn: Turn<unknown> = {
      state: this.loadState(example, session),
      meta: session.meta,
      ended: false,
      sends: 0,
    };
    const remember = (meta: SessionRecord['meta']) => ({
      ...meta,
      recentEvents: [...meta.recentEvents.slice(-19), eventId],
    });
    const ctx = createContext({
      deps: this.deps,
      example,
      session,
      turn,
      eventId,
      inbound,
      onEnd: async () => undefined,
    });
    try {
      await handler(example, ctx);
    } catch (error) {
      this.options.store.saveSession({ ...session, meta: remember(turn.meta), updatedAt: this.clock() });
      return {
        status: 'handled',
        exampleId: example.id,
        action,
        error: await this.recover(eventId, session, error),
      };
    }
    const saved: SessionRecord = {
      ...session,
      state: turn.state,
      meta: remember(turn.meta),
      updatedAt: this.clock(),
    };
    if (turn.ended) {
      await this.endSession(saved, 'ended', eventId);
    } else {
      this.options.store.saveSession(saved);
    }
    return { status: 'handled', exampleId: example.id, action };
  }

  /** Logs a failed handler and, when a reply can still land, apologises once. */
  private async recover(eventId: string, session: SessionRecord, error: unknown): Promise<string> {
    const message = error instanceof Error ? error.message : String(error);
    const user = maskPhone(session.address);
    if (error instanceof ServiceWindowClosedError) {
      this.log.warn('handler tried to send outside the 24h window', { example: session.exampleId, user });
      return message;
    }
    if (error instanceof LazyAppNetworkError || (error instanceof LazyAppError && error.retryable)) {
      // LazyApp is unreachable after the SDK's retries: an apology would fail the same way.
      this.log.error('LazyApp unavailable while handling a message', {
        example: session.exampleId,
        user,
        error,
      });
      return message;
    }
    if (error instanceof LazyAppRefusalError) {
      this.log.warn('LazyApp refused a send', { example: session.exampleId, user, code: error.code, error });
      return message;
    }
    this.log.error('example handler failed', { example: session.exampleId, user, error });
    try {
      await this.options.api.messages.send(
        {
          type: 'text',
          ...recipientFor(session.address),
          ...(this.deps.phoneNumberId === null ? {} : { phone_number_id: this.deps.phoneNumberId }),
          body: 'Sorry, something went wrong on our side. Type *MENU* to carry on or *EXIT* to leave the demo.',
          metadata: { demo: session.exampleId },
        },
        { idempotencyKey: `${eventId}:error` },
      );
    } catch (apologyError) {
      this.log.warn('could not send the apology', { error: apologyError, user });
    }
    return message;
  }

  /** Cancels follow-ups, runs `onEnd`, deletes the session. Never sends a message. */
  private async endSession(session: SessionRecord, reason: EndReason, eventId: string): Promise<void> {
    const example = this.examples.get(session.exampleId);
    for (const followUp of Object.values(session.meta.followUps)) {
      try {
        await this.options.api.messages.cancelScheduled(followUp.id);
      } catch (error) {
        if (!(error instanceof LazyAppNotFoundError)) {
          this.log.warn('could not cancel a follow-up', { error, user: maskPhone(session.address) });
        }
      }
    }
    if (example?.onEnd !== undefined) {
      const turn: Turn<unknown> = {
        state: this.loadState(example, session),
        meta: session.meta,
        ended: true,
        sends: 0,
      };
      const ctx = createContext({
        deps: this.deps,
        example,
        session,
        turn,
        eventId: `${eventId}:end`,
        inbound: null,
        onEnd: async () => undefined,
      });
      try {
        await example.onEnd(ctx, reason);
      } catch (error) {
        this.log.warn('onEnd failed', { example: example.id, error });
      }
    }
    this.options.store.deleteSession(session.address);
    this.log.info('demo ended', { example: session.exampleId, reason, user: maskPhone(session.address) });
  }

  private loadState(example: AnyExample, session: SessionRecord): unknown {
    if (example.stateSchema === undefined) {
      return session.state ?? example.initialState();
    }
    const parsed = example.stateSchema.safeParse(session.state);
    if (parsed.success) {
      return parsed.data;
    }
    this.log.warn('stored state no longer matches the schema; resetting', { example: example.id });
    return example.initialState();
  }

  private newSession(inbound: Inbound, exampleId: string, now: Date): SessionRecord {
    return {
      address: inbound.from,
      sessionId: randomUUID(),
      exampleId,
      state: null,
      meta: EMPTY_META,
      startedAt: now,
      lastInboundAt: now,
      updatedAt: now,
    };
  }

  private touch(session: SessionRecord, inbound: Inbound, now: Date): SessionRecord {
    const contact = inbound.raw.contact;
    return {
      ...session,
      lastInboundAt: now,
      meta: {
        ...session.meta,
        contactUuid: contact?.uuid ?? session.meta.contactUuid,
        displayName: contact?.username ?? session.meta.displayName,
        turns: session.meta.turns + 1,
      },
    };
  }

  private isExpired(session: SessionRecord, now: Date): boolean {
    return now.getTime() - session.lastInboundAt.getTime() >= this.idleMs;
  }

  /** Blue ticks and "typing…" while the handler works. Best effort: never blocks a reply. */
  private async acknowledge(inbound: Inbound): Promise<void> {
    if (!this.autoMarkRead) {
      return;
    }
    try {
      await this.options.api.messages.markRead(inbound.uuid, { typing: true });
    } catch (error) {
      this.log.debug('mark read failed', { error });
    }
  }
}

/** Who an event is about, as a session address. */
export function eventAddress(event: WebhookEnvelope): string | null {
  const data = event.data;
  const pick = (value: unknown): string | null =>
    typeof value === 'string' ? normalizeAddress(value) : null;
  const field = (key: string, inner: string): unknown =>
    typeof data[key] === 'object' && data[key] !== null
      ? (data[key] as Record<string, unknown>)[inner]
      : undefined;

  if (event.type === 'message.received' || event.type === 'commerce.order') {
    return pick(field(event.type === 'commerce.order' ? 'order' : 'message', 'from'));
  }
  if (event.type.startsWith('message.')) {
    return pick(field('message', 'to'));
  }
  if (event.type.startsWith('payment.')) {
    return pick(field('payment', 'to'));
  }
  if (event.type === 'flow.response_received') {
    return pick(field('flow_response', 'contact'));
  }
  if (event.type === 'address.received') {
    return pick(field('address', 'contact'));
  }
  if (event.type.startsWith('contact.')) {
    return pick(field('contact', 'phone_number'));
  }
  return null;
}
