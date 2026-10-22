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
