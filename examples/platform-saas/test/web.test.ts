import { createLogger } from '@lazyapp-examples/demo-kit';
import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import { signWebhookBody } from '@lazyapp-examples/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { PlatformSaasConfig } from '../src/config.js';
import { configFromEnv } from '../src/config.js';
import { createPlatformSaasExample } from '../src/index.js';
import { EMBED_SECRET, installFakePlatform, SETUP_SECRET } from './fake-platform.js';

const SECRET = 'whsec_salonbook_test_secret';
const CONFIG: PlatformSaasConfig = {
  ...DEFAULT_CONFIG,
  platformApiKey: 'sk_test_platform',
  lazyappBaseUrl: 'https://lazyapp.test',
  webhookSecret: SECRET,
};

type Json = Readonly<Record<string, unknown>> & { readonly salons?: readonly Record<string, unknown>[] };

const open: { close(): void }[] = [];
function setup(config: Partial<PlatformSaasConfig> = {}, embedOrigin?: string) {
  const lines: string[] = [];
  const merged = { ...CONFIG, ...config };
  const example = createPlatformSaasExample(merged, {
    platformClient: (web) => (merged.platformApiKey === null ? null : web.api),
  });
  const h = createHarness(example, {
    log: createLogger({ sink: (line) => lines.push(line), level: 'debug' }),
  });
  open.push(h);
  const fake = installFakePlatform(h, embedOrigin === undefined ? {} : { embedOrigin });
  const post = (path: string, headers: Record<string, string> = {}) =>
    h.web(path, { method: 'POST', body: {}, headers });
  const json = async (response: Response): Promise<Json> => (await response.json()) as Json;
  const salon = async (slug: string) =>
    ((await json(await h.web('/api/salons'))).salons ?? []).find((entry) => entry.slug === slug) ?? {};
  return { h, fake, lines, post, json, salon };
}
afterEach(() => {
  for (const harness of open.splice(0)) {
    harness.close();
  }
});

async function webhook(
  h: ReturnType<typeof setup>['h'],
  event: Record<string, unknown>,
  secret = SECRET,
): Promise<Response> {
  const body = JSON.stringify(event);
  return h.web('/webhooks', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-lazyapp-signature': signWebhookBody(body, secret) },
  });
}

