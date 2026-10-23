import { z } from 'zod';

/**
 * Settings read once from the environment (see `.env.example`). Handlers receive the parsed
 * object, so tests pass their own instead of touching `process.env`.
 *
 * The SalonBook web demo talks to LazyApp with its **own** key, on a platform workspace, in test
 * mode. The chat side runs on the shared demo number with the demo server's key, like every
 * other example; the two never mix.
 */
export interface PlatformSaasConfig {
  /**
   * Platform key (`sk_test_…`) with `customers:write` and `templates:write`. Null: the web demo
   * shows how to configure it and every API route answers 503.
   */
  readonly platformApiKey: string | null;
  readonly lazyappBaseUrl: string;
  /** Signing secret of the platform webhook endpoint (`npm run provision-webhook`). */
  readonly webhookSecret: string | null;
  /** Scheduling page for "Book a call". Null: the chat collects a preferred time instead. */
  readonly bookCallUrl: string | null;
  /** Automation pack the "Provision pack" button installs for a salon. */
  readonly automationPack: string;
}

const optional = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const envSchema = z.object({
  PLATFORM_SAAS_API_KEY: optional,
  PLATFORM_SAAS_ALLOW_LIVE: optional,
  LAZYAPP_BASE_URL: optional,
  PLATFORM_SAAS_WEBHOOK_SECRET: optional,
  PLATFORM_SAAS_BOOK_CALL_URL: optional.pipe(z.url({ protocol: /^https$/ }).optional()),
  PLATFORM_SAAS_AUTOMATION_PACK: optional.pipe(
    z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .optional(),
  ),
});

export class PlatformSaasConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformSaasConfigError';
  }
}

export function configFromEnv(env: Readonly<Record<string, string | undefined>>): PlatformSaasConfig {
  const parsed = envSchema.parse(env);
  const key = parsed.PLATFORM_SAAS_API_KEY ?? null;
  const allowLive = parsed.PLATFORM_SAAS_ALLOW_LIVE === 'true';
  if (key !== null && !key.startsWith('sk_test_') && !(allowLive && key.startsWith('sk_live_'))) {
    // The demo creates and deletes customers on every visit: keep it away from live data.
    throw new PlatformSaasConfigError(
      'PLATFORM_SAAS_API_KEY must be a test key (sk_test_…). Set PLATFORM_SAAS_ALLOW_LIVE=true to use sk_live_.',
    );
  }
  return {
    platformApiKey: key,
    lazyappBaseUrl: parsed.LAZYAPP_BASE_URL ?? 'https://lazyapp.in',
    webhookSecret: parsed.PLATFORM_SAAS_WEBHOOK_SECRET ?? null,
    bookCallUrl: parsed.PLATFORM_SAAS_BOOK_CALL_URL ?? null,
    automationPack: parsed.PLATFORM_SAAS_AUTOMATION_PACK ?? 'real_estate',
  };
}

export const DEFAULT_CONFIG: PlatformSaasConfig = {
  platformApiKey: null,
  lazyappBaseUrl: 'https://lazyapp.in',
  webhookSecret: null,
  bookCallUrl: null,
  automationPack: 'real_estate',
};
