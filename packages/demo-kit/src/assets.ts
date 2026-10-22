import { readFileSync } from 'node:fs';

/**
 * Loads a Flow JSON document that lives next to an example, e.g.
 * `loadFlowJson(new URL('../flows/feedback.json', import.meta.url))`.
 * Reading at startup keeps the JSON a plain file you can paste into Meta's Flow Builder.
 */
export function loadFlowJson(url: URL): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(readFileSync(url, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('screens' in value)) {
    throw new Error(`${url.pathname} is not a Flow JSON document (no "screens")`);
  }
  return value;
}

/** File names the demo server will serve from `examples/<id>/public/`. Flat, lowercase, known types. */
export const PUBLIC_ASSET_PATTERN = /^[a-z0-9][a-z0-9-]*\.(pdf|jpg|jpeg|png|webp)$/;

/**
 * Public URL of a file in `examples/<exampleId>/public/`, hosted by the demo server at
 * `/public/<exampleId>/<file>`. WhatsApp fetches media by URL, so this is what document
 * and image messages point at.
 */
export function publicAssetUrl(publicBaseUrl: string, exampleId: string, file: string): string {
  if (!PUBLIC_ASSET_PATTERN.test(file)) {
    throw new Error(`"${file}" is not a servable public asset name`);
  }
  return `${publicBaseUrl.replace(/\/+$/, '')}/public/${exampleId}/${file}`;
}
