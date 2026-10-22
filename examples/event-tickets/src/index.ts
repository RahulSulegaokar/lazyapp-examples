import { defineExample } from '@lazyapp-examples/demo-kit';
import { chooseTier, joinWaitlist, leaveWaitlist, showEvent, showEvents, showVenue } from './browse.js';
import { findEvent } from './catalog.js';
import {
  book,
  cancelBooking,
  onPaymentCaptured,
  onPaymentFailed,
  retryPayment,
  simulatePayment,
} from './checkout.js';
import { attendeeEndpoint } from './flow.js';
import { FLOWS, manifest } from './manifest.js';
import { initialTicketsState, ticketsStateSchema } from './state.js';
import type { Ctx, TicketsState } from './state.js';
import {
  addToCalendar,
  askRating,
  checkInLink,
  myTickets,
  previewUpdate,
  rate,
  remindMe,
  schedule,
  showTicket,
  venue,
} from './ticketing.js';
import { webRoutes } from './web.js';

/**
 * Event ticketing on WhatsApp, from discovery to the door: a media carousel of events, tiers with
 * live availability and a waitlist, an attendee Flow priced by a data endpoint (promo codes, fees,
 * GST), India payments (`order_details`) with seat holds, QR tickets rendered server-side as PNG and
 * PDF, add-to-calendar, venue pin, reminders, live updates, a door-staff check-in page that sends a
 * welcome message, and a post-event rating with the photo gallery.
 */
export default defineExample<TicketsState>({
  id: 'event-tickets',
  title: 'LazyApp Events',
  startCode: 'DEMO EVENTS',
  manifest,
  stateSchema: ticketsStateSchema,
  initialState: initialTicketsState,
  describe: () => ({
    summary: 'Discover events, book with a Flow, pay in WhatsApp, get a QR ticket, check in at the door.',
    metaFeatures: [
      'Media carousel',
      'Reply buttons (image header)',
      'WhatsApp Flows (data exchange)',
      'Payments (India, order_details)',
      'Order status',
      'Image + document (generated QR ticket)',
      'CTA URL button',
      'Location',
      'Utility templates + send_at',
      'Location header template',
      'Contact tags',
      'Reactions',
    ],
    emoji: '🎟️',
  }),

  async onStart(ctx) {
    const name = ctx.user.displayName === null ? '' : `, ${ctx.user.displayName}`;
    await showEvents(ctx, `🎟️ Hi${name}! Book tickets without leaving WhatsApp.`);
  },

  async onMenu(ctx) {
    await showEvents(ctx, '🎟️ Here is what is on.');
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'button':
      case 'list':
        return onChoice(ctx, inbound.id);
      case 'flow':
        return onAttendeeDetails(ctx, inbound.response);
      case 'text':
        return onText(ctx, inbound.text);
      default:
        return showEvents(ctx, "I can't read that here. Tap a card to book:");
    }
  },

  async onEvent(ctx, event) {
    switch (event.type) {
      case 'payment.captured':
        return onPaymentCaptured(ctx, event);
      case 'payment.failed':
        return onPaymentFailed(ctx, event);
      default:
        ctx.log.warn('an events demo message failed', { type: event.type });
    }
  },

  flowEndpoints: { [FLOWS.attendee]: attendeeEndpoint },
  web: webRoutes(),
});

async function onChoice(ctx: Ctx, id: string): Promise<void> {
  const [prefix = '', first = '', second = ''] = id.split(':');
  switch (prefix) {
    case 'browse':
      return showEvents(ctx, '🎟️ Here is what is on.');
    case 'ev':
      return showEvent(ctx, first);
    case 'info': {
      const event = findEvent(first);
      return event === undefined ? showEvents(ctx, 'Here is what is on:') : showVenue(ctx, event);
    }
    case 'tier':
      return chooseTier(ctx, first, second);
    case 'qty':
      return onQuantity(ctx, Number(first));
    case 'wl':
      return first === 'join'
        ? joinWaitlist(ctx, second, id.split(':')[3] ?? '')
        : leaveWaitlist(ctx, second, id.split(':')[3] ?? '');
    case 'pay':
      return first === 'sim' ? simulatePayment(ctx, second) : retryPayment(ctx, second);
    case 'bk':
      return cancelBooking(ctx, second);
    case 'my':
      return myTickets(ctx);
    case 'tk':
      return showTicket(ctx, second);
    case 'cal':
      return addToCalendar(ctx, first);
    case 'venue':
      return venue(ctx, first);
    case 'rem':
      return remindMe(ctx, first);
    case 'upd':
      return previewUpdate(ctx, first);
    case 'ci':
      return checkInLink(ctx, first);
    case 'sch':
      return schedule(ctx, first);
    case 'fb':
      return first === 'start' ? askRating(ctx, second) : rate(ctx, second, Number(first));
    default:
      return showEvents(ctx, 'That button is from an older message. Here is what is on:');
  }
}

/** The attendee Flow was submitted: hold the seats and take payment. */
async function onAttendeeDetails(ctx: Ctx, response: Readonly<Record<string, unknown>>): Promise<void> {
  const quantity = Number(response.quantity);
  const name = typeof response.name === 'string' ? response.name.trim() : '';
  if (!Number.isInteger(quantity) || quantity < 1 || name === '') {
    return showEvents(ctx, "That form came back incomplete. Let's try again:");
  }
  await book(ctx, {
    quantity,
    name,
    email: typeof response.email === 'string' && response.email !== '' ? response.email : null,
    promo: typeof response.promo === 'string' && response.promo !== '' ? response.promo : null,
    updates: response.updates === true || response.updates === 'true',
  });
}

/** Quantity buttons: the fallback when the attendee Flow is not published. */
async function onQuantity(ctx: Ctx, quantity: number): Promise<void> {
  if (ctx.state.step !== 'quantity' || !Number.isInteger(quantity) || quantity < 1) {
    return showEvents(ctx, 'That button is from an older message. Here is what is on:');
  }
  await book(ctx, {
    quantity,
    name: ctx.user.displayName ?? 'Guest',
    email: null,
    promo: null,
    updates: false,
  });
}

async function onText(ctx: Ctx, text: string): Promise<void> {
  const lower = text.toLowerCase();
  if (/\b(ticket|booking|qr)\b/.test(lower)) {
    return myTickets(ctx);
  }
  return showEvents(ctx, 'Tap *Get tickets* on any card to book, or *My tickets* to see yours.');
}
