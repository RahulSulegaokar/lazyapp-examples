import { htmlResponse, jsonResponse, SELF_CONTAINED_CSP } from '@lazyapp-examples/demo-kit';
import type { WebContext, WebRoute } from '@lazyapp-examples/demo-kit';
import {
  isTestDelivery,
  LazyAppClient,
  LazyAppError,
  LazyAppNetworkError,
  parseWebhookEvent,
  verifyWebhookSignature,
  WEBHOOK_HEADERS,
  WebhookPayloadError,
} from '@lazyapp-examples/sdk';
import type { PlatformSaasConfig } from './config.js';
import { LIMITS, RateGuard } from './guard.js';
import type { Limit } from './guard.js';
import { EXAMPLE_ID } from './manifest.js';
import { renderAdminPage } from './page.js';
import { EMBEDDED_COMPONENTS, originOf, SalonBook, SalonBookError } from './platform.js';
import type { EmbeddedComponent } from './platform.js';
import { findSalon, SalonStore, SEED_SALONS } from './salons.js';
import type { SeedSalon } from './salons.js';
import type { PlatformState } from './state.js';
import { applyPlatformEvent, sampleEvent, SIMULATED_EVENTS } from './webhooks.js';
import type { SimulatedEvent } from './webhooks.js';

type Web = WebContext<PlatformState>;

export interface WebDeps {
  readonly config: PlatformSaasConfig;
  /** The client SalonBook uses for the Platform API, or null when no platform key is configured. */
  readonly platformClient: (web: Web) => LazyAppClient | null;
}

/** The default client: SalonBook's own test-mode platform key, never the demo number's key. */
export function platformClientFromConfig(config: PlatformSaasConfig): WebDeps['platformClient'] {
  let client: LazyAppClient | null = null;
  return () => {
    if (config.platformApiKey === null) {
      return null;
    }
    client ??= new LazyAppClient({
      apiKey: config.platformApiKey,
      baseUrl: config.lazyappBaseUrl,
      userAgent: 'salonbook-demo/0.1 (lazyapp-examples)',
    });
    return client;
  };
}

/**
 * SalonBook's web app at `/x/platform-saas`: the admin page, its JSON API and the platform webhook
 * endpoint. Every `/api` write is same-origin only and rate limited per IP and globally.
 */
