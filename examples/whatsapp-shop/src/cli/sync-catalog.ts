/**
 * Uploads the shop's seed products to the number's Meta catalog, so the demo
 * shows native catalog, product and product-carousel messages instead of lists.
 *
 *   npm run sync-catalog -w @lazyapp-examples/example-whatsapp-shop -- --dry-run
 *
 * Uses `POST /v1/catalog/items` (Meta's Catalog Batch API through LazyApp). Until
 * Meta grants LazyApp `catalog_management`, LazyApp answers 403 `meta_approval_pending`:
 * upload `catalog.csv`-style data in Commerce Manager instead.
 */
import { LazyAppClient, LazyAppError } from '@lazyapp-examples/sdk';
import { BRAND, PRODUCTS } from '../catalog.js';

const dryRun = process.argv.includes('--dry-run');
const items = PRODUCTS.map((product) => ({
  sku: product.sku,
  title: product.name,
  description: product.description,
  price: product.pricePaise,
  currency: 'INR',
  availability: 'in_stock',
  quantity: 25,
  image_url: product.imageUrl.replace('w=800', 'w=1000'),
  brand: BRAND.name,
  condition: 'new',
}));

if (dryRun) {
  process.stdout.write(`${JSON.stringify({ items }, null, 2)}\n`);
  process.exit(0);
}

const apiKey = process.env.LAZYAPP_API_KEY;
if (apiKey === undefined || apiKey === '') {
  process.stderr.write('Set LAZYAPP_API_KEY (see .env.example).\n');
  process.exit(1);
}
const client = new LazyAppClient({ apiKey, baseUrl: process.env.LAZYAPP_BASE_URL ?? 'https://lazyapp.in' });
const phoneNumberId = process.env.LAZYAPP_PHONE_NUMBER_ID;

try {
  const batch = await client.request<{ id?: string; status?: string }>('POST', '/v1/catalog/items', {
    body: {
      items,
      ...(phoneNumberId === undefined || phoneNumberId === '' ? {} : { phone_number_id: phoneNumberId }),
    },
    idempotencyKey: `whatsapp-shop-catalog-${PRODUCTS.length}`,
  });
  process.stdout.write(
    `Queued ${items.length} products: batch ${batch.id ?? '?'} (${batch.status ?? 'queued'}).\n`,
  );
  process.stdout.write("Poll GET /v1/catalog/batches/{batch} for Meta's result.\n");
} catch (error) {
  if (error instanceof LazyAppError) {
    process.stderr.write(
      `LazyApp refused the upload (${String(error.status)} ${error.code ?? ''}): ${error.message}\n`,
    );
    process.exit(1);
  }
  throw error;
}
