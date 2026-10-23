import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { HarnessOptions } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { PlatformSaasConfig } from '../src/config.js';
import { createPlatformSaasExample } from '../src/index.js';
import { CALL_TAG, IDS } from '../src/tour.js';

const open: { close(): void }[] = [];
const setup = (config: Partial<PlatformSaasConfig> = {}, options: HarnessOptions = {}) => {
  const h = createHarness(createPlatformSaasExample({ ...DEFAULT_CONFIG, ...config }), {
    displayName: 'Asha',
    ...options,
  });
  open.push(h);
  return h;
};
afterEach(() => {
  for (const harness of open.splice(0)) {
    harness.close();
  }
});

describe('platform-saas: the guided tour', () => {
  it('walks the five steps with buttons, a list and a link to SalonBook', async () => {
    const h = setup();

    await h.user.send('DEMO PLATFORM');
    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'text', text: 'Build your own WhatsApp SaaS' },
      body: { text: expect.stringContaining('Hi, Asha') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual([IDS.start, IDS.tryIt, IDS.call]);

    await h.user.tap(IDS.start);
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('POST /v1/platform/customers') },
    });
    expect(h.state()?.step).toBe('customers');

    await h.user.tap(IDS.connect);
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('customer.connected') },
    });

    await h.user.tap(IDS.embed);
    expect(h.lastInteractive()?.type).toBe('list');
    expect(h.lastChoices()).toEqual([
      'ps:component:inbox',
      'ps:component:templates',
      'ps:component:usage',
      'ps:component:connection',
      'ps:component:messages',
      IDS.webhooks,
    ]);

    await h.user.choose('ps:component:inbox', 'Inbox');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('"component": "inbox"') },
    });
    expect(h.state()?.componentsSeen).toEqual(['inbox']);

    await h.user.tap(IDS.webhooks);
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('"external_id"') } });
    h.clear();

    await h.user.tap(IDS.tryIt);
    const [cta, next] = h.interactives();
    expect(cta).toMatchObject({
      type: 'cta_url',
      action: { parameters: { display_text: 'Open SalonBook', url: 'https://demo.test/x/platform-saas/' } },
    });
    expect(next?.type).toBe('button');
    expect(h.lastChoices()).toEqual([IDS.status, IDS.call, IDS.start]);

    await h.user.tap(IDS.status);
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('Meta app review') } });
    expect(h.messages().every((message) => message.to === h.user.phone)).toBe(true);
  });

  it('collects a call time, tags the contact and keeps no phone number', async () => {
    const h = setup();
    await h.user.send('DEMO PLATFORM');
    await h.user.tap(IDS.call);
    expect(h.lastInteractive()?.type).toBe('list');
    h.clear();

    await h.user.choose('ps:slot:tomorrow-am', 'Tomorrow morning');

    expect(h.callsTo('POST', /\/v1\/contacts\/.+\/tags$/)[0]?.body).toEqual({ tags: [CALL_TAG] });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('tomorrow morning') },
    });
    expect(h.state()?.callSlot).toBe('tomorrow-am');
    const stored = JSON.stringify(h.store.keyValue('example:platform-saas', () => h.now()).list('call:'));
    expect(stored).not.toContain(h.user.phone);
  });

  it('links to the booking page when one is configured', async () => {
    const h = setup({ bookCallUrl: 'https://cal.example/lazyapp' });
    await h.user.send('DEMO PLATFORM');

    await h.user.send('can we talk to sales?');

    expect(h.lastInteractive()).toMatchObject({
      type: 'cta_url',
      action: { parameters: { url: 'https://cal.example/lazyapp' } },
    });
  });

  it('answers unknown input and stale buttons by repeating the current step', async () => {
    const h = setup();
    await h.user.send('DEMO PLATFORM');
    await h.user.tap(IDS.start);
    h.clear();

    await h.user.send('asdf qwerty');
    expect(h.lastInteractive()).toMatchObject({
      header: { text: '1/5 · One customer per salon' },
      body: { text: expect.stringContaining("I didn't catch that") },
    });

    await h.user.tap('shop:cart', 'Cart');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('older message') },
    });

    await h.user.sendMedia('image');
    expect(h.messages()).toHaveLength(3);
    expect(h.state()?.step).toBe('customers');

    await h.user.send('next');
    expect(h.state()?.step).toBe('connect');
  });

  it('stays silent for people who never started the demo', async () => {
    const h = setup();

    expect(await h.user.send('hi, is this SalonBook?')).toEqual({
      status: 'ignored',
      reason: 'not in a demo',
    });
    await h.user.tap(IDS.start);
    await h.user.send('PLATFORM');

    expect(h.calls).toHaveLength(0);
  });

  it('goes silent once the session has been idle for 24 hours', async () => {
    const h = setup();
    await h.user.send('DEMO PLATFORM');
    h.advance(24 * 3_600_000);
    h.clear();

    expect(await h.user.tap(IDS.start)).toEqual({ status: 'ignored', reason: 'not in a demo' });

    expect(h.calls).toHaveLength(0);
    expect(h.session()).toBeUndefined();
  });

  it('leaves on EXIT and restarts from the top on MENU', async () => {
    const h = setup();
    await h.user.send('DEMO PLATFORM');
    await h.user.tap(IDS.embed);

    await h.user.send('MENU');
    expect(h.state()?.step).toBe('intro');

    h.clear();
    await h.user.send('exit');
    expect(h.texts()[0]).toContain('Thanks for trying Build your WhatsApp SaaS');
    expect(h.session()).toBeUndefined();
  });
});
