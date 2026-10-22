import { afterEach, describe, expect, it } from 'vitest';
import { createHarness } from '../src/testing/index.js';
import type { HarnessOptions } from '../src/testing/index.js';
import { counter, other } from './fixtures.js';

const HOUR = 3_600_000;
const open: { close(): void }[] = [];
const setup = (options: HarnessOptions = {}) => {
  const harness = createHarness(counter, { otherExamples: [other], ...options });
  open.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of open.splice(0)) {
    harness.close();
  }
});

describe('hard rule 1: silent for people who did not start a demo', () => {
  it('ignores every message type and makes no API call', async () => {
    const h = setup();
    const outcomes = [
      await h.user.send('hello'),
      await h.user.send('menu'),
      await h.user.send('STOP'),
      await h.user.tap('count', 'Count'),
      await h.user.shareLocation({ latitude: 1, longitude: 2 }),
      await h.user.sendMedia('image'),
      await h.user.sendOrder([{ retailerId: 'sku', quantity: 1 }]),
    ];
    expect(outcomes.every((outcome) => outcome.status === 'ignored')).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it('ignores events about people outside a demo, and workspace traffic it did not send', async () => {
    const h = setup();
    await h.event('payment.captured', { payment: { to: '919800000001', reference_id: 'x' } });
    await h.event('message.delivered', { message: { to: '+919800000001', metadata: null } });
    expect(h.calls).toHaveLength(0);

    await h.user.send('DEMO COUNT');
    h.clear();
    const outcome = await h.event('message.failed', {
      message: { to: h.user.phone, metadata: { demo: 'login' } },
    });
    expect(outcome).toEqual({ status: 'ignored', reason: 'message was not sent by this demo' });
    expect(h.calls).toHaveLength(0);
  });

  it('ignores group messages and our own outbound echoes', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.clear();
    const message = {
      uuid: 'g1',
      conversation_id: null,
      direction: 'inbound',
      type: 'text',
      from: h.user.phone,
      content: { text: { body: 'hi' } },
      group: { uuid: 'grp', provider_group_id: 'g' },
    };
    expect(await h.event('message.received', { message })).toMatchObject({ status: 'ignored' });
    expect(
      await h.event('message.received', { message: { ...message, group: null, direction: 'outbound' } }),
    ).toMatchObject({
      status: 'ignored',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('starting demos', () => {
  it.each(['DEMO COUNT', 'demo count', '  Demo   Count! ', 'DEMO COUNT - I saw your poster', '/count'])(
    'starts on %j',
    async (text) => {
      const h = setup();
      expect(await h.user.send(text)).toMatchObject({
        status: 'handled',
        exampleId: 'counter',
        action: 'start',
      });
      expect(h.texts()).toEqual(['Counter started']);
    },
  );

  it('does not start on a code buried mid-sentence', async () => {
    const h = setup();
    expect(await h.user.send('what is DEMO COUNT')).toMatchObject({ status: 'ignored' });
  });

  it('opens the hub on DEMO and starts the chosen demo from the list', async () => {
    const h = setup();
    await h.user.send('DEMO');

    const hub = h.lastInteractive();
    expect(hub).toMatchObject({ type: 'list', header: { text: 'LazyApp live demos' } });
    expect(h.lastChoices()).toEqual(['demo:start:counter', 'demo:start:other']);
    expect(h.session()?.exampleId).toBe('__hub__');

    await h.user.choose('demo:start:other', 'Other');
    expect(h.session()?.exampleId).toBe('other');
    expect(h.texts()).toEqual(['Other started']);
  });

  it('keeps one active example per person and switches on a new start code', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('one');
    await h.user.send('DEMO OTHER');

    expect(h.session()?.exampleId).toBe('other');
    h.clear();
    await h.user.send('hello');
    expect(h.texts()).toEqual(['Other says hi']);
  });

  it('restarts with fresh state when the same start code is sent again', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('one');
    expect(h.state()?.count).toBe(1);

    await h.user.send('DEMO COUNT');
    expect(h.state()?.count).toBe(0);
  });

  it('keeps people isolated from each other', async () => {
    const h = setup();
    const asha = h.as('+919800000002');
    await h.user.send('DEMO COUNT');
    await h.user.send('one');
    h.clear();

    expect(await asha.send('one')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
    expect(h.state()?.count).toBe(1);
  });
});

describe('hard rule 3: MENU, EXIT, STOP', () => {
  it('MENU calls onMenu without reaching onMessage', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('one');
    h.clear();
    await h.user.send('menu');
    expect(h.texts()).toEqual(['Menu (count 1)']);
  });

  it('EXIT says goodbye, ends the session and goes silent', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.clear();

    expect(await h.user.send('Exit')).toMatchObject({ action: 'exit' });
    expect(h.texts()[0]).toMatch(/Thanks for trying Counter! Send \*DEMO COUNT\*/);
    expect(h.session()).toBeUndefined();

    h.clear();
    expect(await h.user.send('one')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('STOP confirms the opt-out once, records it and goes silent', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.clear();

    expect(await h.user.send('STOP')).toMatchObject({ action: 'stop' });
    expect(h.texts()[0]).toContain("You're opted out");
    expect(h.store.isOptedOut(h.user.phone)).toBe(true);

    h.clear();
    await h.user.send('menu');
    await h.user.send('hello?');
    expect(h.calls).toHaveLength(0);

    await h.user.send('DEMO COUNT');
    expect(h.store.isOptedOut(h.user.phone)).toBe(false);
  });

  it('honours the reserved demo:menu and demo:exit buttons', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.clear();
    await h.user.tap('demo:menu', 'Main menu');
    expect(h.texts()).toEqual(['Menu (count 0)']);
    await h.user.tap('demo:exit', 'Leave');
    expect(h.session()).toBeUndefined();
  });

  it('lets the example end the demo itself', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('bye');
    expect(h.texts().at(-1)).toBe('Ending now');
    expect(h.session()).toBeUndefined();
  });
});

describe('hard rule 1b: sessions expire after 24h idle', () => {
  it('goes silent after 24 hours without an inbound message', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.advance(24 * HOUR);
    h.clear();

    expect(await h.user.send('one')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
    expect(h.session()).toBeUndefined();
  });

  it('sweep() ends idle sessions and cancels their follow-ups', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.store.saveSession({
      ...h.session()!,
      meta: { ...h.session()!.meta, followUps: { nudge: { id: 'sch_9', category: 'utility', sendAt: '' } } },
    });
    h.advance(25 * HOUR);
    h.clear();

    expect(await h.runtime.sweep()).toBe(1);
    expect(h.callsTo('DELETE', '/v1/messages/scheduled/sch_9')).toHaveLength(1);
    expect(h.session()).toBeUndefined();
  });

  it('refuses free-form sends once the 24h window has closed', async () => {
    const h = setup({ config: { sessionIdleMs: 48 * HOUR } });
    await h.user.send('DEMO COUNT');
    h.advance(30 * HOUR);
    h.clear();

    const outcome = await h.event('payment.captured', {
      payment: { to: '919800000001', reference_id: 'order-1' },
    });

    expect(outcome).toMatchObject({ status: 'handled', error: expect.stringContaining('24-hour') });
    expect(h.callsTo('POST', '/v1/messages')).toHaveLength(0);
  });
});

describe('events', () => {
  it('routes subscribed events to the session owner', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    h.clear();

    await h.event('payment.captured', { payment: { to: '919800000001', reference_id: 'order-7' } });

    expect(h.texts()).toEqual(['Paid order-7']);
    expect(h.state()?.lastPayment).toBe('order-7');
  });

  it('ignores events the example did not declare', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    expect(await h.event('payment.refunded', { payment: { to: '919800000001' } })).toMatchObject({
      status: 'ignored',
    });
  });
});

describe('reliability', () => {
  it('applies a redelivered event only once', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('one');
    h.clear();

    expect(await h.replayLast()).toEqual({
      status: 'ignored',
      reason: 'event already applied to this session',
    });
    expect(h.callsTo('POST', '/v1/messages')).toHaveLength(0);
    expect(h.state()?.count).toBe(1);
  });

  it('re-sends with the same idempotency keys after a crash before the state was saved', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    const beforeCrash = h.session()!;
    h.clear();
    await h.user.send('one');
    const first = h.callsTo('POST', '/v1/messages').map((call) => call.idempotencyKey);
    h.store.saveSession(beforeCrash);
    h.clear();

    await h.replayLast();
    const second = h.callsTo('POST', '/v1/messages').map((call) => call.idempotencyKey);

    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(2);
    expect(second).toEqual(first);
    expect(h.state()?.count).toBe(1);
  });

  it('apologises once and keeps the previous state when a handler throws', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('one');
    h.clear();

    const outcome = await h.user.send('boom');

    expect(outcome).toMatchObject({ status: 'handled', error: 'kaboom' });
    expect(h.texts()).toEqual([expect.stringContaining('something went wrong')]);
    expect(h.state()?.count).toBe(1);
    expect(h.session()?.meta.turns).toBe(3);
  });

  it('marks inbound messages read with a typing indicator', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/messages/in_1/read',
      body: { typing: true },
    });
  });

  it('addresses username-only users by business-scoped id', async () => {
    const h = setup();
    const bsuidUser = h.as('IN.1234567890abcdef');
    await bsuidUser.send('DEMO COUNT');
    expect(h.lastMessage()).toMatchObject({ recipient: { type: 'bsuid', value: 'IN.1234567890abcdef' } });
    expect(h.lastMessage()).not.toHaveProperty('to');
  });

  it('sends from the configured phone number id', async () => {
    const h = setup({ config: { phoneNumberId: '106540352242922' } });
    await h.user.send('DEMO COUNT');
    expect(h.lastMessage()).toMatchObject({ phone_number_id: '106540352242922' });
  });
});

