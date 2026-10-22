import { LazyAppClient, signWebhookBody } from '@lazyapp-examples/sdk';
import { DemoRuntime, DemoStore, loadExamples, silentLogger } from '@lazyapp-examples/demo-kit';
import { FakeLazyApp } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, loadConfig } from '../src/index.js';

const SECRET = 'whsec_server_test_secret';

async function build() {
  const examples = await loadExamples(undefined, { includeReference: true });
  const api = new FakeLazyApp();
  const store = new DemoStore(':memory:');
  const runtime = new DemoRuntime({
    examples,
    api: new LazyAppClient({
      apiKey: 'sk_test_x',
      baseUrl: 'https://lazyapp.test',
      fetch: api.fetch,
      maxRetries: 0,
    }),
    store,
    log: silentLogger,
    webhookSecret: SECRET,
    flowSecrets: { 'hello/feedback': 'whfs_flow_secret' },
    config: { publicBaseUrl: 'https://demo.test' },
  });
  const app = createApp({ runtime, log: silentLogger, examples, demoPhoneNumber: '+91 98765 43210' });
  return { app, api, store, runtime };
}

const delivery = (id: string, text: string) =>
  JSON.stringify({
    id,
    type: 'message.received',
    created_at: '2026-10-23T10:00:00+00:00',
    data: {
      message: {
        uuid: `in-${id}`,
        conversation_id: 'cnv_1',
        direction: 'inbound',
        status: 'received',
        type: 'text',
        from: '+919812345670',
        to: '+910000000000',
        contact: { uuid: 'c1', phone_number: '+919812345670', bsuid: null, username: null },
        body: text,
        content: { text: { body: text } },
        group: null,
        metadata: null,
        provider_message_id: `wamid.${id}`,
      },
    },
  });

const post = (path: string, body: string, signature?: string) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'x-lazyapp-signature': signature }),
    },
  });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe('demo server', () => {
  it('acknowledges a signed delivery with 202, processes it, and dedupes the redelivery', async () => {
    const { app, api, store, runtime } = await build();
    cleanups.push(() => {
      store.close();
    });
    const body = delivery('evt_1', 'DEMO HELLO');

    const first = await app.request(post('/webhooks/lazyapp', body, signWebhookBody(body, SECRET)));
    expect(first.status).toBe(202);
    const second = await app.request(post('/webhooks/lazyapp', body, signWebhookBody(body, SECRET)));
    expect(await second.json()).toEqual({ status: 'duplicate', id: 'evt_1' });

    await runtime.close();
    expect(api.calls.filter((call) => call.path === '/v1/messages')).toHaveLength(1);
  });

  it('rejects unsigned or tampered deliveries', async () => {
    const { app, store } = await build();
    cleanups.push(() => {
      store.close();
    });
    const body = delivery('evt_2', 'DEMO HELLO');

    expect((await app.request(post('/webhooks/lazyapp', body))).status).toBe(401);
    expect(
      (await app.request(post('/webhooks/lazyapp', `${body} `, signWebhookBody(body, SECRET)))).status,
    ).toBe(401);
  });

  it('serves flow data exchange behind per-flow signatures', async () => {
    const { app, store } = await build();
    cleanups.push(() => {
      store.close();
    });
    const ping = JSON.stringify({ version: '3.0', action: 'ping' });
    const pong = await app.request(
      post('/flows/hello/feedback', ping, signWebhookBody(ping, 'whfs_flow_secret')),
    );
    expect(await pong.json()).toEqual({ data: { status: 'active' } });

    expect((await app.request(post('/flows/hello/feedback', ping, 'sha256=nope'))).status).toBe(401);

    const init = JSON.stringify({ version: '3.0', action: 'INIT', flow_token: 'stale' });
    expect(
      (await app.request(post('/flows/hello/feedback', init, signWebhookBody(init, 'whfs_flow_secret'))))
        .status,
    ).toBe(404);
  });

  it('reports health and the public demo catalogue', async () => {
    const { app, store } = await build();
    cleanups.push(() => {
      store.close();
    });

    const health = await app.request('/healthz');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', examples: expect.arrayContaining(['hello']) });

    const demos = (await (await app.request('/demos')).json()) as {
      demos: { id: string; chatLink: string }[];
    };
    expect(demos.demos.find((demo) => demo.id === 'hello')?.chatLink).toBe(
      'https://wa.me/919876543210?text=DEMO%20HELLO',
    );
    expect((await app.request('/nope')).status).toBe(404);
  });

  it('serves example web pages under /x/<example>/', async () => {
    const { app, store } = await build();
    cleanups.push(() => {
      store.close();
    });

    const page = await app.request('/x/otp-login/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect((await app.request('/x/otp-login')).status).toBe(200);
    expect((await app.request('/x/not-an-example/')).status).toBe(404);
  });
});

describe('loadConfig', () => {
  const base = { LAZYAPP_API_KEY: 'sk_live_abc', LAZYAPP_WEBHOOK_SECRET: 'whsec_0123456789abcdef' };

  it('applies defaults and parses lists and flow secrets', () => {
    const config = loadConfig({
      ...base,
      DEMO_EXAMPLES: 'shop, food',
      LAZYAPP_FLOW_SECRETS: '{"shop/checkout":"whfs_x"}',
      INCLUDE_REFERENCE_EXAMPLE: 'true',
    });
    expect(config).toMatchObject({
      LAZYAPP_BASE_URL: 'https://lazyapp.in',
      PORT: 8787,
      DEMO_EXAMPLES: ['shop', 'food'],
      LAZYAPP_FLOW_SECRETS: { 'shop/checkout': 'whfs_x' },
      INCLUDE_REFERENCE_EXAMPLE: true,
      SESSION_IDLE_HOURS: 24,
    });
  });

  it('fails fast listing every problem', () => {
    expect(() => loadConfig({ LAZYAPP_API_KEY: 'nope', LAZYAPP_FLOW_SECRETS: '{bad' })).toThrow(
      /LAZYAPP_API_KEY[\s\S]*LAZYAPP_WEBHOOK_SECRET[\s\S]*LAZYAPP_FLOW_SECRETS/,
    );
  });
});
