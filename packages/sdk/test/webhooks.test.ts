import { describe, expect, it } from 'vitest';
import {
  isEventType,
  isTestDelivery,
  parseWebhookEvent,
  signWebhookBody,
  verifyWebhookSignature,
  WebhookPayloadError,
} from '../src/index.js';

const secret = 'whsec_test';
const body = JSON.stringify({
  id: 'evt_1',
  type: 'payment.captured',
  created_at: '2026-10-23T10:00:00+00:00',
  data: { payment: { id: 'pay_1', reference_id: 'order-1', payment_status: 'captured' } },
});

describe('verifyWebhookSignature', () => {
  it('accepts the documented sha256=<hex hmac> over the raw body', () => {
    const header = signWebhookBody(body, secret);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(body, header, secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(body), header, secret)).toBe(true);
  });

  it('rejects a tampered body, wrong secret, missing or malformed header', () => {
    const header = signWebhookBody(body, secret);
    expect(verifyWebhookSignature(`${body} `, header, secret)).toBe(false);
    expect(verifyWebhookSignature(body, header, 'other')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=short', secret)).toBe(false);
    expect(verifyWebhookSignature(body, header, '')).toBe(false);
  });

  it('is not fooled by re-serialised JSON', () => {
    const header = signWebhookBody(body, secret);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWebhookSignature(reserialised, header, secret)).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('parses the envelope and narrows typed events', () => {
    const event = parseWebhookEvent(body);
    expect(event.id).toBe('evt_1');
    expect(isTestDelivery(event)).toBe(false);
    if (!isEventType(event, 'payment.captured')) {
      throw new Error('expected payment.captured');
    }
    expect(event.data.payment.reference_id).toBe('order-1');
  });

  it('keeps unknown fields for forward compatibility', () => {
    const event = parseWebhookEvent(
      JSON.stringify({ id: 'evt_2', type: 'brand.new', data: { x: 1 }, extra: true }),
    );
    expect(event).toMatchObject({ type: 'brand.new', extra: true });
  });

  it('flags test deliveries', () => {
    expect(
      isTestDelivery(parseWebhookEvent(JSON.stringify({ id: 'evt_test_1', type: 'message.sent', data: {} }))),
    ).toBe(true);
  });

  it('throws a typed error on garbage', () => {
    expect(() => parseWebhookEvent('not json')).toThrow(WebhookPayloadError);
    expect(() => parseWebhookEvent(JSON.stringify({ type: 'x' }))).toThrow(WebhookPayloadError);
  });
});