describe('platform-saas: SalonBook admin', () => {
  it('serves the admin page with a CSP that frames only LazyApp', async () => {
    const { h } = setup();

    const response = await h.web('/');

    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('frame-src https://lazyapp.test');
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).toContain('LazyApp test mode');
    expect(html).not.toContain('sk_test_platform');
  });

  it('creates a salon once, as a platform customer keyed by a day-stamped external_id', async () => {
    const { h, post, json } = setup();

    const first = await json(await post('/api/salons/glow-studio/customer'));
    await post('/api/salons/glow-studio/customer');

    const creates = h.callsTo('POST', '/v1/platform/customers');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({
      name: 'Glow Studio',
      external_id: 'salonbook-demo-glow-studio-20261023',
      billing_mode: 'inherit',
    });
    expect(creates[0]?.idempotencyKey).toBe('salonbook:customer:salonbook-demo-glow-studio-20261023');
    expect(first).toEqual({ customerId: 'cus_1', externalId: 'salonbook-demo-glow-studio-20261023' });
  });

  it('only knows the seed salons', async () => {
    const { post } = setup();
    expect((await post('/api/salons/acme-corp/customer')).status).toBe(404);
  });

  it('issues a setup link with a QR code, and never logs or stores its URL', async () => {
    const { h, post, json, lines } = setup();
    expect((await post('/api/salons/glow-studio/setup-link')).status).toBe(409);
    await post('/api/salons/glow-studio/customer');

    const link = await json(await post('/api/salons/glow-studio/setup-link'));

    expect(link).toMatchObject({ id: 'set_2', url: `https://lazyapp.test/connect/${SETUP_SECRET}` });
    expect(String(link.qrSvg)).toMatch(/^<svg/);
    expect(h.callsTo('POST', '/v1/platform/setup-links')[0]?.body).toMatchObject({
      customer_id: 'cus_1',
      expires_in_days: 1,
      use_policy: 'single',
      redirect_url: 'https://demo.test/x/platform-saas/?connected=1',
    });
    expect(lines.join('\n')).toContain('set_2');
    expect(lines.join('\n')).not.toContain(SETUP_SECRET);
    const stored = JSON.stringify(h.store.keyValue('example:platform-saas', () => h.now()).list(''));
    expect(stored).not.toContain(SETUP_SECRET);
  });

  it('mints a fresh, short-lived, origin-locked embed token per view', async () => {
    const { h, post, json, lines } = setup();
    await post('/api/salons/mane-street/customer');

    const inbox = await json(await post('/api/salons/mane-street/embed/inbox'));
    await post('/api/salons/mane-street/embed/inbox');

    expect(inbox).toMatchObject({ component: 'inbox', url: `https://lazyapp.test/embed/${EMBED_SECRET}` });
    const mints = h.callsTo('POST', '/v1/platform/embed-tokens');
    expect(mints).toHaveLength(2);
    expect(mints[0]?.body).toEqual({
      customer_id: 'cus_1',
      component: 'inbox',
      expires_in_minutes: 10,
      origin_allowlist: ['https://demo.test'],
      locale: 'en',
    });
    expect(lines.join('\n')).not.toContain(EMBED_SECRET);
    expect((await post('/api/salons/mane-street/embed/billing')).status).toBe(404);
  });

  it('refuses an embed URL that is not on LazyApp’s origin', async () => {
    const { post } = setup({}, 'https://evil.example');
    await post('/api/salons/glow-studio/customer');

    const response = await post('/api/salons/glow-studio/embed/usage');

    expect(response.status).toBe(502);
  });

  it('reads usage from LazyApp’s analytics shape and caches it for a minute', async () => {
    const { h, post, json } = setup();
    await post('/api/salons/trim-room/customer');

    const usage = await json(await h.web('/api/salons/trim-room/usage'));
    await h.web('/api/salons/trim-room/usage');
    h.advance(61_000);
    await h.web('/api/salons/trim-room/usage');

    expect(usage).toMatchObject({
      period: '2026-10',
      messages: 42,
      totalCharge: '9.840000',
      currency: 'INR',
      billingMode: 'inherit',
      byCategory: [
        { category: 'utility', messages: 30 },
        { category: 'marketing', messages: 12 },
      ],
    });
    const reads = h.callsTo('GET', '/v1/platform/customers/cus_1/usage');
    expect(reads).toHaveLength(2);
    expect(reads[0]?.query).toEqual({ period: '2026-10' });
  });

  it('provisions an automation pack acting for the salon with X-LazyApp-Customer', async () => {
    const { h, post, json } = setup();
    await post('/api/salons/glow-studio/customer');

    const result = await json(await post('/api/salons/glow-studio/automation-pack'));

    const call = h.callsTo('PUT', '/v1/automation-packs/provision')[0];
    expect(call?.customer).toBe('salonbook-demo-glow-studio-20261023');
    expect(call?.body).toEqual({ pack: 'real_estate' });
    expect(result.summary).toContain('event mappings: 3 created');
  });

  it('rejects cross-site writes and rate limits each visitor', async () => {
    const { post } = setup();

    expect((await post('/api/salons/glow-studio/customer', { origin: 'https://evil.example' })).status).toBe(
      403,
    );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt++) {
      statuses.push((await post('/api/salons/glow-studio/simulate/customer.connected')).status);
    }
    expect(statuses.slice(0, 20).every((status) => status !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('answers 503 with setup instructions when no platform key is configured', async () => {
    const { h, post, json } = setup({ platformApiKey: null });

    expect((await json(await h.web('/api/salons'))).configured).toBe(false);
    expect((await post('/api/salons/glow-studio/customer')).status).toBe(503);
    expect(h.calls).toHaveLength(0);
  });

  it('resets the demo every day, removing yesterday’s salons from LazyApp', async () => {
    const { h, post, fake, salon } = setup();
    await post('/api/salons/glow-studio/customer');
    expect((await salon('glow-studio')).customerId).toBe('cus_1');

    h.advance(24 * 3_600_000);
    const today = await salon('glow-studio');

    expect(fake.deleted).toEqual(['cus_1']);
    expect(today).toMatchObject({ customerId: null, externalId: 'salonbook-demo-glow-studio-20261024' });
  });
});

describe('platform-saas: webhooks routed by customer', () => {
  it('verifies the signature, routes by external_id and drops redeliveries', async () => {
    const { h, post, salon } = setup();
    await post('/api/salons/glow-studio/customer');
    const event = {
      id: 'evt_1',
      type: 'customer.connected',
      created_at: '2026-10-23T04:00:00Z',
      customer: { id: 'cus_1', external_id: 'salonbook-demo-glow-studio-20261023', name: 'Glow Studio' },
      data: { connection: { display_phone_number: '+91 80 4718 2290' } },
    };

    expect((await webhook(h, event, 'wrong-secret')).status).toBe(401);
    expect(await (await webhook(h, event)).json()).toMatchObject({ status: 'applied', salon: 'glow-studio' });
    expect(await (await webhook(h, event)).json()).toMatchObject({ status: 'duplicate' });

    const glow = await salon('glow-studio');
    expect(glow).toMatchObject({ connection: 'connected', connectedNumber: '+91 80 4718 2290' });
    expect(glow.activity).toHaveLength(1);
    expect((await salon('mane-street')).connection).toBe('not_connected');
  });

  it('records failures, usage alerts and inbound messages without message content', async () => {
    const { h, post, salon } = setup();
    await post('/api/salons/mane-street/customer');
    const customer = { id: 'cus_1', external_id: 'salonbook-demo-mane-street-20261023', name: 'Mane Street' };

    await webhook(h, {
      id: 'evt_a',
      type: 'setup_link.failed',
      customer,
      data: { reason: 'Number already in use' },
    });
    await webhook(h, {
      id: 'evt_b',
      type: 'customer.usage_alert',
      customer,
      data: { usage: { total_charge: '51.00' } },
    });
    await webhook(h, {
      id: 'evt_c',
      type: 'message.received',
      customer,
      data: { message: { type: 'text', from: '+919812345670', body: 'Can I book a haircut at 5?' } },
    });

    const mane = await salon('mane-street');
    expect(mane).toMatchObject({ connection: 'failed', failureReason: 'Number already in use' });
    expect(mane.usageAlert).toMatchObject({ detail: expect.stringContaining('₹51.00') });
    const log = JSON.stringify(mane.activity);
    expect(log).toContain('Inbound text from +91******5670');
    expect(log).not.toContain('haircut');
    expect(log).not.toContain('+919812345670');
  });

  it('ignores deliveries for unknown customers, without a customer, and test pings', async () => {
    const { h } = setup();

    const unknown = await webhook(h, {
      id: 'evt_x',
      type: 'customer.connected',
      customer: { id: 'cus_other', external_id: 'someone-else', name: 'Other' },
      data: {},
    });
    const own = await webhook(h, { id: 'evt_y', type: 'message.received', data: { message: {} } });
    const ping = await webhook(h, { id: 'evt_test_1', type: 'message.sent', test: true, data: {} });

    expect(await unknown.json()).toMatchObject({ status: 'ignored', reason: 'unknown customer' });
    expect(await own.json()).toMatchObject({ status: 'ignored' });
    expect(await ping.json()).toMatchObject({ status: 'ignored', reason: 'test delivery' });
    expect(h.calls).toHaveLength(0);
  });

  it('simulates an event through the same routing, labelled as simulated', async () => {
    const { post, json, salon } = setup();
    await post('/api/salons/trim-room/customer');

    const outcome = await json(await post('/api/salons/trim-room/simulate/customer.connected'));

    expect(outcome).toMatchObject({ status: 'applied', salon: 'trim-room', type: 'customer.connected' });
    const trim = await salon('trim-room');
    expect(trim.connection).toBe('connected');
    expect(JSON.stringify(trim.activity)).toContain('"source":"simulated"');
  });
});

describe('platform-saas: configuration', () => {
  it('only accepts test keys unless live is explicitly allowed', () => {
    expect(configFromEnv({ PLATFORM_SAAS_API_KEY: 'sk_test_abc' }).platformApiKey).toBe('sk_test_abc');
    expect(() => configFromEnv({ PLATFORM_SAAS_API_KEY: 'sk_live_abc' })).toThrow(/test key/);
    expect(
      configFromEnv({ PLATFORM_SAAS_API_KEY: 'sk_live_abc', PLATFORM_SAAS_ALLOW_LIVE: 'true' })
        .platformApiKey,
    ).toBe('sk_live_abc');
    expect(configFromEnv({}).platformApiKey).toBeNull();
  });
});