describe('flow data exchange', () => {
  it('answers INIT and data_exchange for a valid token and persists state', async () => {
    const h = setup();
    await h.user.send('DEMO COUNT');
    await h.user.send('flow');
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: { parameters: { flow_action: 'data_exchange', flow_id: 'meta-flow-counter-pick' } },
    });

    expect(await h.flowExchange('pick', { action: 'INIT' })).toEqual({
      status: 200,
      body: { screen: 'PICK', data: { options: ['a', 'b'], count: 0 } },
    });
    const done = await h.flowExchange('pick', {
      action: 'data_exchange',
      screen: 'PICK',
      data: { choice: 'b' },
    });
    expect(done).toMatchObject({ status: 200, body: { screen: 'SUCCESS' } });
    expect(h.state()?.count).toBe(10);
  });

  it('answers ping and acknowledges client error notifications', async () => {
    const h = setup();
    expect(await h.flowExchange('pick', { action: 'ping', flow_token: '' })).toEqual({
      status: 200,
      body: { data: { status: 'active' } },
    });
    expect(
      await h.flowExchange('pick', { action: 'data_exchange', data: { error: 'boom' }, flow_token: 'x' }),
    ).toEqual({ status: 200, body: { data: { acknowledged: true } } });
  });

  it('answers 427 for unknown, expired or ended-session tokens', async () => {
    const h = setup();
    expect(await h.flowExchange('pick', { action: 'INIT', flow_token: 'nope' })).toMatchObject({
      status: 427,
    });

    await h.user.send('DEMO COUNT');
    await h.user.send('flow');
    await h.user.send('EXIT');
    expect(await h.flowExchange('pick', { action: 'INIT' })).toMatchObject({ status: 427 });
  });
});
