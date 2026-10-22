import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .optional()
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const envSchema = z.object({
  LAZYAPP_API_KEY: z.string().regex(/^sk_(live|test)_/, 'must be a LazyApp key (sk_live_… or sk_test_…)'),
  LAZYAPP_BASE_URL: z.url().default('https://lazyapp.in'),
  LAZYAPP_WEBHOOK_SECRET: z
    .string()
    .min(16, 'copy the signing secret shown when the webhook endpoint was created'),
  LAZYAPP_PHONE_NUMBER_ID: optionalString,
  /** Display number (E.164) for chat links on GET /demos. */
  DEMO_PHONE_NUMBER: optionalString,
  PUBLIC_BASE_URL: z.url().default('http://localhost:8787'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().default('./data/demo.sqlite'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  EXAMPLES_DIR: optionalString,
  DEMO_EXAMPLES: optionalString.transform((value) =>
    value === undefined
      ? undefined
      : value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== ''),
  ),
  INCLUDE_REFERENCE_EXAMPLE: bool,
  SESSION_IDLE_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(24),
  PAYMENT_CONFIGURATION: optionalString,
  PAYMENT_GATEWAY_ACCOUNT: optionalString,
  LAZYAPP_FLOW_SECRETS: z
    .string()
    .optional()
    .transform((value, context) => {
      if (value === undefined || value.trim() === '') {
        return {};
      }
      const parsed = z
        .record(z.string().regex(/^[a-z0-9-]+\/[a-z0-9_]+$/), z.string().min(1))
        .safeParse(safeJson(value));
      if (!parsed.success) {
        context.addIssue({ code: 'custom', message: 'must be JSON like {"shop/checkout":"whfs_…"}' });
        return z.NEVER;
      }
      return parsed.data;
    }),
  ALLOW_UNSIGNED_FLOW_REQUESTS: bool,
  ALLOW_DRAFT_FLOWS: bool,
});

export type ServerConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parses and validates the environment once at boot; a bad value fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
