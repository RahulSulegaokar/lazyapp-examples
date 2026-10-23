import { flowName } from '@lazyapp-examples/demo-kit';
import type { AnyExample, FlowSpec, TemplateSpec } from '@lazyapp-examples/demo-kit';
import { LazyAppError, paginate, WHATSAPP_LIMITS } from '@lazyapp-examples/sdk';
import type {
  Connection,
  ConversationStarters,
  Flow,
  LazyAppClient,
  Template,
  WebhookEndpoint,
  WebhookEventType,
} from '@lazyapp-examples/sdk';

export type RowStatus =
  'exists' | 'created' | 'updated' | 'would create' | 'would update' | 'skipped' | 'action needed' | 'failed';

export interface SummaryRow {
  readonly example: string;
  readonly resource: 'connection' | 'template' | 'flow' | 'webhook' | 'starters' | 'qr' | 'link';
  readonly name: string;
  readonly status: RowStatus;
  readonly detail: string;
}

export interface ProvisionOptions {
  readonly api: LazyAppClient;
  readonly examples: readonly AnyExample[];
  /** Public origin of the demo server, e.g. `https://demo.lazyapp.in`. */
  readonly publicBaseUrl: string;
  readonly dryRun: boolean;
  readonly connectionUuid?: string | undefined;
  readonly phoneNumberId?: string | undefined;
  /** Publish new or draft flows (published flows can no longer be edited). Default true. */
  readonly publishFlows?: boolean | undefined;
  /** Also merge each example's ice breaker into the number's (max 4, shown to everyone). Default false. */
  readonly iceBreakers?: boolean | undefined;
  /** Commands also show to everyone who chats with the number, so they are opt-in like ice breakers. */
  readonly commands?: boolean | undefined;
  /** Delete and recreate the webhook endpoint when its events are out of date (new secret!). */
  readonly recreateWebhook?: boolean | undefined;
  /** Events the server needs; usually `DemoRouter.requiredEvents()`. */
  readonly webhookEvents: readonly WebhookEventType[];
}

export interface ProvisionResult {
  readonly rows: readonly SummaryRow[];
  /** Set when a webhook endpoint was created: the signing secret, shown once by LazyApp. */
  readonly webhookSecret: string | null;
  readonly connection: Connection | null;
}

/**
 * Idempotent provisioning for every example manifest. Reads first, then creates
 * only what is missing; `dryRun` performs the reads and reports what it would do.
 */
export async function provision(options: ProvisionOptions): Promise<ProvisionResult> {
  const rows: SummaryRow[] = [];
  const add = (row: SummaryRow) => rows.push(row);
  const { api } = options;
  const publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');

  const connection = await pickConnection(api, options.connectionUuid, options.phoneNumberId);
  add({
    example: '*',
    resource: 'connection',
    name: connection?.display_phone_number ?? '(none)',
    status: connection === null ? 'action needed' : 'exists',
    detail:
      connection === null
        ? 'No active connection: finish WhatsApp setup in LazyApp, or set LAZYAPP_CONNECTION_UUID'
        : `${connection.verified_name ?? 'unnamed'} · ${connection.uuid} · ${connection.mode}`,
  });

  await provisionTemplates(options, add);
  await provisionFlows(options, publicBaseUrl, add);
  const webhookSecret = await provisionWebhook(options, publicBaseUrl, connection, add);
  if (connection !== null) {
    await provisionStarters(options, connection, add);
    await provisionQrCodes(options, connection, add);
  }
  return { rows, webhookSecret, connection };
}

async function pickConnection(
  api: LazyAppClient,
  uuid: string | undefined,
  phoneNumberId: string | undefined,
): Promise<Connection | null> {
  const { data } = await api.connections.list();
  const active = data.filter((connection) => connection.status === 'active');
  return (
    active.find((connection) => connection.uuid === uuid) ??
    active.find((connection) => connection.phone_number_id === phoneNumberId) ??
    (uuid === undefined && phoneNumberId === undefined
      ? (active.find((connection) => connection.is_default) ?? active[0])
      : undefined) ??
    null
  );
}

