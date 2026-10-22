import { signWebhookBody } from '@lazyapp-examples/sdk';
import type { WebhookMessage } from '@lazyapp-examples/sdk';
import { describe, expect, it } from 'vitest';
import {
  CommandParser,
  DemoRuntime,
  DemoStore,
  fit,
  formatInr,
  KeyedQueue,
  maskPhone,
  MessageLimitError,
  normalizeAddress,
  normalizeCommandText,
  silentLogger,
  toInbound,
  ui,
} from '../src/index.js';
import type { Inbound } from '../src/index.js';
import { FakeLazyApp } from '../src/testing/index.js';
import { LazyAppClient } from '@lazyapp-examples/sdk';
import { counter } from './fixtures.js';

const message = (
  type: string,
  content: Record<string, unknown>,
  extra: Partial<WebhookMessage> = {},
): WebhookMessage => ({
  uuid: 'u1',
  conversation_id: 'cnv_1',
  direction: 'inbound',
  status: 'received',
  type,
  to: '+910000000000',
  from: '+919812345670',
  contact: { uuid: 'c1', phone_number: '+919812345670', bsuid: null, username: 'Asha' },
  body: null,
  provider_message_id: 'wamid.1',
  error_message: null,
  content,
  request_id: null,
  group: null,
  metadata: null,
  provider_timestamp: '2026-10-23T10:00:00+00:00',
  created_at: null,
  ...extra,
});

describe('toInbound', () => {
  it('normalises every inbound type LazyApp delivers', () => {
    const cases: [WebhookMessage, Partial<Inbound>][] = [
      [message('text', { text: { body: 'hi' } }), { kind: 'text', text: 'hi' }],
      [
        message('interactive', {
          interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Yes' } },
        }),
        { kind: 'button', id: 'b1', title: 'Yes' },
      ],
      [
        message('interactive', {
          interactive: { type: 'list_reply', list_reply: { id: 'r1', title: 'Row', description: 'd' } },
        }),
        { kind: 'list', id: 'r1', title: 'Row', description: 'd' },
      ],
      [
        message('button', { button: { text: 'MENU', payload: 'demo:menu' } }),
        { kind: 'button', id: 'demo:menu', title: 'MENU' },
      ],
      [
        message('interactive', {
          interactive: {
            type: 'nfm_reply',
            nfm_reply: { name: 'flow', response_json: '{"flow_token":"t1","a":1}', response: null },
          },
        }),
        { kind: 'flow', flowToken: 't1', response: { flow_token: 't1', a: 1 } },
      ],
      [
        message('interactive', {
          interactive: {
            type: 'nfm_reply',
            nfm_reply: {
              name: 'address_message',
              response: { values: { city: 'Pune', in_pin_code: '411001' }, saved_address_id: 'home' },
            },
          },
        }),
        { kind: 'address', values: { city: 'Pune', in_pin_code: '411001' }, savedAddressId: 'home' },
      ],
      [
        message('location', { location: { latitude: '12.5', longitude: 77.1, name: 'Home', address: null } }),
        { kind: 'location', latitude: 12.5, longitude: 77.1, name: 'Home', address: null },
      ],
      [
        message('audio', { audio: { id: 'm1', mime_type: 'audio/ogg', voice: true }, media_stub: true }),
        { kind: 'media', mediaType: 'audio', mediaId: 'm1', voice: true },
      ],
      [
        message('order', {
          order: {
            catalog_id: 'cat',
            text: 'gift wrap',
            product_items: [
              { product_retailer_id: 's1', quantity: '2', item_price: 499, currency: 'INR' },
              { bad: true },
            ],
          },
        }),
        {
          kind: 'order',
          catalogId: 'cat',
          note: 'gift wrap',
          items: [{ retailerId: 's1', quantity: 2, itemPrice: 499, currency: 'INR' }],
        },
      ],
      [
        message('reaction', { reaction: { emoji: '👍', message_id: 'wamid.9' } }),
        { kind: 'reaction', emoji: '👍', targetWamid: 'wamid.9' },
      ],
      [message('system', {}), { kind: 'unsupported', type: 'system' }],
    ];
    for (const [input, expected] of cases) {
      expect(toInbound(input)).toMatchObject(expected);
    }
  });

  it('captures reply context and referral, and skips group and outbound messages', () => {
    const inbound = toInbound(
      message('text', { text: { body: 'x' }, context: { id: 'wamid.0' }, referral: { source_id: 'ad1' } }),
    );
    expect(inbound).toMatchObject({
      replyToWamid: 'wamid.0',
      referral: { source_id: 'ad1' },
      wamid: 'wamid.1',
    });
    expect(toInbound(message('text', {}, { group: { uuid: 'g', provider_group_id: 'p' } }))).toBeNull();
    expect(toInbound(message('text', {}, { direction: 'outbound' }))).toBeNull();
    expect(toInbound(message('text', {}, { from: null, contact: null }))).toBeNull();
  });

  it('normalises addresses', () => {
    expect(normalizeAddress('919812345670')).toBe('+919812345670');
    expect(normalizeAddress('+91 98123 45670')).toBe('+919812345670');
    expect(normalizeAddress('IN.abc123')).toBe('IN.abc123');
    expect(normalizeAddress('  ')).toBeNull();
  });
});

