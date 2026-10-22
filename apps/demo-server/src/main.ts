import { serve } from '@hono/node-server';
import { createLogger, DemoRuntime, DemoStore, loadExamples, maskPhone } from '@lazyapp-examples/demo-kit';
import { LazyAppClient } from '@lazyapp-examples/sdk';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger({ level: config.LOG_LEVEL, bindings: { service: 'lazyapp-demo-server' } });

  const examples = await loadExamples(config.EXAMPLES_DIR, {
    only: config.DEMO_EXAMPLES,
    includeReference: config.INCLUDE_REFERENCE_EXAMPLE,
  });
  if (examples.length === 0) {
    throw new ConfigError(
      'No examples found. Add one under examples/ or set INCLUDE_REFERENCE_EXAMPLE=true.',
    );
  }

  const store = new DemoStore(config.DATABASE_PATH);
  const api = new LazyAppClient({
    apiKey: config.LAZYAPP_API_KEY,
    baseUrl: config.LAZYAPP_BASE_URL,
    userAgent: 'lazyapp-examples-demo-server/0.1',
    onRequest: (event) => {
      if (event.error !== undefined || (event.status !== undefined && event.status >= 400)) {
        log.warn('lazyapp api', { ...event, error: event.error });
      } else {
        log.debug('lazyapp api', { ...event });
      }
    },
  });

  const runtime = new DemoRuntime({
    examples,
    api,
    store,
    log,
    webhookSecret: config.LAZYAPP_WEBHOOK_SECRET,
    flowSecrets: config.LAZYAPP_FLOW_SECRETS,
    allowUnsignedFlowRequests: config.ALLOW_UNSIGNED_FLOW_REQUESTS,
    config: {
      publicBaseUrl: config.PUBLIC_BASE_URL,
      phoneNumberId: config.LAZYAPP_PHONE_NUMBER_ID ?? null,
      sessionIdleMs: config.SESSION_IDLE_HOURS * 60 * 60 * 1000,
      allowDraftFlows: config.ALLOW_DRAFT_FLOWS,
      capabilities: {
        paymentConfiguration: config.PAYMENT_CONFIGURATION,
        paymentGatewayAccount: config.PAYMENT_GATEWAY_ACCOUNT,
      },
    },
  });

  const app = createApp({
    runtime,
    log,
    examples,
    demoPhoneNumber: config.DEMO_PHONE_NUMBER,
    examplesDir: config.EXAMPLES_DIR,
    checkStore: () => {
      try {
        store.countSessions();
        return true;
      } catch {
        return false;
      }
    },
  });

  const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
    log.info('listening', {
      address: `${info.address}:${info.port}`,
      publicBaseUrl: config.PUBLIC_BASE_URL,
      examples: examples.map((example) => `${example.id} (${example.startCode})`),
      demoNumber: maskPhone(config.DEMO_PHONE_NUMBER),
    });
  });

  runtime.recover();
  const sweep = setInterval(() => {
    runtime.sweep().catch((error: unknown) => {
      log.error('session sweep failed', { error });
    });
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    log.info('shutting down', { signal });
    clearInterval(sweep);
    const force = setTimeout(() => {
      log.error('forced exit after grace period');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    // Stop accepting connections, then let queued webhooks finish. Unfinished ones
    // stay "pending" in the inbox and are recovered on the next boot.
    server.close(() => {
      void runtime.close(SHUTDOWN_GRACE_MS - 2_000).then((drained) => {
        store.close();
        log.info('stopped', { drained });
        process.exit(0);
      });
    });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { error: reason });
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