async function provisionTemplates(options: ProvisionOptions, add: (row: SummaryRow) => void): Promise<void> {
  const existing = new Map<string, Template>();
  for await (const template of paginate((cursor) => options.api.templates.list({ limit: 100, cursor }))) {
    existing.set(`${template.name}:${template.language}`, template);
  }
  for (const example of options.examples) {
    for (const spec of example.manifest.templates ?? []) {
      const name = spec.input.name;
      const languages = spec.kind === 'authentication' ? spec.input.languages : [spec.input.language];
      const prefix = `demo_${example.id.replace(/-/g, '_')}_`;
      if (!name.startsWith(prefix)) {
        add({
          example: example.id,
          resource: 'template',
          name,
          status: 'skipped',
          detail: `Name must start with ${prefix}`,
        });
        continue;
      }
      const missing = languages.filter((language) => !existing.has(`${name}:${language}`));
      if (missing.length === 0) {
        const found = existing.get(`${name}:${languages[0] ?? ''}`);
        add({
          example: example.id,
          resource: 'template',
          name,
          status: 'exists',
          detail: `${found?.status ?? '?'} · ${spec.purpose}`,
        });
        continue;
      }
      if (options.dryRun) {
        add({
          example: example.id,
          resource: 'template',
          name,
          status: 'would create',
          detail: describeTemplate(spec),
        });
        continue;
      }
      try {
        await createTemplate(options.api, spec);
        add({
          example: example.id,
          resource: 'template',
          name,
          status: 'created',
          detail: `Submitted to Meta for review · ${describeTemplate(spec)}`,
        });
      } catch (error) {
        add({
          example: example.id,
          resource: 'template',
          name,
          status: 'failed',
          detail: errorDetail(error),
        });
      }
    }
  }
}

async function createTemplate(api: LazyAppClient, spec: TemplateSpec): Promise<void> {
  const idempotencyKey = `setup-template-${spec.input.name}`;
  if (spec.kind === 'authentication') {
    await api.templates.createAuthentication(spec.input, { idempotencyKey });
  } else {
    await api.templates.create({ submit: true, ...spec.input }, { idempotencyKey });
  }
}

function describeTemplate(spec: TemplateSpec): string {
  return spec.kind === 'authentication'
    ? `AUTHENTICATION (${spec.input.otp_type ?? 'COPY_CODE'}) · ${spec.purpose}`
    : `${spec.input.category} · ${spec.purpose}`;
}

async function provisionFlows(
  options: ProvisionOptions,
  publicBaseUrl: string,
  add: (row: SummaryRow) => void,
): Promise<void> {
  const existing = new Map<string, Flow>();
  for await (const flow of paginate((cursor) => options.api.flows.list({ limit: 100, cursor }))) {
    existing.set(flow.name, flow);
  }
  const publish = options.publishFlows ?? true;

  for (const example of options.examples) {
    for (const spec of example.manifest.flows ?? []) {
      const name = flowName(example.id, spec.key);
      const endpoint = spec.dataExchange ? `${publicBaseUrl}/flows/${example.id}/${spec.key}` : null;
      const input = {
        name,
        categories: spec.categories,
        flow_json: spec.flowJson,
        data_endpoint_uri: endpoint,
      };
      const flow = existing.get(name);
      try {
        if (flow === undefined) {
          if (options.dryRun) {
            add({
              example: example.id,
              resource: 'flow',
              name,
              status: 'would create',
              detail: flowDetail(spec, endpoint, publish),
            });
            continue;
          }
          const created = await options.api.flows.create(input, { idempotencyKey: `setup-flow-${name}` });
          const published = publish
            ? await options.api.flows.publish(created.uuid, { idempotencyKey: `setup-flow-${name}-publish` })
            : created;
          add({
            example: example.id,
            resource: 'flow',
            name,
            status: 'created',
            detail: `${published.status} · ${flowDetail(spec, endpoint, publish)}`,
          });
        } else if (flow.status.toLowerCase() === 'draft') {
          if (options.dryRun) {
            add({
              example: example.id,
              resource: 'flow',
              name,
              status: 'would update',
              detail: `draft → ${publish ? 'published' : 'draft'} with the manifest JSON`,
            });
            continue;
          }
          await options.api.flows.update(flow.uuid, input);
          if (publish) {
            await options.api.flows.publish(flow.uuid, {
              idempotencyKey: `setup-flow-${name}-publish-${flow.uuid}`,
            });
          }
          add({
            example: example.id,
            resource: 'flow',
            name,
            status: 'updated',
            detail: publish ? 'Draft updated and published' : 'Draft updated',
          });
        } else {
          const detail = await options.api.flows.get(flow.uuid);
          const drift =
            JSON.stringify(detail.flow_json) !== JSON.stringify(spec.flowJson) ||
            (detail.data_endpoint_uri ?? null) !== endpoint;
          add({
            example: example.id,
            resource: 'flow',
            name,
            status: drift ? 'action needed' : 'exists',
            detail: drift
              ? `${flow.status} flow differs from the manifest; published flows cannot be edited: deprecate it and rename the key`
              : `${flow.status} · ${spec.purpose}`,
          });
        }
      } catch (error) {
        add({ example: example.id, resource: 'flow', name, status: 'failed', detail: errorDetail(error) });
        continue;
      }
      if (spec.dataExchange) {
        add({
          example: example.id,
          resource: 'flow',
          name: `${example.id}/${spec.key}`,
          status: 'action needed',
          detail:
            'Copy the flow signing secret from LazyApp → Flows into LAZYAPP_FLOW_SECRETS (not exposed by the API)',
        });
      }
    }
  }
}