describe('CommandParser', () => {
  const parser = new CommandParser([
    { exampleId: 'shop', startCode: 'DEMO SHOP', command: 'shop' },
    { exampleId: 'food', startCode: 'DEMO FOOD' },
  ]);
  const text = (value: string) => toInbound(message('text', { text: { body: value } }))!;

  it('normalises text', () => {
    expect(normalizeCommandText('  “demo   shop!” ')).toBe('DEMO SHOP');
  });

  it('matches whole codes, leading codes and commands; longest wins over the hub', () => {
    expect(parser.parseEntry(text('Demo Shop'))).toEqual({ type: 'start', exampleId: 'shop' });
    expect(parser.parseEntry(text('DEMO SHOP: hi there'))).toEqual({ type: 'start', exampleId: 'shop' });
    expect(parser.parseEntry(text('/shop'))).toEqual({ type: 'start', exampleId: 'shop' });
    expect(parser.parseEntry(text('DEMO SHOPPING'))).toEqual({ type: 'none' });
    expect(parser.parseEntry(text('demo'))).toEqual({ type: 'hub', page: 1 });
    expect(parser.parseEntry(text('menu'))).toEqual({ type: 'none' });
  });

  it('recognises global commands only in session', () => {
    expect(parser.parseInSession(text('menu'))).toEqual({ type: 'menu' });
    expect(parser.parseInSession(text('Exit.'))).toEqual({ type: 'exit' });
    expect(parser.parseInSession(text('STOP'))).toEqual({ type: 'stop' });
    expect(parser.parseInSession(text('stop it'))).toEqual({ type: 'none' });
  });

  it('refuses two examples with the same code', () => {
    expect(
      () =>
        new CommandParser([
          { exampleId: 'a', startCode: 'DEMO X' },
          { exampleId: 'b', startCode: 'demo x' },
        ]),
    ).toThrow(/used by both/);
  });
});

