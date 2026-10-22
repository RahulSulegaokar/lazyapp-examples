import { randomBytes } from 'node:crypto';
import { LazyAppNotFoundError } from '@lazyapp-examples/sdk';
import type {
  LazyAppClient,
  OutboundMessage,
  Recipient,
  SentMessage,
  WriteOptions,
} from '@lazyapp-examples/sdk';
import { ConsentRequiredError, FlowUnavailableError, ServiceWindowClosedError } from './example.js';
import type { DemoUser, Example, ExampleContext, FlowSendInput, FollowUpInput } from './example.js';
import type { Inbound } from './inbound.js';
import { isPhoneAddress } from './inbound.js';
import type { Logger } from './logger.js';
import type { CapabilityDirectory, FlowDirectory } from './services.js';
import { flowName } from './services.js';
import type { DemoStore, SessionMeta, SessionRecord } from './store.js';
import * as ui from './ui.js';

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Everything a context needs from the router. */
export interface ContextDeps {
  readonly api: LazyAppClient;
  readonly store: DemoStore;
  readonly flows: FlowDirectory;
  readonly capabilities: CapabilityDirectory;
  readonly clock: () => Date;
  readonly log: Logger;
  readonly publicBaseUrl: string;
  readonly phoneNumberId: string | null;
  readonly allowDraftFlows: boolean;
  readonly flowTokenTtlMs: number;
}

/** Mutable bookkeeping for one handler invocation; the router persists it afterwards. */
export interface Turn<S> {
  state: S;
  meta: SessionMeta;
  ended: boolean;
  sends: number;
}

/** Recipient fields for a session address: `to` for phones, `recipient` for business-scoped ids. */
export function recipientFor(address: string): { to: string } | { recipient: Recipient } {
  return isPhoneAddress(address) ? { to: address } : { recipient: { type: 'bsuid', value: address } };
}

export function userFor(session: SessionRecord): DemoUser {
  return {
    address: session.address,
    phone: isPhoneAddress(session.address) ? session.address : null,
    displayName: session.meta.displayName,
    contactUuid: session.meta.contactUuid,
  };
}

/**
 * Builds the `ctx` an example handler receives. All I/O goes through `deps`, so
 * the same code runs against LazyApp in production and the fake API in tests.
 */