function flowDetail(spec: FlowSpec, endpoint: string | null, publish: boolean): string {
  return `${spec.categories.join(',')} · ${endpoint === null ? 'navigate (no endpoint)' : `endpoint ${endpoint}`}${publish ? ' · publish' : ''}`;
}

async function provisionWebhook(
  options: ProvisionOptions,
  publicBaseUrl: string,
  connection: Connection | null,
  add: (row: SummaryRow) => void,
): Promise<string | null> {
  const url = `${publicBaseUrl}/webhooks/lazyapp`;
  const wanted = [...options.webhookEvents].sort();
  const endpoints: WebhookEndpoint[] = [];
  for await (const endpoint of paginate((cursor) => options.api.webhooks.list({ limit: 100, cursor }))) {
    endpoints.push(endpoint);
  }
  const existing = endpoints.find((endpoint) => endpoint.url === url);
  const input = {
    url,
    description: 'LazyApp examples demo server',
    subscribed_events: wanted,
    timeout_seconds: 10,
    max_attempts: 5,
    ...(connection === null ? {} : { phone_number_restrictions: [connection.phone_number_id] }),
  };

  if (existing !== undefined) {
    const subscribed = existing.subscribed_events ?? [];
    const missing = subscribed.length === 0 ? [] : wanted.filter((event) => !subscribed.includes(event));
    const notes = [
      existing.paused_at === null || existing.paused_at === undefined
        ? null
        : `paused (${existing.pause_reason ?? 'failures'}): resume it`,
    ].filter((note): note is string => note !== null);
    if (missing.length === 0) {
      add({
        example: '*',
        resource: 'webhook',
        name: url,
        status: notes.length === 0 ? 'exists' : 'action needed',
        detail: notes.join('; ') || `${wanted.length} events`,
      });
      return null;
    }
    if (options.recreateWebhook !== true) {
      add({
        example: '*',
        resource: 'webhook',
        name: url,
        status: 'action needed',
        detail: `Missing events ${missing.join(', ')}. The API cannot edit subscriptions: rerun with --recreate-webhook (rotates the secret)`,
      });
      return null;
    }
    if (options.dryRun) {
      add({
        example: '*',
        resource: 'webhook',
        name: url,
        status: 'would update',
        detail: `recreate with ${wanted.length} events (new secret)`,
      });
      return null;
    }
    await options.api.webhooks.delete(existing.id);
  } else if (options.dryRun) {
    add({ example: '*', resource: 'webhook', name: url, status: 'would create', detail: wanted.join(', ') });
    return null;
  }

  try {
    const created = await options.api.webhooks.create(input, {
      idempotencyKey: `setup-webhook-${url}-${wanted.join(',')}`,
    });
    add({
      example: '*',
      resource: 'webhook',
      name: url,
      status: existing === undefined ? 'created' : 'updated',
      detail: 'Signing secret printed below: set LAZYAPP_WEBHOOK_SECRET',
    });
    return created.secret;
  } catch (error) {
    add({ example: '*', resource: 'webhook', name: url, status: 'failed', detail: errorDetail(error) });
    return null;
  }
}

