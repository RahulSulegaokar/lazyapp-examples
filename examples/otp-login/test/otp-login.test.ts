import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import otpLogin from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';
import { CODE, installFakeOtp } from './fake-otp.js';

const harnesses: { close(): void }[] = [];
const setup = (options?: Parameters<typeof createHarness>[1]) => {
  const h = createHarness(otpLogin, { displayName: 'Asha', ...options });
  harnesses.push(h);
  const fake = installFakeOtp(h);
  return { h, fake };
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

describe('otp-login: verify in chat', () => {
  it('ignores everyone who has not sent the start code', async () => {
    const { h } = setup();

    expect(await h.user.send('482913')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(await h.user.send('otp please')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('starts with the menu', async () => {
    const { h } = setup();
    await h.user.send('demo otp');

    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'text', text: '🔐 Login with WhatsApp' },
      body: { text: expect.stringContaining('Hi Asha!') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual(['otp:chat', 'otp:web', 'otp:how']);
  });

  it('sends a managed code with the authentication template and verifies it', async () => {
    const { h, fake } = setup();
    await h.user.send('DEMO OTP');
    h.clear();

    await h.user.tap('otp:chat', 'Verify in chat');

    const [send] = h.callsTo('POST', '/v1/otp');
    expect(send?.body).toEqual({ to: h.user.phone, mode: 'managed', template_name: TEMPLATES.copyCode });
    expect(send?.idempotencyKey).toMatch(/:otp-login:otp-send$/);
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('Copy code') } });
    expect(h.lastChoices()).toEqual(['otp:resend', 'demo:menu']);
    expect(h.state()).toMatchObject({
      step: 'awaiting_code',
      codesSent: 1,
      challenge: { id: fake.challenges[0]?.id },
    });

    h.advance(12_000);
    h.clear();
    await h.user.send('482 913');

    expect(h.callsTo('POST', '/v1/otp/verify')[0]?.body).toEqual({ id: fake.challenges[0]?.id, code: CODE });
    const [reaction, confirmation] = h.messages();
    expect(reaction).toMatchObject({ type: 'reaction', reaction: { emoji: '✅' } });
    expect(confirmation).toMatchObject({
      interactive: {
        body: { text: expect.stringContaining('Verified! You proved you own +91 •••••• 0001 in 12 seconds') },
      },
    });
    expect(h.state()).toMatchObject({ step: 'verified', challenge: null, verifiedAt: expect.any(String) });
  });

  it('counts wrong codes, then pauses verification as a fraud guard', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    await h.user.tap('otp:chat');
    h.clear();

    await h.user.send('111111');
    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '❌' } });
    expect(h.texts()[0]).toContain('2 tries left');

    await h.user.send('222222');
    h.clear();
    await h.user.send('333333');

    expect(h.texts()[0]).toContain('🔒 Too many wrong codes, so verification is paused until');
    expect(h.state()).toMatchObject({ step: 'menu', challenge: null, lockedUntil: expect.any(String) });
    h.clear();

    await h.user.tap('otp:chat');
    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(0);
    expect(h.texts()[0]).toContain('Verification is paused until');

    h.advance(16 * 60_000);
    await h.user.tap('otp:chat');
    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(1);
  });

  it('tells the person when a code has expired', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    await h.user.tap('otp:chat');
    h.advance(11 * 60_000);
    h.clear();

    await h.user.send(CODE);

    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('expired') } });
    expect(h.lastChoices()).toEqual(['otp:resend', 'demo:menu']);
    expect(h.state()).toMatchObject({ step: 'menu', challenge: null });
  });

  it('enforces the resend cool-off locally, then sends a fresh code', async () => {
    const { h, fake } = setup();
    await h.user.send('DEMO OTP');
    await h.user.tap('otp:chat');
    h.advance(10_000);
    h.clear();

    await h.user.tap('otp:resend', 'Send a new code');

    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(0);
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('in 20 seconds') } });

    h.advance(21_000);
    h.clear();
    await h.user.tap('otp:resend', 'Send a new code');

    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(1);
    expect(h.state()?.challenge?.id).toBe(fake.challenges[1]?.id);

    // The old code is dead: verify goes to the new challenge.
    await h.user.send(CODE);
    expect(h.state()).toMatchObject({ step: 'verified' });
  });

  it("maps LazyApp's own refusals to plain words", async () => {
    const { h } = setup();
    h.api.on('POST', '/v1/otp', () => ({
      status: 422,
      body: { message: 'Daily OTP limit reached for this recipient.' },
    }));
    await h.user.send('DEMO OTP');
    h.clear();

    await h.user.tap('otp:chat');

    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining("today's quota") } });
    expect(h.state()).toMatchObject({ step: 'menu', codesSent: 0 });
  });

  it('caps codes per chat session', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    for (let index = 0; index < 3; index += 1) {
      await h.user.tap('otp:chat');
      h.advance(31_000);
    }
    h.clear();

    await h.user.tap('otp:chat');

    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(0);
    expect(h.texts()[0]).toContain("You've had 3 codes in this demo already");
  });

  it('nudges on text that is not a code, and on codes nobody asked for', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    h.clear();

    await h.user.send('123456');
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('no code waiting') } });

    await h.user.tap('otp:chat');
    h.clear();
    await h.user.send('my code is abc');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("doesn't look like a code") },
    });
    expect(h.callsTo('POST', '/v1/otp/verify')).toHaveLength(0);

    await h.user.sendMedia('image');
    expect(h.texts().at(-1)).toContain('Paste the code');
  });

  it('explains that username-only accounts cannot receive codes', async () => {
    const { h } = setup();
    const user = h.as('IN.0a1b2c3d4e5f', 'ghost');
    await user.send('DEMO OTP');
    h.clear();

    await user.tap('otp:chat');

    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(0);
    expect(h.texts()[0]).toContain('only shares a username');
  });

  it('explains how it works, then shows the menu again', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    h.clear();

    await h.user.tap('otp:how');

    expect(h.texts()[0]).toContain('POST /v1/otp');
    expect(h.texts()[0]).toContain('ONE_TAP');
    expect(h.lastChoices()).toEqual(['otp:chat', 'otp:web', 'otp:how']);
  });

  it('answers stale buttons with the menu', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    h.clear();
    await h.user.tap('shop:old-button');
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('older message') } });
  });

  it('ends cleanly on EXIT mid-verification, and is silent afterwards', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    await h.user.tap('otp:chat');
    h.clear();

    await h.user.send('exit');

    expect(h.texts()[0]).toContain('Thanks for trying Login with WhatsApp');
    expect(h.session()).toBeUndefined();
    h.clear();
    expect(await h.user.send(CODE)).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('ends after 24 hours idle', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    h.advance(24 * 60 * 60_000 + 1);
    h.clear();

    expect(await h.user.send('MENU')).toMatchObject({ status: 'ignored' });
    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/v1/messages')).toHaveLength(0);
  });

  it('opts the person out on STOP', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    h.clear();

    await h.user.send('STOP');

    expect(h.texts()[0]).toContain("You're opted out");
    expect(h.store.isOptedOut(h.user.phone)).toBe(true);
  });
});