export function createContext<S>(input: {
  readonly deps: ContextDeps;
  readonly example: Example<S>;
  readonly session: SessionRecord;
  readonly turn: Turn<S>;
  /** Event id: the root of every idempotency key in this turn. */
  readonly eventId: string;
  readonly inbound: Inbound | null;
  readonly onEnd: () => Promise<void>;
}): ExampleContext<S> {
  const { deps, example, session, turn, eventId, inbound } = input;
  const now = deps.clock;
  const log = deps.log.child({ example: example.id, session: session.sessionId });
  const recipient = recipientFor(session.address);
  const windowOpen = now().getTime() - session.lastInboundAt.getTime() < SERVICE_WINDOW_MS;
  const keyFor = (label: string): string => `${eventId}:${example.id}:${label}`;
  const metadata = { demo: example.id, session: session.sessionId };

  const deliver = async (message: OutboundMessage, options?: WriteOptions): Promise<SentMessage> => {
    if (!windowOpen && message.type !== 'template') {
      throw new ServiceWindowClosedError();
    }
    turn.sends += 1;
    const body = {
      ...message,
      ...recipient,
      ...(deps.phoneNumberId === null ? {} : { phone_number_id: deps.phoneNumberId }),
      metadata: { ...metadata, ...message.metadata },
    } as OutboundMessage;
    return deps.api.messages.send(body, {
      idempotencyKey: options?.idempotencyKey ?? keyFor(`send:${turn.sends}`),
    });
  };

  const interactive = (value: Parameters<ExampleContext<S>['send']['interactive']>[0]) =>
    deliver({ type: 'interactive', interactive: value });

  const ctx: ExampleContext<S> = {
    example: { id: example.id, title: example.title, startCode: example.startCode },
    user: userFor({ ...session, meta: turn.meta }),
    session: {
      id: session.sessionId,
      startedAt: session.startedAt,
      lastInboundAt: session.lastInboundAt,
      turns: turn.meta.turns,
      windowOpen,
      marketingOptIn: turn.meta.marketingOptIn,
    },
    get state() {
      return turn.state;
    },
    setState(next) {
      turn.state = typeof next === 'function' ? (next as (previous: Readonly<S>) => S)(turn.state) : next;
    },
    send: {
      text: (body, options) =>
        deliver({
          type: 'text',
          body,
          ...(options?.previewUrl === undefined ? {} : { preview_url: options.previewUrl }),
          ...(options?.replyTo === undefined ? {} : { context: { message_id: options.replyTo } }),
        }),
      buttons: (value) => interactive(ui.buttons(value)),
      list: (value) => interactive(ui.list(value)),
      cta: (value) => interactive(ui.cta(value)),
      image: (url, caption) =>
        deliver({ type: 'image', media_url: url, ...(caption === undefined ? {} : { caption }) }),
      video: (url, caption) =>
        deliver({ type: 'video', media_url: url, ...(caption === undefined ? {} : { caption }) }),
      audio: (url) => deliver({ type: 'audio', media_url: url }),
      document: (url, filename, caption) =>
        deliver({
          type: 'document',
          media_url: url,
          filename,
          ...(caption === undefined ? {} : { caption }),
        }),
      sticker: (url) => deliver({ type: 'sticker', media_url: url }),
      location: (value) => deliver({ type: 'location', ...value }),
      locationRequest: (body) => interactive(ui.locationRequest(body)),
      contacts: (cards) => deliver({ type: 'contacts', contacts: cards }),
      react: async (emoji, wamid) => {
        const target = wamid ?? inbound?.wamid ?? null;
        return target === null
          ? null
          : deliver({ type: 'reaction', reaction: { message_id: target, emoji } });
      },
      interactive,
      template: (template) => deliver({ type: 'template', template }),
      typing: async () => {
        if (inbound === null) {
          return;
        }
        try {
          await deps.api.messages.markRead(inbound.uuid, { typing: true });
        } catch (error) {
          log.debug('typing indicator failed', { error });
        }
      },
    },
    flows: {
      isAvailable: async (key) => (await resolveFlow(key)) !== null,
      send: async (value: FlowSendInput) => {
        const spec = example.manifest.flows?.find((flow) => flow.key === value.key);
        const flow = await resolveFlow(value.key);
        if (spec === undefined || flow === null) {
          throw new FlowUnavailableError(
            value.key,
            spec === undefined ? 'not in the manifest' : 'not provisioned or not published',
          );
        }
        if (value.screen === undefined && !spec.dataExchange) {
          throw new FlowUnavailableError(value.key, 'a navigate flow needs a first `screen`');
        }
        const token = `${example.id}.${randomBytes(18).toString('base64url')}`;
        deps.store.saveFlowToken(
          {
            token,
            address: session.address,
            exampleId: example.id,
            flowKey: value.key,
            sessionId: session.sessionId,
            expiresAt: new Date(now().getTime() + deps.flowTokenTtlMs),
          },
          now(),
        );
        const hasData = value.data !== undefined && Object.keys(value.data).length > 0;
        const message = await interactive({
          type: 'flow',
          ...(value.header === undefined ? {} : { header: ui.header(value.header) }),
          body: { text: ui.fit(value.body, 1024) },
          ...(value.footer === undefined ? {} : { footer: { text: ui.fit(value.footer, 60) } }),
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_id: flow.id,
              flow_token: token,
              flow_cta: ui.fit(value.cta, 20),
              flow_action: value.screen === undefined ? 'data_exchange' : 'navigate',
              ...(value.screen === undefined
                ? {}
                : {
                    flow_action_payload: { screen: value.screen, ...(hasData ? { data: value.data } : {}) },
                  }),
              ...(flow.draft ? { mode: 'draft' as const } : {}),
            },
          },
        });
        return { token, message };
      },
    },
    capabilities: {
      catalog: () => deps.capabilities.catalog(),
      payments: () => deps.capabilities.payments(),
    },
    followUps: {
      schedule: async (value: FollowUpInput) => {
        if (value.category === 'marketing' && !turn.meta.marketingOptIn) {
          throw new ConsentRequiredError(`Follow-up "${value.key}"`);
        }
        await cancelFollowUp(value.key);
        const scheduled = await deps.api.messages.schedule(
          {
            type: 'template',
            ...recipient,
            ...(deps.phoneNumberId === null ? {} : { phone_number_id: deps.phoneNumberId }),
            template: value.template,
            send_at: value.sendAt.toISOString(),
            metadata: { ...metadata, follow_up: value.key },
          },
          { idempotencyKey: keyFor(`follow-up:${value.key}`) },
        );
        turn.meta = {
          ...turn.meta,
          followUps: {
            ...turn.meta.followUps,
            [value.key]: { id: scheduled.id, category: value.category, sendAt: value.sendAt.toISOString() },
          },
        };
      },
      cancel: (key) => cancelFollowUp(key),
    },
    consent: {
      get marketingOptIn() {
        return turn.meta.marketingOptIn;
      },
      optInToMarketing: async (consentText) => {
        turn.meta = { ...turn.meta, marketingOptIn: true };
        deps.store.setOptedOut(session.address, false, now());
        await recordConsent(true, consentText);
      },
      optOutOfMarketing: async () => {
        turn.meta = { ...turn.meta, marketingOptIn: false };
        for (const [key, followUp] of Object.entries(turn.meta.followUps)) {
          if (followUp.category === 'marketing') {
            await cancelFollowUp(key);
          }
        }
        await recordConsent(false, 'Opted out in the demo chat');
      },
    },
    kv: deps.store.keyValue(`example:${example.id}`, now),
    api: deps.api,
    idempotencyKey: keyFor,
    end: async () => {
      turn.ended = true;
      await input.onEnd();
    },
    now,
    log,
    config: { publicBaseUrl: deps.publicBaseUrl, phoneNumberId: deps.phoneNumberId },
  };

  async function resolveFlow(key: string): Promise<{ id: string; draft: boolean } | null> {
    const flow = await deps.flows.find(flowName(example.id, key));
    if (flow?.provider_flow_id === null || flow?.provider_flow_id === undefined) {
      return null;
    }
    const status = flow.status.toLowerCase();
    if (status === 'published') {
      return { id: flow.provider_flow_id, draft: false };
    }
    return status === 'draft' && deps.allowDraftFlows ? { id: flow.provider_flow_id, draft: true } : null;
  }

  async function cancelFollowUp(key: string): Promise<void> {
    const existing = turn.meta.followUps[key];
    if (existing === undefined) {
      return;
    }
    try {
      await deps.api.messages.cancelScheduled(existing.id);
    } catch (error) {
      if (!(error instanceof LazyAppNotFoundError)) {
        throw error;
      }
    }
    const { [key]: _removed, ...rest } = turn.meta.followUps;
    turn.meta = { ...turn.meta, followUps: rest };
  }

  async function recordConsent(granted: boolean, consentText: string): Promise<void> {
    if (turn.meta.contactUuid === null) {
      return;
    }
    try {
      await deps.api.contacts.recordConsent(
        turn.meta.contactUuid,
        {
          granted,
          channel: 'whatsapp',
          purpose: 'marketing',
          consent_text: consentText,
          captured_by: `lazyapp-examples:${example.id}`,
        },
        { idempotencyKey: keyFor(`consent:${String(granted)}`) },
      );
    } catch (error) {
      log.warn('could not record consent on the LazyApp contact', { error });
    }
  }

  return ctx;
}
