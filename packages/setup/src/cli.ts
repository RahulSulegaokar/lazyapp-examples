import { parseArgs } from 'node:util';
import { DemoRouter, DemoStore, loadExamples, silentLogger } from '@lazyapp-examples/demo-kit';
import { LazyAppClient } from '@lazyapp-examples/sdk';
import { provision } from './provision.js';
import { renderTable, summarize } from './table.js';

const HELP = `Provision every example's templates, flows, webhook, conversation starters and QR links.

Usage: npm run setup -- [options]

  --dry-run             Read only: show what would be created
  --only <ids>          Comma-separated example ids (default: all)
  --include-reference   Also provision examples/_template ("hello")
  --no-publish          Leave new flows as drafts
  --ice-breakers        Merge example ice breakers into the number's (shown to everyone)
  --commands            Merge example /commands into the number's (shown to everyone)
  --recreate-webhook    Recreate the webhook endpoint if its events are out of date (new secret)
  -h, --help            Show this help

Environment: LAZYAPP_API_KEY (required), PUBLIC_BASE_URL (required), LAZYAPP_BASE_URL,
LAZYAPP_CONNECTION_UUID, LAZYAPP_PHONE_NUMBER_ID.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      only: { type: 'string' },
      'include-reference': { type: 'boolean', default: false },
      'no-publish': { type: 'boolean', default: false },
      'ice-breakers': { type: 'boolean', default: false },
      commands: { type: 'boolean', default: false },
      'recreate-webhook': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const apiKey = process.env.LAZYAPP_API_KEY ?? '';
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? '';
  if (!apiKey.startsWith('sk_') || !publicBaseUrl.startsWith('https://')) {
    process.stderr.write(
      'Set LAZYAPP_API_KEY (sk_live_… / sk_test_…) and PUBLIC_BASE_URL (https://…) first.\n\n',
    );
    process.stderr.write(`${HELP}\n`);
    return 2;
  }

  const only = values.only
    ?.split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const examples = await loadExamples(undefined, { only, includeReference: values['include-reference'] });
  const api = new LazyAppClient({
    apiKey,
    baseUrl: process.env.LAZYAPP_BASE_URL,
    userAgent: 'lazyapp-examples-setup/0.1',
  });
  // The router knows which webhook events the examples need.
  const store = new DemoStore(':memory:');
  const webhookEvents = new DemoRouter({
    examples,
    api,
    store,
    log: silentLogger,
    config: { publicBaseUrl },
  }).requiredEvents();
  store.close();

  const dryRun = values['dry-run'];
  process.stdout.write(
    `${dryRun ? 'Dry run: nothing will be created.' : 'Provisioning.'} Examples: ${examples.map((example) => example.id).join(', ')}\n\n`,
  );

  const result = await provision({
    api,
    examples,
    publicBaseUrl,
    dryRun,
    connectionUuid: process.env.LAZYAPP_CONNECTION_UUID,
    phoneNumberId: process.env.LAZYAPP_PHONE_NUMBER_ID,
    publishFlows: !values['no-publish'],
    iceBreakers: values['ice-breakers'],
    commands: values.commands,
    recreateWebhook: values['recreate-webhook'],
    webhookEvents,
  });

  process.stdout.write(`${renderTable(result.rows)}\n\n${summarize(result.rows)}\n`);
  if (result.webhookSecret !== null) {
    process.stdout.write(
      `\nWebhook signing secret (shown once, store it now):\n\n  LAZYAPP_WEBHOOK_SECRET=${result.webhookSecret}\n\n`,
    );
  }
  return result.rows.some((row) => row.status === 'failed') ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
