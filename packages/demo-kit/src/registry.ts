import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnyExample, Example } from './example.js';

export interface LoadExamplesOptions {
  /** Only these example ids, in this order (e.g. from `DEMO_EXAMPLES`). Default: every example. */
  readonly only?: readonly string[] | undefined;
  /** Load directories starting with `_` (the reference example). Default false. */
  readonly includeReference?: boolean | undefined;
}

/** The `examples/` directory of this repository. */
export const DEFAULT_EXAMPLES_DIR = resolve(import.meta.dirname, '../../../examples');

/**
 * Discovers `examples/<dir>/src/index.ts` and imports each default export.
 * Adding an example is creating a directory: no central list to edit.
 */
export async function loadExamples(
  dir: string = DEFAULT_EXAMPLES_DIR,
  options: LoadExamplesOptions = {},
): Promise<AnyExample[]> {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && (options.includeReference === true || !entry.name.startsWith('_')),
    )
    .map((entry) => join(dir, entry.name, 'src', 'index.ts'))
    .filter((file) => existsSync(file))
    .sort();

  const examples: AnyExample[] = [];
  for (const file of entries) {
    const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
    examples.push(assertExample(module.default, file));
  }

  if (options.only === undefined || options.only.length === 0) {
    return examples;
  }
  const byId = new Map(examples.map((example) => [example.id, example]));
  return options.only.map((id) => {
    const example = byId.get(id);
    if (example === undefined) {
      throw new Error(
        `DEMO_EXAMPLES lists "${id}", but no example has that id (found: ${[...byId.keys()].join(', ')})`,
      );
    }
    return example;
  });
}

function assertExample(value: unknown, file: string): AnyExample {
  const candidate = value as Partial<Example> | undefined;
  const missing = (
    ['id', 'title', 'startCode', 'manifest', 'describe', 'initialState', 'onStart', 'onMessage'] as const
  ).filter((key) => candidate?.[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `${file} must default-export an Example (missing: ${missing.join(', ')}). Use defineExample().`,
    );
  }
  if (!/^[a-z][a-z0-9-]*$/.test(candidate?.id ?? '')) {
    throw new Error(`${file}: example id "${String(candidate?.id)}" must be kebab-case`);
  }
  return candidate as AnyExample;
}
