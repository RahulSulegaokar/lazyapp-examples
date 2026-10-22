import { z } from 'zod';

/**
 * Settings read once from the environment (see `.env.example`). Handlers receive the
 * parsed object, so tests pass their own instead of touching `process.env`.
 */
export interface RealEstateConfig {
  /**
   * E.164 number on the agent contact card. Defaults to the demo number, so "Message"
   * on the card opens this same chat; never a made-up number that could belong to someone.
   */
  readonly agentPhone: string | null;
  /**
   * `demo`: the reminder arrives 2 minutes after booking and the feedback request 5 minutes
   * after that, so a visitor sees the whole journey. `production`: 3 hours before the visit
   * and 2 hours after it.
   */
  readonly reminders: 'demo' | 'production';
  /**
   * Send the visit confirmation through `POST /v1/events` (`appointment.confirmed`) instead
   * of sending the template directly. Needs an event mapping in the workspace; see the README.
   */
  readonly useEvents: boolean;
}

const envSchema = z.object({
  REAL_ESTATE_AGENT_PHONE: z.string().optional(),
  DEMO_PHONE_NUMBER: z.string().optional(),
  REAL_ESTATE_REMINDERS: z.enum(['demo', 'production']).optional(),
  REAL_ESTATE_USE_EVENTS: z.enum(['true', 'false']).optional(),
});

export function configFromEnv(env: Readonly<Record<string, string | undefined>>): RealEstateConfig {
  const parsed = envSchema.parse(
    Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value === '' ? undefined : value])),
  );
  const phone = parsed.REAL_ESTATE_AGENT_PHONE ?? parsed.DEMO_PHONE_NUMBER ?? null;
  return {
    agentPhone: phone === null ? null : `+${phone.replace(/\D/g, '')}`,
    reminders: parsed.REAL_ESTATE_REMINDERS ?? 'demo',
    useEvents: parsed.REAL_ESTATE_USE_EVENTS === 'true',
  };
}

export const DEFAULT_CONFIG: RealEstateConfig = { agentPhone: null, reminders: 'demo', useEvents: false };
