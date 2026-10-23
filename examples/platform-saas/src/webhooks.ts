import { randomUUID } from 'node:crypto';
import { maskPhone } from '@lazyapp-examples/demo-kit';
import { webhookCustomer } from '@lazyapp-examples/sdk';
import type { WebhookEnvelope } from '@lazyapp-examples/sdk';
import type { ActivityEntry, SalonRecord, SalonStore, SeedSalon } from './salons.js';

/** The platform events SalonBook acts on. Subscribe the platform webhook endpoint to exactly these. */
export const PLATFORM_EVENTS = [
  'customer.connected',
  'customer.usage_alert',
  'setup_link.failed',
  'connection.attention_required',
  'connection.disconnected',
  'message.received',
] as const;
export type PlatformEvent = (typeof PLATFORM_EVENTS)[number];

/** Events the admin page can simulate, because Embedded Signup cannot complete in test mode. */
export const SIMULATED_EVENTS = [
  'customer.connected',
  'customer.usage_alert',
  'setup_link.failed',
  'message.received',
] as const satisfies readonly PlatformEvent[];
export type SimulatedEvent = (typeof SIMULATED_EVENTS)[number];

export type ApplyOutcome =
  | { readonly status: 'applied'; readonly salon: string; readonly type: string }
  | { readonly status: 'ignored'; readonly reason: string };

/**
 * Routes one platform delivery to the salon it is about, by the `customer` envelope, and updates
 * SalonBook's record. Only metadata is kept: a message from a salon's client is stored as "Inbound text
 * from +91******5670", never its body.
 */
export function applyPlatformEvent(
  store: SalonStore,
  event: WebhookEnvelope,
  source: ActivityEntry['source'],
  now: Date,
): ApplyOutcome {
  const customer = webhookCustomer(event);
  if (customer === null) {
    return { status: 'ignored', reason: 'no customer envelope: not about a salon' };
  }
  const salon = store.byCustomer(customer);
  if (salon === undefined) {
    return { status: 'ignored', reason: 'unknown customer' };
  }
  if (!(PLATFORM_EVENTS as readonly string[]).includes(event.type)) {
    return { status: 'ignored', reason: `${event.type} is not handled` };
  }
  const at = now.toISOString();
  const type = event.type as PlatformEvent;
  store.update(salon, (record) => transition(record, type, event.data, at));
  store.addActivity(salon, { at, type, source, summary: summarise(type, event.data) });
  return { status: 'applied', salon: salon.slug, type };
}

function transition(
  record: SalonRecord,
  type: PlatformEvent,
  data: Readonly<Record<string, unknown>>,
  at: string,
): SalonRecord {
  switch (type) {
    case 'customer.connected':
      return {
        ...record,
        connection: 'connected',
        connectedNumber: connectedNumber(data) ?? record.connectedNumber,
        failureReason: null,
      };
    case 'setup_link.failed':
      return { ...record, connection: 'failed', failureReason: failureReason(data) };
    case 'connection.attention_required':
    case 'connection.disconnected':
      return { ...record, connection: 'attention' };
    case 'customer.usage_alert':
      return { ...record, usageAlert: { at, detail: summarise(type, data) } };
    case 'message.received':
      return record;
  }
}

function summarise(type: PlatformEvent, data: Readonly<Record<string, unknown>>): string {
  switch (type) {
    case 'customer.connected': {
      const number = connectedNumber(data);
      return number === null ? 'WhatsApp connected' : `WhatsApp connected: ${number}`;
    }
    case 'setup_link.failed':
      return `Setup failed: ${failureReason(data)}`;
    case 'connection.attention_required':
      return 'The number needs attention: send a reconnect link';
    case 'connection.disconnected':
      return 'The number was disconnected: send a reconnect link';
    case 'customer.usage_alert': {
      const spend = pick(data, 'usage', 'total_charge') ?? pick(data, 'total_charge');
      return typeof spend === 'string' || typeof spend === 'number'
        ? `Spend crossed the alert threshold (₹${spend})`
        : 'Spend crossed the alert threshold';
    }
    case 'message.received': {
      const message = record(data.message);
      const from = typeof message?.from === 'string' ? maskPhone(message.from) : 'a client';
      const kind = typeof message?.type === 'string' ? message.type : 'message';
      return `Inbound ${kind} from ${from}`;
    }
  }
}

function connectedNumber(data: Readonly<Record<string, unknown>>): string | null {
  const value =
    pick(data, 'connection', 'display_phone_number') ??
    pick(data, 'customer', 'connections', 'display_phone_number') ??
    pick(data, 'display_phone_number');
  return typeof value === 'string' && value !== '' ? value : null;
}

function failureReason(data: Readonly<Record<string, unknown>>): string {
  const value =
    pick(data, 'reason') ?? pick(data, 'error') ?? pick(data, 'setup_link', 'failure_reason') ?? null;
  return typeof value === 'string' && value !== '' ? value.slice(0, 200) : 'Embedded Signup did not finish';
}

function pick(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const next = Array.isArray(current) ? record(current[0]) : record(current);
    current = next?.[key];
  }
  return current;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * A sample delivery with the same envelope LazyApp sends, for the admin page's "simulate" buttons.
 * Marked `source: simulated` everywhere it shows up; never sent to or from LazyApp.
 */
export function sampleEvent(
  type: SimulatedEvent,
  salon: SeedSalon,
  customer: { readonly id: string; readonly externalId: string },
  now: Date,
): WebhookEnvelope {
  const data: Record<string, unknown> = {
    'customer.connected': { connection: { display_phone_number: '+91 80 4718 2290', status: 'active' } },
    'customer.usage_alert': { usage: { period: now.toISOString().slice(0, 7), total_charge: '52.40' } },
    'setup_link.failed': { reason: 'The salon closed Meta’s signup window before choosing a number.' },
    'message.received': {
      message: { type: 'text', direction: 'inbound', from: '+919812345670', to: '+918047182290' },
    },
  }[type];
  return {
    id: `sim_${randomUUID()}`,
    type,
    created_at: now.toISOString(),
    customer: { id: customer.id, external_id: customer.externalId, name: salon.name },
    data,
  };
}
