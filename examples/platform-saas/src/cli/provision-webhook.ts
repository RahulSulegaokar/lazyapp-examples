import { LazyAppClient } from '@lazyapp-examples/sdk';
import { configFromEnv } from '../config.js';
import { EXAMPLE_ID } from '../manifest.js';
import { PLATFORM_EVENTS } from '../webhooks.js';

/**
 * Creates SalonBook's platform webhook endpoint, on the platform workspace (test mode), subscribed
 * to the platform events it routes by customer. Prints the signing secret once.
 *
 *   npm run provision-webhook -w @lazyapp-examples/example-platform-saas [-- --dry-run]
 */
const config = configFromEnv(process.env);
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
if (config.platformApiKey === null || !publicBaseUrl.startsWith('https://')) {
  process.stderr.write(
    'Set PLATFORM_SAAS_API_KEY (sk_test_…, scope webhooks:write) and an https PUBLIC_BASE_URL.\n',
  );
  process.exit(1);
}

const url = `${publicBaseUrl}/x/${EXAMPLE_ID}/webhooks`;
const client = new LazyAppClient({ apiKey: config.platformApiKey, baseUrl: config.lazyappBaseUrl });
const existing = (await client.webhooks.list()).data.find((endpoint) => endpoint.url === url);

if (existing !== undefined) {
  process.stdout.write(
    `Endpoint ${existing.id} already points at ${url}. Rotate its secret in LazyApp if lost.\n`,
  );
} else if (process.argv.includes('--dry-run')) {
  process.stdout.write(`Would create ${url} for: ${PLATFORM_EVENTS.join(', ')}\n`);
} else {
  const created = await client.webhooks.create({
    url,
    description: 'SalonBook platform demo (lazyapp-examples)',
    subscribed_events: [...PLATFORM_EVENTS],
  });
  process.stdout.write(
    `Created endpoint ${created.id} → ${url}\nAdd to .env (shown once):\nPLATFORM_SAAS_WEBHOOK_SECRET=${created.secret}\n`,
  );
}