export function webRoutes(deps: WebDeps): readonly WebRoute<PlatformState>[] {
  const mode = (): 'test' | 'live' | null =>
    deps.config.platformApiKey === null
      ? null
      : deps.config.platformApiKey.startsWith('sk_test_')
        ? 'test'
        : 'live';
  const lazyappOrigin = originOf(deps.config.lazyappBaseUrl) ?? 'https://lazyapp.in';

  /** Resolves the salon, the client and the rate limit, then runs `action` with SalonBook's backend. */
  const salonRoute =
    (
      kind: 'read' | 'write' | 'embed',
      action: (
        salonBook: SalonBook,
        salon: SeedSalon,
        web: Web,
        params: Readonly<Record<string, string>>,
        url: URL,
      ) => Promise<unknown>,
    ) =>
    async (web: Web, request: Request, params: Readonly<Record<string, string>>): Promise<Response> => {
      if (kind !== 'read' && !sameOrigin(request, web)) {
        return jsonResponse({ error: 'forbidden', message: 'Cross-site requests are not allowed.' }, 403);
      }
      const limited = rateLimit(web, kind);
      if (limited !== null) {
        return limited;
      }
      const salon = findSalon(params.slug ?? '');
      if (salon === undefined) {
        return jsonResponse(
          { error: 'not_found', message: 'SalonBook only has the three seed salons.' },
          404,
        );
      }
      const salonBook = backend(web);
      if (salonBook === null) {
        return notConfigured();
      }
      try {
        await salonBook.resetIfNewDay();
        return jsonResponse(await action(salonBook, salon, web, params, new URL(request.url)));
      } catch (error) {
        return failure(web, error);
      }
    };

  function backend(web: Web): SalonBook | null {
    const api = deps.platformClient(web);
    if (api === null) {
      return null;
    }
    return new SalonBook(api, new SalonStore(web.kv, web.now), {
      log: web.log,
      now: web.now,
      appOrigin: originOf(web.baseUrl) ?? web.baseUrl,
      lazyappOrigin,
      redirectUrl: `${web.baseUrl}/?connected=1`,
      automationPack: deps.config.automationPack,
    });
  }

  return [
    {
      method: 'GET',
      path: '/',
      handler: async (web) =>
        htmlResponse(renderAdminPage({ apiBase: `/x/${EXAMPLE_ID}/api/`, mode: mode() }), 200, {
          // The page frames LazyApp's embedded components and nothing else.
          'content-security-policy': `${SELF_CONTAINED_CSP}; frame-src ${lazyappOrigin}`,
          'x-robots-tag': 'noindex',
          ...(web.config.publicBaseUrl.startsWith('https://')
            ? { 'strict-transport-security': 'max-age=31536000' }
            : {}),
        }),
    },
    {
      method: 'GET',
      path: '/api/salons',
      handler: async (web) => {
        const limited = rateLimit(web, 'read');
        if (limited !== null) {
          return limited;
        }
        const salonBook = backend(web);
        const store = new SalonStore(web.kv, web.now);
        try {
          await salonBook?.resetIfNewDay();
        } catch (error) {
          web.log.warn('daily reset failed', { error });
        }
        return jsonResponse({
          configured: salonBook !== null,
          mode: mode(),
          day: store.today,
          automationPack: deps.config.automationPack,
          webhookUrl: `${web.baseUrl}/webhooks`,
          salons: SEED_SALONS.map((salon) => ({ ...salon, ...store.get(salon) })),
        });
      },
    },
    {
      method: 'POST',
      path: '/api/salons/:slug/customer',
      handler: salonRoute('write', async (salonBook, salon) => {
        const record = await salonBook.ensureCustomer(salon);
        return { customerId: record.customerId, externalId: record.externalId };
      }),
    },
    {
      method: 'POST',
      path: '/api/salons/:slug/setup-link',
      handler: salonRoute('write', (salonBook, salon) => salonBook.createSetupLink(salon)),
    },
    {
      method: 'POST',
      path: '/api/salons/:slug/embed/:component',
      handler: salonRoute('embed', async (salonBook, salon, _web, params) => {
        const component = params.component ?? '';
        if (!(EMBEDDED_COMPONENTS as readonly string[]).includes(component)) {
          throw new SalonBookError(404, 'unknown_component', 'SalonBook embeds inbox, templates and usage.');
        }
        return salonBook.mintEmbed(salon, component as EmbeddedComponent);
      }),
    },
    {
      method: 'GET',
      path: '/api/salons/:slug/usage',
      handler: salonRoute('read', (salonBook, salon, _web, _params, url) =>
        salonBook.usage(salon, { refresh: url.searchParams.get('refresh') === '1' }),
      ),
    },
    {
      method: 'POST',
      path: '/api/salons/:slug/automation-pack',
      handler: salonRoute('write', async (salonBook, salon) => ({
        summary: await salonBook.provisionPack(salon),
      })),
    },
    {
      method: 'POST',
      path: '/api/salons/:slug/simulate/:event',
      handler: salonRoute('write', async (_salonBook, salon, web, params) => {
        const type = params.event ?? '';
        if (!(SIMULATED_EVENTS as readonly string[]).includes(type)) {
          throw new SalonBookError(404, 'unknown_event', `Simulate one of: ${SIMULATED_EVENTS.join(', ')}.`);
        }
        const store = new SalonStore(web.kv, web.now);
        const record = store.get(salon);
        if (record.customerId === null) {
          throw new SalonBookError(409, 'customer_missing', `Create ${salon.name} in LazyApp first.`);
        }
        const event = sampleEvent(
          type as SimulatedEvent,
          salon,
          { id: record.customerId, externalId: record.externalId },
          web.now(),
        );
        return applyPlatformEvent(store, event, 'simulated', web.now());
      }),
    },
    {
      method: 'POST',
      path: '/webhooks',
      handler: async (web, request) => receiveWebhook(web, request, deps.config.webhookSecret),
    },
  ];
}

