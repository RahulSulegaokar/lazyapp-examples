import type { FlowEndpointHandler, FlowExchangeResponse } from '@lazyapp-examples/demo-kit';
import { formatInr } from '@lazyapp-examples/demo-kit';
import { BoxOffice, HOLD_MINUTES, MAX_PER_BOOKING } from './box-office.js';
import { findEvent, findTier, formatWhen } from './catalog.js';
import { quote, receiptLines } from './pricing.js';
import type { TicketsState } from './state.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Data endpoint of the attendee Flow. INIT fills the first screen (event, live availability as the
 * quantity options, the WhatsApp profile name); `data_exchange` validates and prices the order so the
 * summary screen shows the exact total, fees and promo before anything is held or charged.
 */
export const attendeeEndpoint: FlowEndpointHandler<TicketsState> = async (ctx, request) => {
  const selection = ctx.state.selection;
  const event = selection === null ? undefined : findEvent(selection.eventId);
  const tier = event === undefined || selection === null ? undefined : findTier(event, selection.tierId);
  if (event === undefined || tier === undefined) {
    return {
      screen: 'DETAILS',
      data: {
        event_title: 'Booking expired',
        tier_line: 'Close this form and pick the tickets again in the chat.',
        name: '',
        quantities: [{ id: '1', title: '1 ticket' }],
        error_message: 'This booking expired. Close the form and pick your tickets again in the chat.',
      },
    };
  }
  const available = new BoxOffice(ctx.kv, ctx.now).available(event, tier);
  const details = (extra: Record<string, unknown> = {}): FlowExchangeResponse => ({
    screen: 'DETAILS',
    data: {
      event_title: event.title,
      tier_line: `${tier.name} · ${tier.price === 0 ? 'Free' : `${formatInr(tier.price)} each`} · ${formatWhen(event, ctx.now())}`,
      name: ctx.user.displayName ?? '',
      quantities: Array.from(
        { length: Math.max(1, Math.min(available, MAX_PER_BOOKING)) },
        (_value, index) => ({
          id: String(index + 1),
          title: `${index + 1} ticket${index === 0 ? '' : 's'}`,
        }),
      ),
      ...extra,
    },
  });

  if (request.action !== 'data_exchange') {
    return details();
  }
  const data = request.data ?? {};
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const quantity = Number(data.quantity);
  const promo =
    typeof data.promo === 'string' && data.promo.trim() !== '' ? data.promo.trim().toUpperCase() : '';
  const updates = data.updates === true || data.updates === 'true';
  if (name.length < 2) {
    return details({ error_message: 'Please enter the name for the ticket.' });
  }
  if (!EMAIL.test(email)) {
    return details({ error_message: 'That email address does not look right.' });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_BOOKING) {
    return details({ error_message: 'Choose how many tickets you need.' });
  }
  if (quantity > available) {
    return details({
      error_message:
        available === 0
          ? 'Those tickets just sold out.'
          : `Only ${available} left. Choose ${available} or fewer.`,
    });
  }
  const priced = quote(event, tier, quantity, promo === '' ? null : promo);
  return {
    screen: 'SUMMARY',
    data: {
      event_title: `${event.title} · ${formatWhen(event, ctx.now())}`,
      summary: receiptLines(tier, priced).join('\n'),
      promo_note: priced.promo?.note ?? 'No promo code applied.',
      hold_note:
        priced.total === 0
          ? 'Your free tickets arrive in the chat as soon as you confirm.'
          : `Seats are held for ${HOLD_MINUTES} minutes once you confirm, while you pay in WhatsApp.`,
      name,
      email,
      quantity: String(quantity),
      promo,
      updates,
    },
  };
};
