/**
 * Creates the broadcast-ready intake announcement template (marketing, image header).
 *
 * Meta reviews a sample of every media header, so the template needs an upload handle from
 * `POST /v1/templates/media` first. `npm run setup` only sends JSON manifests, so this script
 * does the two steps:
 *
 *   npx tsx --env-file=.env examples/education-admissions/src/provision-intake-template.ts [--dry-run]
 *
 * Then broadcast it to everyone who opted in from the demo (tag `admissions:intake-alerts`):
 * create a segment on that tag and `POST /v1/broadcasts` (see the example README).
 */
import { LazyAppClient, LazyAppConflictError } from '@lazyapp-examples/sdk';
import { ANNOUNCEMENT_IMAGE } from './catalog.js';
import { INTAKE_TEMPLATE } from './manifest.js';

export interface ProvisionIntakeOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly dryRun: boolean;
  readonly fetch?: typeof fetch;
  readonly log: (line: string) => void;
}

/** Downloads the header sample, uploads it for review, and submits the template. Returns the handle. */
export async function provisionIntakeTemplate(options: ProvisionIntakeOptions): Promise<string | null> {
  const http = options.fetch ?? fetch;
  if (options.dryRun) {
    options.log(
      `would upload ${ANNOUNCEMENT_IMAGE} and create ${INTAKE_TEMPLATE.name} (MARKETING, IMAGE header)`,
    );
    return null;
  }
  const image = await http(ANNOUNCEMENT_IMAGE);
  if (!image.ok) {
    throw new Error(`Could not download the header sample (${image.status})`);
  }
  const form = new FormData();
  form.set('format', 'IMAGE');
  form.set('file', new Blob([await image.arrayBuffer()], { type: 'image/jpeg' }), 'intake-announcement.jpg');
  const upload = await http(`${options.baseUrl}/v1/templates/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' },
    body: form,
  });
  const uploaded = (await upload.json()) as { handle?: string; message?: string };
  if (!upload.ok || uploaded.handle === undefined) {
    throw new Error(
      `Header sample upload failed (${upload.status}): ${uploaded.message ?? 'no handle returned'}`,
    );
  }
  const client = new LazyAppClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: http });
  try {
    const template = await client.templates.create(
      { ...INTAKE_TEMPLATE, header: { format: 'IMAGE', example_handle: uploaded.handle }, submit: true },
      { idempotencyKey: `setup-template-${INTAKE_TEMPLATE.name}` },
    );
    options.log(`created ${template.name}: ${template.status}`);
  } catch (error) {
    if (!(error instanceof LazyAppConflictError)) {
      throw error;
    }
    options.log(`${INTAKE_TEMPLATE.name} already exists`);
  }
  return uploaded.handle;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const apiKey = process.env.LAZYAPP_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    process.stderr.write('Set LAZYAPP_API_KEY (scope templates:write).\n');
    process.exit(1);
  }
  await provisionIntakeTemplate({
    apiKey,
    baseUrl: process.env.LAZYAPP_BASE_URL ?? 'https://lazyapp.in',
    dryRun: process.argv.includes('--dry-run'),
    log: (line) => process.stdout.write(`${line}\n`),
  });
}
