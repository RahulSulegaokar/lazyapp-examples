import { createHash, createHmac } from 'node:crypto';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { CrmTransport } from './config.js';
import { tagDiff, tagsFor } from './scoring.js';
import type { LeadState } from './state.js';
import type { Ctx, Deps } from './types.js';

/**
 * The CRM side of the lead machine. Every lifecycle change becomes a `CrmEvent`, written to
 * an outbox in the demo store first and then delivered (signed webhook) or kept (store), so
 * nothing is lost when the CRM is down and a webhook replay never creates a duplicate.
 */

export type CrmEventType =
  | 'lead.created'
  | 'lead.qualified'
  | 'lead.hot'
  | 'meeting.booked'
  | 'meeting.rescheduled'
  | 'meeting.cancelled'
  | 'nurture.opted_in'
  | 'nurture.opted_out'
  | 'lead.opted_out';

export interface LeadSnapshot {
  readonly id: string;
  readonly phone: string | null;
  readonly name: string | null;
  readonly company: string | null;
  readonly email: string | null;
  readonly role: string | null;
  readonly needs: readonly string[];
  readonly size: string | null;
  readonly budget: string | null;
  readonly timeline: string | null;
  readonly score: number | null;
  readonly grade: string | null;
  readonly reasons: readonly string[];
  readonly attribution: LeadState['attribution'];
  readonly meeting: {
    readonly id: string;
    readonly at: string;
    readonly rep: string;
    readonly status: string;
  } | null;
  readonly marketing_opt_in: boolean;
}

export interface CrmEvent {
  readonly id: string;
  readonly type: CrmEventType;
  readonly occurred_at: string;
  readonly lead: LeadSnapshot;
}

export interface OutboxRecord {
  readonly event: CrmEvent;
  readonly status: 'stored' | 'delivered' | 'failed';
  readonly attempts: number;
  readonly lastError: string | null;
}

export const CRM_HEADERS = {
  event: 'x-lazyapp-demo-event',
  delivery: 'x-lazyapp-demo-delivery',
  signature: 'x-lazyapp-demo-signature',
} as const;

export function snapshot(ctx: Ctx): LeadSnapshot {
  const { state } = ctx;
  return {
    id: state.leadId,
    phone: ctx.user.phone,
    name: ctx.user.displayName,
    company: state.answers.company,
    email: state.answers.email,
    role: state.answers.role,
    needs: state.answers.needs,
    size: state.answers.size,
    budget: state.answers.budget,
    timeline: state.answers.timeline,
    score: state.score?.value ?? null,
    grade: state.score?.grade ?? null,
    reasons: state.score?.reasons ?? [],
    attribution: state.attribution,
    meeting:
      state.meeting === null
        ? null
        : {
            id: state.meeting.id,
            at: state.meeting.at,
            rep: state.meeting.repId,
            status: state.meeting.status,
          },
    marketing_opt_in: ctx.consent.marketingOptIn,
  };
}

/** Deterministic per inbound event and type: a webhook redelivery maps to the same CRM event. */
function eventId(ctx: Ctx, type: CrmEventType): string {
  return `crm_${createHash('sha256')
    .update(ctx.idempotencyKey(`crm:${type}`))
    .digest('hex')
    .slice(0, 20)}`;
}

/** Records the event and delivers it. Never throws: the chat must not depend on the CRM. */
export async function pushCrmEvent(ctx: Ctx, deps: Deps, type: CrmEventType): Promise<OutboxRecord> {
  const id = eventId(ctx, type);
  const key = `crm:${id}`;
  const existing = ctx.kv.get<OutboxRecord>(key);
  if (existing !== undefined && existing.status !== 'failed') {
    return existing;
  }
  const event: CrmEvent = existing?.event ?? {
    id,
    type,
    occurred_at: ctx.now().toISOString(),
    lead: snapshot(ctx),
  };
  const record = await deliver(deps.config.crm, event, existing?.attempts ?? 0);
  ctx.kv.set(key, record);
  if (record.status === 'failed') {
    ctx.log.warn('CRM delivery failed; kept in the outbox', { type, id, error: record.lastError });
  }
  return record;
}

async function deliver(transport: CrmTransport, event: CrmEvent, attempts: number): Promise<OutboxRecord> {
  if (transport.kind === 'store') {
    return { event, status: 'stored', attempts, lastError: null };
  }
  const body = JSON.stringify(event);
  try {
    const response = await transport.fetch(transport.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CRM_HEADERS.event]: event.type,
        [CRM_HEADERS.delivery]: event.id,
        ...(transport.secret === null
          ? {}
          : { [CRM_HEADERS.signature]: signCrmBody(body, transport.secret) }),
      },
      body,
      signal: AbortSignal.timeout(transport.timeoutMs),
    });
    return response.ok
      ? { event, status: 'delivered', attempts: attempts + 1, lastError: null }
      : { event, status: 'failed', attempts: attempts + 1, lastError: `HTTP ${response.status}` };
  } catch (error) {
    return {
      event,
      status: 'failed',
      attempts: attempts + 1,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Same scheme LazyApp uses for its own webhooks, so a receiver can reuse its verifier. */
export function signCrmBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export async function syncLeadTags(ctx: Ctx): Promise<void> {
  const desired = tagsFor(ctx.state);
  const { add, remove } = tagDiff(ctx.state.tags, desired);
  const contact = ctx.user.contactUuid;
  if ((add.length === 0 && remove.length === 0) || contact === null) {
    return;
  }
  try {
    if (add.length > 0) {
      await ctx.api.contacts.addTags(contact, add, { idempotencyKey: ctx.idempotencyKey('tags:add') });
    }
    if (remove.length > 0) {
      await ctx.api.contacts.removeTags(contact, remove, {
        idempotencyKey: ctx.idempotencyKey('tags:remove'),
      });
    }
    ctx.setState((state) => ({ ...state, tags: desired }));
  } catch (error) {
    ctx.log.warn('could not update lead tags', { error });
  }
}

/**
 * `POST /v1/events`: LazyApp sends the template mapped to the event type. False when it
 * refuses (no mapping), so the caller sends the message itself.
 */
export async function sendBusinessEvent(
  ctx: Ctx,
  type: string,
  properties: Readonly<Record<string, string>>,
  dedupeKey: string,
): Promise<boolean> {
  if (ctx.user.phone === null) {
    return false;
  }
  try {
    await ctx.api.events.send(
      { type, recipient: { phone_number: ctx.user.phone }, properties, idempotency_key: dedupeKey },
      { idempotencyKey: ctx.idempotencyKey(`event:${type}`) },
    );
    return true;
  } catch (error) {
    if (error instanceof LazyAppError) {
      ctx.log.warn('LazyApp refused the business event; sending directly', { type, status: error.status });
      return false;
    }
    throw error;
  }
}