async function provisionStarters(
  options: ProvisionOptions,
  connection: Connection,
  add: (row: SummaryRow) => void,
): Promise<void> {
  let current: ConversationStarters;
  try {
    current = await options.api.connections.getConversationStarters(connection.uuid);
  } catch (error) {
    add({
      example: '*',
      resource: 'starters',
      name: connection.display_phone_number,
      status: 'failed',
      detail: errorDetail(error),
    });
    return;
  }
  const commands = [...current.commands];
  const iceBreakers = [...current.ice_breakers];
  const added: string[] = [];
  for (const example of options.examples) {
    const command = example.manifest.command;
    if (
      options.commands === true &&
      command !== undefined &&
      !commands.some((existing) => existing.name === command.name)
    ) {
      commands.push(command);
      added.push(`/${command.name}`);
    }
    const iceBreaker = example.manifest.iceBreaker;
    if (options.iceBreakers === true && iceBreaker !== undefined && !iceBreakers.includes(iceBreaker)) {
      if (iceBreakers.length >= WHATSAPP_LIMITS.maxIceBreakers) {
        add({
          example: example.id,
          resource: 'starters',
          name: iceBreaker,
          status: 'skipped',
          detail: 'The number already has 4 ice breakers',
        });
      } else {
        iceBreakers.push(iceBreaker);
        added.push(`"${iceBreaker}"`);
      }
    }
  }
  if (added.length === 0) {
    add({
      example: '*',
      resource: 'starters',
      name: 'commands',
      status: 'exists',
      detail: commands.map((entry) => `/${entry.name}`).join(' ') || 'none',
    });
    return;
  }
  if (options.dryRun) {
    add({
      example: '*',
      resource: 'starters',
      name: 'commands',
      status: 'would update',
      detail: `add ${added.join(', ')} (keeps existing)`,
    });
    return;
  }
  try {
    await options.api.connections.putConversationStarters(connection.uuid, {
      commands,
      ice_breakers: iceBreakers,
      welcome_message: current.welcome_message ?? false,
    });
    add({
      example: '*',
      resource: 'starters',
      name: 'commands',
      status: 'updated',
      detail: `added ${added.join(', ')}`,
    });
  } catch (error) {
    add({
      example: '*',
      resource: 'starters',
      name: 'commands',
      status: 'failed',
      detail: errorDetail(error),
    });
  }
}

async function provisionQrCodes(
  options: ProvisionOptions,
  connection: Connection,
  add: (row: SummaryRow) => void,
): Promise<void> {
  const { data: existing } = await options.api.connections.listQrCodes(connection.uuid);
  const digits = connection.display_phone_number.replace(/\D/g, '');
  for (const example of options.examples) {
    const prefill = example.manifest.qrPrefill ?? example.startCode;
    if (
      prefill.length > WHATSAPP_LIMITS.qrPrefill ||
      !prefill.toUpperCase().startsWith(example.startCode.toUpperCase())
    ) {
      add({
        example: example.id,
        resource: 'qr',
        name: prefill,
        status: 'skipped',
        detail: 'qrPrefill must start with the start code and be ≤ 140 chars',
      });
      continue;
    }
    add({
      example: example.id,
      resource: 'link',
      name: example.startCode,
      status: 'exists',
      detail: `https://wa.me/${digits}?text=${encodeURIComponent(prefill)}`,
    });
    const found = existing.find((code) => code.prefilled_message === prefill);
    if (found !== undefined) {
      add({
        example: example.id,
        resource: 'qr',
        name: found.code,
        status: 'exists',
        detail: found.deep_link_url,
      });
      continue;
    }
    if (options.dryRun) {
      add({
        example: example.id,
        resource: 'qr',
        name: prefill,
        status: 'would create',
        detail: 'SVG QR + wa.me/message short link',
      });
      continue;
    }
    try {
      const created = await options.api.connections.createQrCode(connection.uuid, {
        prefilled_message: prefill,
        image_format: 'SVG',
      });
      add({
        example: example.id,
        resource: 'qr',
        name: created.code,
        status: 'created',
        detail: `${created.deep_link_url}${created.qr_image_url ? ` · image ${created.qr_image_url}` : ''}`,
      });
    } catch (error) {
      add({
        example: example.id,
        resource: 'qr',
        name: prefill,
        status: 'failed',
        detail: errorDetail(error),
      });
    }
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof LazyAppError) {
    const fields = Object.entries(error.fieldErrors)
      .map(([field, messages]) => `${field}: ${messages.join(' ')}`)
      .join('; ');
    return `${String(error.status)} ${error.code ?? ''} ${error.message}${fields === '' ? '' : ` (${fields})`}`
      .replace(/\s+/g, ' ')
      .trim();
  }
  return error instanceof Error ? error.message : String(error);
}
