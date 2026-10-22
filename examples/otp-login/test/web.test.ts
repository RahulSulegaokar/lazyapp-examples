import type { Harness } from '@lazyapp-examples/demo-kit/testing';
import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import otpLogin from '../src/index.js';
import type { OtpState } from '../src/state.js';
import { CODE, installFakeOtp } from './fake-otp.js';

const harnesses: { close(): void }[] = [];
const setup = () => {
  const h = createHarness(otpLogin, { displayName: 'Asha' });
  harnesses.push(h);
  return { h, fake: installFakeOtp(h) };
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

type Json = Readonly<Record<string, unknown>>;
const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

/** Starts the demo in WhatsApp and returns the one-time ticket from the "Open login page" button. */
async function ticketFromChat(h: Harness<OtpState>): Promise<string> {
  await h.user.send('DEMO OTP');
  await h.user.tap('otp:web', 'Sign in on web');
  const cta = h.lastInteractive();
  if (cta?.type !== 'cta_url') {
    throw new Error('expected the login link');
  }
  return new URL(cta.action.parameters.url).searchParams.get('t') ?? '';
}

describe('otp-login: web sign-in page', () => {
  it('serves a self-contained page with strict security headers', async () => {
    const { h } = setup();

    const response = await h.web('/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await response.text();
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('"/x/otp-login/api/"');
  });

  it('sends the chat a login link that carries an opaque ticket, never the number', async () => {
    const { h } = setup();
    await h.user.send('DEMO OTP');
    h.clear();

    await h.user.tap('otp:web');

    expect(h.lastInteractive()).toMatchObject({
      type: 'cta_url',
      action: {
        parameters: {
          display_text: 'Open login page',
          url: expect.stringMatching(/^https:\/\/demo\.test\/x\/otp-login\/\?t=[\w-]{24}$/),
        },
      },
    });
    const url = (h.lastInteractive() as { action: { parameters: { url: string } } }).action.parameters.url;
    expect(url).not.toContain('9800000001');
  });

  it('signs in end to end and posts a sign-in alert in the chat', async () => {
    const { h, fake } = setup();
    const ticket = await ticketFromChat(h);

    const identify = await h.web('/api/identify', { body: { ticket } });
    expect(identify.status).toBe(200);
    const { attempt, number } = await json(identify);
    expect(number).toBe('+91 •••••• 0001');

    h.clear();
    const send = await h.web('/api/send', { body: { attempt } });
    expect(send.status).toBe(200);
    expect(await json(send)).toMatchObject({ resendAfter: 30, expiresAt: expect.any(String) });
    expect(h.callsTo('POST', '/v1/otp')[0]?.body).toMatchObject({
      to: h.user.phone,
      template_name: 'demo_otp_login_code',
    });

    const wrong = await h.web('/api/verify', { body: { attempt, code: '000000' } });
    expect(wrong.status).toBe(422);
    expect(await json(wrong)).toMatchObject({ error: 'invalid' });

    const verify = await h.web('/api/verify', { body: { attempt, code: CODE } });
    expect(verify.status).toBe(200);
    const cookie = verify.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^lz_otp_demo=[\w-]+; Path=\/x\/otp-login; HttpOnly; Secure; SameSite=Lax/);

    const me = await h.web('/api/me', { headers: { cookie: cookie.split(';')[0] ?? '' } });
    expect(await json(me)).toEqual({ signedIn: true, number: '+91 •••••• 0001' });

    // LazyApp fires otp.verified; the demo turns it into a "new sign-in" alert in the chat.
    h.clear();
    await h.event('otp.verified', {
      verification: {
        uuid: fake.challenges[0]?.id,
        to: h.user.phone,
        attempts: 2,
        max_attempts: 5,
        status: 'verified',
      },
    });
    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { text: '🔔 New sign-in' },
      body: { text: expect.stringContaining('sign in to the *LazyApp demo* on the web') },
    });
    expect(h.lastChoices()).toEqual(['otp:not-me', 'demo:menu']);

    // "It wasn't me" signs the web session out.
    h.clear();
    await h.user.tap('otp:not-me', "It wasn't me");
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('1 web session was signed out') },
    });
    const after = await h.web('/api/me', { headers: { cookie: cookie.split(';')[0] ?? '' } });
    expect(await json(after)).toEqual({ signedIn: false });
  });

  it('does not alert for codes verified in the chat itself', async () => {
    const { h, fake } = setup();
    await h.user.send('DEMO OTP');
    await h.user.tap('otp:chat');
    await h.user.send(CODE);
    h.clear();

    await h.event('otp.verified', { verification: { uuid: fake.challenges[0]?.id, to: h.user.phone } });

    expect(h.messages()).toHaveLength(0);
  });

  it('warns the chat once when someone keeps typing wrong codes on the web', async () => {
    const { h, fake } = setup();
    const ticket = await ticketFromChat(h);
    const { attempt } = await json(await h.web('/api/identify', { body: { ticket } }));
    await h.web('/api/send', { body: { attempt } });
    const uuid = fake.challenges[0]?.id;
    h.clear();

    await h.event('otp.failed', { verification: { uuid, to: h.user.phone, attempts: 1, max_attempts: 5 } });
    expect(h.messages()).toHaveLength(0);

    await h.event('otp.failed', { verification: { uuid, to: h.user.phone, attempts: 2, max_attempts: 5 } });
    expect(h.texts()[0]).toContain(
      'Someone entered a wrong code for your number on the demo login page (2 of 5 attempts)',
    );

    h.clear();
    await h.event('otp.failed', { verification: { uuid, to: h.user.phone, attempts: 3, max_attempts: 5 } });
    expect(h.messages()).toHaveLength(0);
  });

  it('never sends a code to a number that is not in the demo chat', async () => {
    const { h } = setup();

    const response = await h.web('/api/identify', { body: { phone: '98765 43210' } });

    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ error: 'not_in_demo', startCode: 'DEMO OTP' });
    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(0);
  });

  it('accepts a typed number when that number is in the demo chat', async () => {
    const { h } = setup();
    await h.as('+919876543210').send('DEMO OTP');

    const response = await h.web('/api/identify', { body: { phone: '098765 43210' } });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ number: '+91 •••••• 3210' });
  });

  it('rejects expired links and malformed numbers', async () => {
    const { h } = setup();
    const ticket = await ticketFromChat(h);
    h.advance(16 * 60_000);

    const expired = await h.web('/api/identify', { body: { ticket } });
    expect(expired.status).toBe(422);
    expect(await json(expired)).toMatchObject({ error: 'link_expired' });

    const bad = await h.web('/api/identify', { body: { phone: '12345678' } });
    expect(await json(bad)).toMatchObject({ error: 'bad_phone' });
  });

  it('enforces the resend cool-off with Retry-After', async () => {
    const { h } = setup();
    const ticket = await ticketFromChat(h);
    const { attempt } = await json(await h.web('/api/identify', { body: { ticket } }));
    await h.web('/api/send', { body: { attempt } });
    h.advance(5_000);

    const again = await h.web('/api/send', { body: { attempt } });

    expect(again.status).toBe(429);
    expect(again.headers.get('retry-after')).toBe('25');
    expect(await json(again)).toMatchObject({ error: 'cooldown', retryAfter: 25 });
  });

  it('limits how many different numbers one IP can target', async () => {
    const { h } = setup();
    const phones = ['+919800000011', '+919800000012', '+919800000013', '+919800000014'];
    const statuses: number[] = [];
    for (const phone of phones) {
      await h.as(phone).send('DEMO OTP');
      const { attempt } = await json(await h.web('/api/identify', { body: { phone } }));
      statuses.push((await h.web('/api/send', { body: { attempt }, clientIp: '198.51.100.9' })).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(3);
  });

  it('stops sending once the chat has ended', async () => {
    const { h } = setup();
    const ticket = await ticketFromChat(h);
    const { attempt } = await json(await h.web('/api/identify', { body: { ticket } }));
    await h.user.send('EXIT');
    h.clear();

    const response = await h.web('/api/send', { body: { attempt } });

    expect(response.status).toBe(403);
    expect(h.callsTo('POST', '/v1/otp')).toHaveLength(0);
  });

  it('only accepts JSON (no cross-site form posts) and answers unknown routes', async () => {
    const { h } = setup();

    const form = await h.web('/api/identify', {
      method: 'POST',
      body: 'phone=9876543210',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status).toBe(400);

    expect((await h.web('/nope')).status).toBe(404);
    expect((await h.web('/api/identify')).status).toBe(405);
  });

  it('signs out', async () => {
    const { h } = setup();
    const response = await h.web('/api/signout', { body: {}, headers: { cookie: 'lz_otp_demo=abc' } });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
