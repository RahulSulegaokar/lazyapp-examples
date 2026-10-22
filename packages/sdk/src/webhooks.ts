import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PaymentOrder } from './types.js';

/**
 * Verifies `X-LazyApp-Signature` (`sha256=` + hex HMAC-SHA256 of the raw body).
 * Pass the bytes exactly as received: re-serialised JSON never matches.
 * The comparison is constant-time and never throws on a malformed header.
 *
 * Also verifies the data_exchange requests LazyApp forwards to a flow's
 * `data_endpoint_uri` (same header, keyed by that flow's signing secret).
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (header === null || header === undefined || secret === '') {
    return false;
  }
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    'utf8',
  );
  const received = Buffer.from(header.trim().toLowerCase(), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Produces a valid signature header; for tests and local replays. */
export function signWebhookBody(rawBody: string | Uint8Array, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export const WEBHOOK_HEADERS = {
  signature: 'x-lazyapp-signature',
  event: 'x-lazyapp-event',
  delivery: 'x-lazyapp-delivery',
  apiVersion: 'x-lazyapp-api-version',
} as const;

/** Every event type LazyApp can deliver (from LazyApp's `CustomerWebhookEvent` enum). */
export const WEBHOOK_EVENT_TYPES = [
  'message.received',
  'message.queued',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.played',
  'message.failed',
  'message.deleted',
  'message.edited',
  'message.echo',
  'reaction.received',
  'conversation.started',
  'commerce.order',
  'address.received',
  'payment.captured',
  'payment.failed',
  'payment.refunded',
  'payment.order_status_updated',
  'template.pending',
  'template.approved',
  'template.rejected',
  'template.paused',
  'template.disabled',
  'template.category_changed',
  'template.quality_changed',
  'template.updated',
  'template.deleted',
  'marketing.link_clicked',
  'otp.requested',
  'otp.verified',
  'otp.failed',
  'contact.updated',
  'contact.opted_in',
  'contact.opted_out',
  'contact.identity_changed',
  'phone_number.updated',
  'phone_number.quality_changed',
  'connection.connected',
  'connection.attention_required',
  'connection.disconnected',
  'account.updated',
  'flow.published',
  'flow.failed',
  'flow.response_received',
  'flow.status_changed',
  'workflow.started',
  'workflow.completed',
  'workflow.failed',
  'campaign.started',
  'campaign.completed',
  'campaign.failed',
  'conversion.detected',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** `data.message` on every `message.*` event. */
export interface WebhookMessage {
  readonly uuid: string;
  readonly conversation_id: string | null;
  readonly direction: 'inbound' | 'outbound';
  readonly status: string;
  /** `text`, `image`, `interactive`, `button`, `location`, `order`, `reaction`, … */
  readonly type: string;
  readonly to: string | null;
  readonly from: string | null;
  readonly contact: {
    readonly uuid: string;
    readonly phone_number: string | null;
    readonly bsuid: string | null;
    readonly username: string | null;
  } | null;
  readonly body: string | null;
  readonly provider_message_id: string | null;
  readonly error_message: string | null;
  /** Structured parts: `interactive`, `button`, `location`, `order`, `image`, `context`, `referral`, … */
  readonly content: Readonly<Record<string, unknown>> | null;
  readonly request_id: string | null;
  readonly group: { readonly uuid: string | null; readonly provider_group_id: string | null } | null;
  readonly metadata: Readonly<Record<string, string>> | null;
  readonly provider_timestamp: string | null;
  readonly created_at: string | null;
}

export interface WebhookFlowResponse {
  readonly uuid: string;
  readonly flow_uuid: string | null;
  readonly flow_name: string | null;
  readonly flow_token: string | null;
  /** The contact's phone number. */
  readonly contact: string | null;
  readonly message_uuid: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WebhookAddress {
  readonly message_uuid: string;
  readonly contact: string;
  readonly contact_uuid: string | null;
  readonly saved_address_id: string | null;
  readonly values: Readonly<Record<string, string>>;
  readonly summary: string | null;
}

export interface WebhookReaction {
  readonly emoji: string | null;
  readonly action: 'added' | 'removed';
  readonly platform_message_id: string | null;
  readonly message_uuid: string | null;
  readonly conversation_id: string | null;
}

/** Maps event types to their `data` key and payload, for the events examples consume. */
export interface WebhookDataByType {
  'message.received': { readonly message: WebhookMessage };
  'message.sent': { readonly message: WebhookMessage };
  'message.delivered': { readonly message: WebhookMessage };
  'message.read': { readonly message: WebhookMessage };
  'message.played': { readonly message: WebhookMessage };
  'message.failed': { readonly message: WebhookMessage };
  'reaction.received': { readonly reaction: WebhookReaction };
  'commerce.order': { readonly order: WebhookMessage };
  'address.received': { readonly address: WebhookAddress };
  'flow.response_received': { readonly flow_response: WebhookFlowResponse };
  'payment.captured': { readonly payment: PaymentOrder };
  'payment.failed': { readonly payment: PaymentOrder };
  'payment.refunded': { readonly payment: PaymentOrder };
  'payment.order_status_updated': { readonly payment: PaymentOrder };
}

/** An event whose `data` is typed. Narrow a parsed envelope with `isEventType`. */
export type TypedWebhookEvent<K extends keyof WebhookDataByType = keyof WebhookDataByType> = {
  [T in K]: WebhookEnvelope & { readonly type: T; readonly data: WebhookDataByType[T] };
}[K];

const envelopeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  created_at: z.string().nullish(),
  test: z.boolean().optional(),
  customer: z.looseObject({ id: z.string().nullish(), external_id: z.string().nullish() }).nullish(),
  data: z.record(z.string(), z.unknown()),
});

export type WebhookEnvelope = z.infer<typeof envelopeSchema>;

export class WebhookPayloadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebhookPayloadError';
  }
}

/**
 * Parses a verified delivery body into a typed event. Validates the envelope
 * only: payloads are forward-compatible and unknown fields are kept.
 */
export function parseWebhookEvent(rawBody: string): WebhookEnvelope {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch (error) {
    throw new WebhookPayloadError('Webhook body is not JSON', { cause: error });
  }
  const result = envelopeSchema.safeParse(decoded);
  if (!result.success) {
    throw new WebhookPayloadError(`Webhook envelope is invalid: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Narrows an event to one of the typed kinds. */
export function isEventType<K extends keyof WebhookDataByType>(
  event: { readonly type: string },
  type: K,
): event is TypedWebhookEvent<K> {
  return event.type === type;
}

/** `POST /v1/webhooks/{id}/test` deliveries are flagged; never act on them. */
export function isTestDelivery(event: WebhookEnvelope): boolean {
  return event.test === true || event.id.startsWith('evt_test_');
}