/**
 * The platform webhook endpoint. Verifies the HMAC over the raw bytes, drops LazyApp's test pings
 * and redeliveries, then routes by the customer envelope. Never logs payloads.
 */
async function receiveWebhook(web: Web, request: Request, secret: string | null): Promise<Response> {
  if (secret === null) {
    return jsonResponse({ error: 'not_configured' }, 503);
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (!verifyWebhookSignature(body, request.headers.get(WEBHOOK_HEADERS.signature), secret)) {
    web.log.warn('platform webhook rejected: bad signature', {
      delivery: request.headers.get(WEBHOOK_HEADERS.delivery),
    });
    return jsonResponse({ error: 'bad signature' }, 401);
  }
  let event;
  try {
    event = parseWebhookEvent(Buffer.from(body).toString('utf8'));
  } catch (error) {
    return jsonResponse(
      { error: error instanceof WebhookPayloadError ? error.message : 'invalid body' },
      400,
    );
  }
  if (isTestDelivery(event)) {
    return jsonResponse({ status: 'ignored', reason: 'test delivery' });
  }
  const store = new SalonStore(web.kv, web.now);
  if (!store.markEvent(event.id)) {
    return jsonResponse({ status: 'duplicate', id: event.id });
  }
  const outcome = applyPlatformEvent(store, event, 'webhook', web.now());
  web.log.info('platform webhook', {
    id: event.id,
    type: event.type,
    customer: event.customer?.id ?? null,
    outcome: outcome.status,
  });
  return jsonResponse(outcome);
}

const RATE_LIMITS: Readonly<Record<'read' | 'write' | 'embed', readonly Limit[]>> = {
  read: [LIMITS.readsPerIp],
  write: [LIMITS.writesPerIp, LIMITS.writesGlobal],
  embed: [LIMITS.embedsPerIp, LIMITS.writesGlobal],
};

function rateLimit(web: Web, kind: 'read' | 'write' | 'embed'): Response | null {
  const guard = new RateGuard(web.kv, web.now);
  const checks = RATE_LIMITS[kind].map(
    (limit) => [limit === LIMITS.writesGlobal ? 'global:writes' : `${kind}:${web.clientIp}`, limit] as const,
  );
  const decision = guard.hit(checks);
  return decision.allowed
    ? null
    : jsonResponse(
        { error: 'rate_limited', message: `Too many requests. Try again in ${decision.retryAfterSeconds}s.` },
        429,
        { 'retry-after': String(decision.retryAfterSeconds) },
      );
}

/** Writes come from SalonBook's own page: a browser always sends `Origin` on a POST fetch. */
function sameOrigin(request: Request, web: Web): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    return origin === originOf(web.baseUrl);
  }
  return request.headers.get('sec-fetch-site') !== 'cross-site';
}

function notConfigured(): Response {
  return jsonResponse(
    {
      error: 'not_configured',
      message: 'Set PLATFORM_SAAS_API_KEY to an sk_test_ key on a LazyApp platform workspace.',
    },
    503,
  );
}

function failure(web: Web, error: unknown): Response {
  if (error instanceof SalonBookError) {
    return jsonResponse({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof LazyAppError) {
    web.log.warn('LazyApp refused a SalonBook call', {
      status: error.status,
      code: error.code,
      path: error.path,
      requestId: error.requestId,
    });
    const status = error.status === 429 ? 429 : error.status === 404 ? 404 : 502;
    return jsonResponse(
      { error: error.code ?? 'lazyapp_error', message: `LazyApp answered ${error.status}: ${error.message}` },
      status,
    );
  }
  if (error instanceof LazyAppNetworkError) {
    web.log.error('LazyApp unreachable', { path: error.path });
    return jsonResponse({ error: 'lazyapp_unavailable', message: 'LazyApp did not answer. Try again.' }, 502);
  }
  web.log.error('SalonBook route failed', { error });
  return jsonResponse({ error: 'internal', message: 'Something went wrong.' }, 500);
}
