import { z } from 'zod';

/**
 * Where qualified leads go. `webhook` POSTs signed JSON to your CRM (HubSpot workflow,
 * Zapier/Make hook, a Google Apps Script web app that appends to a Sheet…). `store` keeps
 * them in the demo server's database, so the demo works with nothing configured.
 */
export type CrmTransport =
  | {
      readonly kind: 'webhook';
      readonly url: string;
      /** Signs each delivery: `X-Lazyapp-Demo-Signature: sha256=HMAC-SHA256(body, secret)`. */
      readonly secret: string | null;
      readonly fetch: typeof fetch;
      readonly timeoutMs: number;
    }
  | { readonly kind: 'store' };

export interface LeadGenConfig {
  readonly crm: CrmTransport;
  /**
   * `demo`: meeting reminder 2 minutes after booking; nurture tip after 3 minutes and the
   * comeback offer after 10, so a visitor sees the whole journey. `production`: 15 minutes
   * before the meeting; nurture after 2 and 5 days.
   */
  readonly timing: 'demo' | 'production';
  /** Confirm meetings through `POST /v1/events` (`appointment.confirmed`). Needs an event mapping. */
  readonly useEvents: boolean;
  /** E.164 number on the sales rep's contact card (the demo number), or null to leave it off. */
  readonly repPhone: string | null;
}

const envSchema = z.object({
  LEADS_CRM_WEBHOOK_URL: z.url().optional(),
  LEADS_CRM_WEBHOOK_SECRET: z.string().optional(),
  LEADS_TIMING: z.enum(['demo', 'production']).optional(),
  LEADS_USE_EVENTS: z.enum(['true', 'false']).optional(),
  LEADS_REP_PHONE: z.string().optional(),
  DEMO_PHONE_NUMBER: z.string().optional(),
});

export function configFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = globalThis.fetch,
): LeadGenConfig {
  const parsed = envSchema.parse(
    Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value === '' ? undefined : value])),
  );
  const phone = parsed.LEADS_REP_PHONE ?? parsed.DEMO_PHONE_NUMBER ?? null;
  return {
    crm:
      parsed.LEADS_CRM_WEBHOOK_URL === undefined
        ? { kind: 'store' }
        : {
            kind: 'webhook',
            url: parsed.LEADS_CRM_WEBHOOK_URL,
            secret: parsed.LEADS_CRM_WEBHOOK_SECRET ?? null,
            fetch: fetchImpl,
            timeoutMs: 5_000,
          },
    timing: parsed.LEADS_TIMING ?? 'demo',
    useEvents: parsed.LEADS_USE_EVENTS === 'true',
    repPhone: phone === null ? null : `+${phone.replace(/\D/g, '')}`,
  };
}

export const DEFAULT_CONFIG: LeadGenConfig = {
  crm: { kind: 'store' },
  timing: 'demo',
  useEvents: false,
  repPhone: null,
};