describe('ui builders', () => {
  it('trims data-driven copy and keeps ids intact', () => {
    const built = ui.list({
      body: 'Pick',
      button: 'A very long list button label',
      sections: [
        {
          rows: [
            { id: 'sku-1', title: 'Hand-block printed cotton kurta, indigo', description: 'x'.repeat(100) },
          ],
        },
      ],
    });
    const row = built.action.sections[0]!.rows[0]!;
    expect(row.title).toBe('Hand-block printed cott…');
    expect(Array.from(row.title)).toHaveLength(24);
    expect(row.description).toHaveLength(72);
    expect(built.action.button).toHaveLength(20);
    expect(fit('short', 10)).toBe('short');
  });

  it('throws on structural mistakes', () => {
    const four = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` }));
    expect(() => ui.buttons({ body: 'x', buttons: four })).toThrow(MessageLimitError);
    expect(() =>
      ui.buttons({
        body: 'x',
        buttons: [
          { id: 'a', title: 'A' },
          { id: 'a', title: 'B' },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      ui.list({
        body: 'x',
        button: 'Open',
        sections: [{ rows: Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: 'r' })) }],
      }),
    ).toThrow(/1 to 10 rows/);
    expect(() => ui.cta({ body: 'x', displayText: 'Go', url: 'ftp://x' })).toThrow(/http/);
    expect(() =>
      ui.mediaCarousel('x', [
        { image: 'https://a/1.jpg', link: { displayText: 'Buy', url: 'https://a/1' } },
        { image: 'https://a/2.jpg', quickReplies: [{ id: 'q', title: 'Q' }] },
      ]),
    ).toThrow(/same buttons/);
  });

  it('builds media headers, carousels and India address requests', () => {
    expect(
      ui.buttons({ body: 'b', header: { image: 'https://x/i.jpg' }, buttons: [{ id: 'a', title: 'A' }] })
        .header,
    ).toEqual({
      type: 'image',
      image: { link: 'https://x/i.jpg' },
    });
    const carousel = ui.productCarousel('Picks', 'cat', ['s1', 's2']);
    expect(carousel.action.cards[1]).toEqual({
      card_index: 1,
      type: 'product',
      action: { product_retailer_id: 's2', catalog_id: 'cat' },
    });
    expect(ui.addressRequest({ body: 'Where to?', values: { city: 'Pune' } }).action.parameters).toEqual({
      country: 'IN',
      values: { city: 'Pune' },
    });
  });

  it('formats rupees from paise', () => {
    expect(formatInr(104800)).toBe('₹1,048');
    expect(formatInr(49950)).toBe('₹499.50');
    expect(formatInr(1_00_000_00)).toBe('₹1,00,000');
  });
});

describe('DemoStore', () => {
  it('dedupes deliveries and lists pending ones for recovery', () => {
    const store = new DemoStore(':memory:');
    const at = new Date('2026-10-23T00:00:00Z');
    expect(store.recordInbound('evt_1', 'message.received', '{}', at)).toBe(true);
    expect(store.recordInbound('evt_1', 'message.received', '{}', at)).toBe(false);
    store.recordInbound('evt_2', 'message.received', '{}', at);
    store.markInbound('evt_1', 'done', at);
    expect(store.pendingInbound().map((record) => record.id)).toEqual(['evt_2']);
    expect(store.pruneInbound(new Date('2026-10-24T00:00:00Z'))).toBe(1);
    store.close();
  });

  it('namespaces key-value data and lists by prefix (escaping LIKE wildcards)', () => {
    const store = new DemoStore(':memory:');
    const clock = () => new Date(0);
    const shop = store.keyValue('example:shop', clock);
    const food = store.keyValue('example:food', clock);
    shop.set('order:1', { total: 1 });
    shop.set('order:2', { total: 2 });
    shop.set('order%x', { total: 3 });
    food.set('order:1', { total: 9 });
    expect(shop.list<{ total: number }>('order:').map((entry) => entry.value.total)).toEqual([1, 2]);
    expect(food.get('order:1')).toEqual({ total: 9 });
    shop.delete('order:1');
    expect(shop.get('order:1')).toBeUndefined();
    store.close();
  });
});

describe('KeyedQueue', () => {
  it('runs one key in order and different keys concurrently', async () => {
    const queue = new KeyedQueue(4);
    const log: string[] = [];
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    queue.push('a', async () => {
      await wait(20);
      log.push('a1');
    });
    queue.push('a', async () => {
      log.push('a2');
    });
    queue.push('b', async () => {
      log.push('b1');
    });
    expect(await queue.drain()).toBe(true);
    expect(log).toEqual(['b1', 'a1', 'a2']);
    expect(await queue.run('c', async () => 42)).toBe(42);
  });

  it('isolates failures and refuses work after close', async () => {
    const errors: unknown[] = [];
    const queue = new KeyedQueue(1, (error) => errors.push(error));
    queue.push('a', async () => {
      throw new Error('first');
    });
    const second = queue.run('a', async () => 'second');
    await expect(second).resolves.toBe('second');
    expect(errors).toHaveLength(1);
    await queue.close();
    expect(queue.push('a', async () => undefined)).toBe(false);
  });
});

describe('DemoRuntime.ingest', () => {
  const build = () => {
    const api = new FakeLazyApp();
    const store = new DemoStore(':memory:');
    const runtime = new DemoRuntime({
      examples: [counter],
      api: new LazyAppClient({
        apiKey: 'sk_test',
        baseUrl: 'https://lazyapp.test',
        fetch: api.fetch,
        maxRetries: 0,
      }),
      store,
      log: silentLogger,
      webhookSecret: 'whsec',
      config: { publicBaseUrl: 'https://demo.test' },
    });
    return { api, store, runtime };
  };
  const body = (id: string, text: string) =>
    JSON.stringify({
      id,
      type: 'message.received',
      created_at: '2026-10-23T10:00:00Z',
      data: { message: message('text', { text: { body: text } }) },
    });

  it('verifies, dedupes and processes deliveries in the background', async () => {
    const { api, store, runtime } = build();
    const raw = body('evt_a', 'DEMO COUNT');

    expect(runtime.ingest(raw, 'sha256=bad')).toMatchObject({ status: 'rejected', httpStatus: 401 });
    expect(runtime.ingest('{"nope":1}', signWebhookBody('{"nope":1}', 'whsec'))).toMatchObject({
      httpStatus: 400,
    });
    expect(runtime.ingest(raw, signWebhookBody(raw, 'whsec'))).toEqual({ status: 'accepted', id: 'evt_a' });
    expect(runtime.ingest(raw, signWebhookBody(raw, 'whsec'))).toEqual({ status: 'duplicate', id: 'evt_a' });

    await runtime.close();
    expect(store.getInbound('evt_a')?.status).toBe('done');
    expect(api.calls.some((call) => call.path === '/v1/messages')).toBe(true);
    store.close();
  });

  it('ignores test deliveries and recovers pending ones after a restart', async () => {
    const { api, store, runtime } = build();
    const test = JSON.stringify({ id: 'evt_test_1', type: 'message.sent', test: true, data: {} });
    expect(runtime.ingest(test, signWebhookBody(test, 'whsec'))).toEqual({
      status: 'ignored',
      reason: 'test delivery',
    });

    store.recordInbound('evt_b', 'message.received', body('evt_b', 'DEMO COUNT'), new Date());
    expect(runtime.recover()).toBe(1);
    await runtime.close();
    expect(store.getInbound('evt_b')?.status).toBe('done');
    expect(api.calls.filter((call) => call.path === '/v1/messages')).toHaveLength(1);
    store.close();
  });

  it('rejects unsigned flow requests unless explicitly allowed', async () => {
    const { runtime, store } = build();
    expect(await runtime.flowExchange('counter', 'pick', '{"action":"ping"}', null)).toMatchObject({
      status: 401,
    });
    store.close();
  });
});

describe('maskPhone', () => {
  it('keeps numbers recognisable without logging them', () => {
    expect(maskPhone('+919812345670')).toBe('+91******5670');
    expect(maskPhone(null)).toBe('-');
  });
});
