import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WEBHOOK_HEADERS } from '@lazyapp-examples/sdk';
import type { AnyExample, DemoRuntime, Logger } from '@lazyapp-examples/demo-kit';

export interface AppOptions {
  readonly runtime: DemoRuntime;
  readonly log: Logger;
  readonly examples: readonly AnyExample[];
  /** Display number for chat links, e.g. `+919812345670`. */
  readonly demoPhoneNumber?: string | undefined;
  readonly startedAt?: Date | undefined;
  /** Reports whether the store answers; `/healthz` returns 503 when it does not. */
  readonly checkStore?: (() => boolean) | undefined;
}

/**
 * HTTP surface of the demo server. Kept free of process concerns (ports,
 * signals) so tests call it with `app.request()`.
 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const startedAt = options.startedAt ?? new Date();

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    if (c.req.path !== '/healthz') {
      options.log.info('http', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      });
    }
  });

  const limit = bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'Payload too large' }, 413),
  });

  /** LazyApp webhooks: verify, persist, ack. Processing happens after the response. */
  app.post('/webhooks/lazyapp', limit, async (c) => {
    const body = new Uint8Array(await c.req.arrayBuffer());
    const result = options.runtime.ingest(body, c.req.header(WEBHOOK_HEADERS.signature));
    switch (result.status) {
      case 'rejected':
        options.log.warn('webhook rejected', {
          reason: result.reason,
          delivery: c.req.header(WEBHOOK_HEADERS.delivery),
          event: c.req.header(WEBHOOK_HEADERS.event),
        });
        return c.json({ error: result.reason }, result.httpStatus);
      case 'accepted':
        return c.json({ status: 'accepted', id: result.id }, 202);
      case 'duplicate':
        return c.json({ status: 'duplicate', id: result.id }, 200);
      case 'ignored':
        return c.json({ status: 'ignored', reason: result.reason }, 200);
    }
  });

  /** WhatsApp Flow data_exchange, forwarded (decrypted and signed) by LazyApp. */
  app.post('/flows/:example/:flow', limit, async (c) => {
    const body = new Uint8Array(await c.req.arrayBuffer());
    const result = await options.runtime.flowExchange(
      c.req.param('example'),
      c.req.param('flow'),
      body,
      c.req.header(WEBHOOK_HEADERS.signature),
    );
    if (result.status === 200) {
      return c.json(result.body, 200);
    }
    if (result.status === 427) {
      // Meta's "flow token is no longer valid": LazyApp passes it through and the user sees a restart prompt.
      return new Response(null, { status: 427 });
    }
    return c.json({ error: result.error }, result.status);
  });

  app.get('/flows/:example/:flow', (c) => {
    const example = options.examples.find((entry) => entry.id === c.req.param('example'));
    const flow = example?.manifest.flows?.find((entry) => entry.key === c.req.param('flow'));
    if (flow === undefined) {
      return c.json({ error: 'Unknown flow' }, 404);
    }
    return c.json({
      example: example?.id,
      flow: flow.key,
      dataExchange: flow.dataExchange,
      usage:
        'LazyApp POSTs signed, decrypted data_exchange requests here. Set this URL as the flow data_endpoint_uri.',
    });
  });

  /** Example web pages (sign-in pages, check-in scanners, ticket images): `examples/<id>` `web` routes. */
  app.on(['GET', 'HEAD', 'POST'], ['/x/:example', '/x/:example/*'], limit, (c) => {
    const exampleId = c.req.param('example');
    const prefix = `/x/${exampleId}`;
    const path = c.req.path.slice(prefix.length) || '/';
    // nginx appends the peer address to X-Forwarded-For; earlier entries are client-supplied.
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    return options.runtime.web(exampleId, path, c.req.raw, { clientIp: forwarded ?? 'unknown' });
  });

  app.on(['GET', 'HEAD'], '/healthz', (c) => {
    const storeOk = options.checkStore?.() ?? true;
    return c.json(
      {
        status: storeOk ? 'ok' : 'degraded',
        uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        queueDepth: options.runtime.queueDepth,
        examples: options.examples.map((example) => example.id),
      },
      storeOk ? 200 : 503,
    );
  });

  /** Public catalogue of demos (for the website's examples page). */
  app.get('/demos', (c) => {
    const digits = options.demoPhoneNumber?.replace(/\D/g, '');
    return c.json({
      demos: options.examples.map((example) => {
        const description = example.describe();
        const prefill = example.manifest.qrPrefill ?? example.startCode;
        return {
          id: example.id,
          title: example.title,
          startCode: example.startCode,
          summary: description.summary,
          metaFeatures: description.metaFeatures,
          chatLink:
            digits === undefined || digits === ''
              ? null
              : `https://wa.me/${digits}?text=${encodeURIComponent(prefill)}`,
        };
      }),
    });
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((error, c) => {
    options.log.error('unhandled request error', { error, path: c.req.path });
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
