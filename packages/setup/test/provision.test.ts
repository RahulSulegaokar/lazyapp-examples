import { loadExamples } from '@lazyapp-examples/demo-kit';
import { FakeLazyApp } from '@lazyapp-examples/demo-kit/testing';
import { LazyAppClient } from '@lazyapp-examples/sdk';
import type { ConversationStarters, Flow, QrCode, Template, WebhookEndpoint } from '@lazyapp-examples/sdk';
import { describe, expect, it } from 'vitest';
import { provision, renderTable } from '../src/index.js';

/** A FakeLazyApp with just enough state for setup's endpoints. */
function fakeWorkspace() {
  const api = new FakeLazyApp();
  const templates: Template[] = [];
  const flows: (Omit<Flow, 'status'> & { status: string; flow_json: unknown })[] = [];
  const webhooks: WebhookEndpoint[] = [];
  const qrCodes: QrCode[] = [];
  let starters: ConversationStarters = {
    ice_breakers: ['Talk to sales'],
    commands: [{ name: 'login', description: 'Get a login code' }],
    welcome_message: true,
  };

  api
    .on('GET', '/v1/connections', () => ({
      status: 200,
      body: {
        data: [
          {
            uuid: 'conn-1',
            phone_number_id: 'pn-1',
            display_phone_number: '+91 80000 00000',
            verified_name: 'LazyApp',
            waba_id: 'w',
            mode: 'live',
            is_default: true,
            status: 'active',
          },
        ],
      },
    }))
    .on('GET', '/v1/templates', () => ({ status: 200, body: { data: templates, next_cursor: null } }))
    .on('POST', '/v1/templates', (call) => {
      const input = call.body as { name: string; language: string; category: Template['category'] };
      templates.push({
        uuid: `t${templates.length}`,
        name: input.name,
        language: input.language,
        category: input.category,
        status: 'pending',
      });
      return { status: 201, body: templates.at(-1) };
    })
    .on('GET', '/v1/flows', () => ({ status: 200, body: { data: flows, next_cursor: null } }))
    .on('POST', '/v1/flows', (call) => {
      const input = call.body as {
        name: string;
        categories: string[];
        flow_json: unknown;
        data_endpoint_uri: string | null;
      };
      flows.push({
        uuid: `f${flows.length}`,
        name: input.name,
        status: 'draft',
        categories: input.categories,
        provider_flow_id: `meta-${input.name}`,
        data_endpoint_uri: input.data_endpoint_uri,
        published_at: null,
        flow_json: input.flow_json,
      });
      return { status: 201, body: flows.at(-1) };
    })
    .on('POST', '/v1/flows/:uuid/publish', (_call, params) => {
      const flow = flows.find((entry) => entry.uuid === params.uuid)!;
      flow.status = 'published';
      return { status: 200, body: flow };
    })
    .on('GET', '/v1/flows/:uuid', (_call, params) => ({
      status: 200,
      body: flows.find((entry) => entry.uuid === params.uuid),
    }))
    .on('GET', '/v1/webhooks', () => ({ status: 200, body: { data: webhooks, next_cursor: null } }))
    .on('POST', '/v1/webhooks', (call) => {
      const input = call.body as { url: string; subscribed_events: string[] };
      webhooks.push({
        id: webhooks.length + 1,
        url: input.url,
        description: null,
        is_active: true,
        subscribed_events: input.subscribed_events,
      });
      return { status: 201, body: { ...webhooks.at(-1), secret: 'whsec_created_once' } };
    })
    .on('GET', '/v1/connections/:uuid/conversation-starters', () => ({ status: 200, body: starters }))
    .on('PUT', '/v1/connections/:uuid/conversation-starters', (call) => {
      starters = call.body as ConversationStarters;
      return { status: 200, body: starters };
    })
    .on('GET', '/v1/connections/:uuid/qr-codes', () => ({ status: 200, body: { data: qrCodes } }))
    .on('POST', '/v1/connections/:uuid/qr-codes', (call) => {
      const input = call.body as { prefilled_message: string };
      qrCodes.push({
        code: `QR${qrCodes.length}`,
        prefilled_message: input.prefilled_message,
        deep_link_url: `https://wa.me/message/QR${qrCodes.length}`,
        qr_image_url: null,
      });
      return { status: 201, body: qrCodes.at(-1) };
    });

  const client = new LazyAppClient({
    apiKey: 'sk_test_setup',
    baseUrl: 'https://lazyapp.test',
    fetch: api.fetch,
    maxRetries: 0,
  });
  return { api, client, starters: () => starters };
}

const options = async (client: LazyAppClient, dryRun: boolean) => ({
  api: client,
  examples: await loadExamples(undefined, { includeReference: true, only: ['hello'] }),
  publicBaseUrl: 'https://demo.lazyapp.in/',
  dryRun,
  webhookEvents: ['message.received', 'message.failed'] as const,
});

describe('provision', () => {
  it('only reads during a dry run and reports what it would create', async () => {
    const { api, client } = fakeWorkspace();

    const result = await provision(await options(client, true));

    expect(api.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(result.rows.map((row) => `${row.resource}:${row.status}`)).toEqual([
      'connection:exists',
      'template:would create',
      'flow:would create',
      'webhook:would create',
      'starters:would update',
      'link:exists',
      'qr:would create',
    ]);
    expect(renderTable(result.rows)).toContain('demo_hello_follow_up');
  });

  it('creates everything once, then finds it all on the next run', async () => {
    const { client, starters } = fakeWorkspace();

    const first = await provision(await options(client, false));

    expect(first.webhookSecret).toBe('whsec_created_once');
    expect(first.rows.filter((row) => row.status === 'failed')).toEqual([]);
    expect(first.rows.find((row) => row.resource === 'flow')).toMatchObject({
      status: 'created',
      detail: expect.stringContaining('published'),
    });
    expect(starters().commands.map((command) => command.name)).toEqual(['login', 'hello']);
    expect(starters().ice_breakers).toEqual(['Talk to sales']);
    expect(starters().welcome_message).toBe(true);
    expect(first.rows.find((row) => row.resource === 'link')?.detail).toBe(
      'https://wa.me/918000000000?text=DEMO%20HELLO',
    );

    const second = await provision(await options(client, false));

    expect(second.webhookSecret).toBeNull();
    expect(new Set(second.rows.map((row) => row.status))).toEqual(new Set(['exists']));
  });

  it('flags a webhook whose events are out of date instead of silently diverging', async () => {
    const { client } = fakeWorkspace();
    await provision(await options(client, false));

    const result = await provision({
      ...(await options(client, false)),
      webhookEvents: ['message.received', 'payment.captured'],
    });

    expect(result.rows.find((row) => row.resource === 'webhook')).toMatchObject({
      status: 'action needed',
      detail: expect.stringContaining('payment.captured'),
    });
  });
});
