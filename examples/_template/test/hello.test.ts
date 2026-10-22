import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import hello from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';

const harnesses: { close(): void }[] = [];
const setup = (options?: Parameters<typeof createHarness>[1]) => {
  const harness = createHarness(hello, options);
  harnesses.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

describe('hello (reference example)', () => {
  it('stays silent until the start code, then shows the menu', async () => {
    const h = setup({ displayName: 'Asha' });

    expect(await h.user.send('hi')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(h.calls).toHaveLength(0);

    await h.user.send('demo hello');

    expect(h.callsTo('POST', /\/read$/)[0]?.body).toEqual({ typing: true });
    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      body: { text: expect.stringContaining('Hi Asha!') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual(['colour', 'location', 'feedback']);
    expect(h.lastMessage()).toMatchObject({ to: h.user.phone, metadata: { demo: 'hello' } });
  });

  it('lists colours, reacts to the pick and remembers it', async () => {
    const h = setup();
    await h.user.send('DEMO HELLO');
    await h.user.tap('colour');

    expect(h.lastInteractive()).toMatchObject({ type: 'list', action: { button: 'See colours' } });
    h.clear();

    await h.user.choose('colour:teal', 'Teal');

    const [reaction, menu] = h.messages();
    expect(reaction).toMatchObject({
      type: 'reaction',
      reaction: { emoji: '🎨', message_id: expect.stringMatching(/^wamid\./) },
    });
    expect(menu).toMatchObject({
      type: 'interactive',
      interactive: { body: { text: expect.stringContaining('Teal it is') } },
    });
    expect(h.state()).toMatchObject({ colour: 'Teal', step: 'menu' });
  });

  it('asks for a location and answers with the office pin and distance', async () => {
    const h = setup();
    await h.user.send('DEMO HELLO');
    await h.user.tap('location');
    expect(h.lastInteractive()).toMatchObject({ type: 'location_request_message' });
    h.clear();

    await h.user.shareLocation({ latitude: 19.076, longitude: 72.8777, name: 'Mumbai' });

    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'LazyApp', latitude: 12.9716 });
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringMatching(/about 8\d\d km/) } });
  });

  it('sends the feedback flow with a fresh token and records the rating on completion', async () => {
    const h = setup();
    await h.user.send('DEMO HELLO');
    await h.user.tap('feedback');

    const flow = h.lastInteractive();
    expect(flow).toMatchObject({
      type: 'flow',
      action: {
        parameters: {
          flow_id: 'meta-flow-hello-feedback',
          flow_action: 'navigate',
          flow_action_payload: { screen: 'RATE' },
          flow_token: expect.stringMatching(/^hello\./),
        },
      },
    });

    await h.user.submitFlow({ rating: '5', comment: 'Ship the shop demo' });

    expect(h.state()).toMatchObject({ rating: 5, step: 'done' });
    expect(h.lastChoices()).toEqual(['remind', 'demo:menu']);
  });

  it('falls back to rating buttons when the flow is not published', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO HELLO');
    await h.user.tap('feedback');

    expect(h.lastChoices()).toEqual(['rating:5', 'rating:3', 'rating:2']);

    await h.user.tap('rating:3', 'It was OK');
    expect(h.state()).toMatchObject({ rating: 3 });
  });

  it('schedules the reminder only on request and cancels it on EXIT', async () => {
    const h = setup({ displayName: 'Asha' });
    await h.user.send('DEMO HELLO');
    await h.user.tap('rating:5');
    h.clear();

    await h.user.tap('remind', 'Remind me in 1h');

    const [scheduled] = h.callsTo('POST', '/v1/messages');
    expect(scheduled?.body).toMatchObject({
      type: 'template',
      template: { name: TEMPLATES.followUp },
      send_at: new Date(h.now().getTime() + 3_600_000).toISOString(),
    });
    expect(h.session()?.meta.followUps.reminder).toBeDefined();
    h.clear();

    await h.user.send('exit');

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(h.texts()[0]).toContain('Thanks for trying Hello LazyApp');
    expect(h.session()).toBeUndefined();
  });

  it('nudges back to the menu on free text', async () => {
    const h = setup();
    await h.user.send('DEMO HELLO');
    h.clear();

    await h.user.send('what is this?');

    expect(h.texts()[0]).toContain("I didn't catch that");
    expect(h.lastChoices()).toEqual(['colour', 'location', 'feedback']);
  });
});
