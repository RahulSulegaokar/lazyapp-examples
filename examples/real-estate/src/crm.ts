import { LazyAppError } from '@lazyapp-examples/sdk';
import { tagDiff, tagsFor } from './scoring.js';
import type { Ctx } from './types.js';

/**
 * Keeps the LazyApp contact's tags in step with the lead score. Only the difference is
 * sent, and a failure never interrupts the conversation: tags are for the sales team's
 * segments, not for the buyer.
 */
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
 * Records a business event with LazyApp (`POST /v1/events`), which sends the template the
 * workspace maps to it. Returns false when LazyApp refuses (no mapping, unknown type) so the
 * caller can send the message itself.
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
