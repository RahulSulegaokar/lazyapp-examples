import { DEMO_FOOTER, formatInr } from '@lazyapp-examples/demo-kit';
import type { DemoEvent } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { CreatePaymentInput, PaymentOrder } from '@lazyapp-examples/sdk';
import type { Booking } from './box-office.js';
import { HOLD_MINUTES } from './box-office.js';
import { boxOffice, showEvent, showEvents } from './browse.js';
import { findEvent, findTier, formatDay, formatTime } from './catalog.js';
import { BOOKING_FEE, FEE_GST } from './pricing.js';
import type { Ctx } from './state.js';
import { deliverTickets, showTicket } from './ticketing.js';

/** Holds seats and moves to payment. Called from the Flow completion or the quantity buttons. */
export async function book(
  ctx: Ctx,
  input: {
    readonly quantity: number;
    readonly name: string;
    readonly email: string | null;
    readonly promo: string | null;
    readonly updates: boolean;
  },
): Promise<void> {
  const selection = ctx.state.selection;
  if (selection === null) {
    return showEvents(ctx, 'That booking timed out. Here is what is on:');
  }
  const result = boxOffice(ctx).hold({
    address: ctx.user.address,
    eventId: selection.eventId,
    tierId: selection.tierId,
    quantity: input.quantity,
    name: input.name,
    email: input.email,
    promo: input.promo,
    updates: input.updates,
  });
  if (!result.ok) {
    await ctx.send.text(
      result.reason === 'not_enough'
        ? `Only ${result.available} seat${result.available === 1 ? ' is' : 's are'} left in that tier now.`
        : 'Those seats just sold out.',
    );
    return showEvent(ctx, selection.eventId);
  }
  ctx.setState((state) => ({ ...state, step: 'payment', bookingId: result.booking.id }));
  return collectPayment(ctx, result.booking);
}

/**
 * Free tickets are issued at once. Paid ones go out as an India payment request (`order_details`,
 * "Review and pay") through LazyApp, using a payment setup when the number has one, a payment link
 * otherwise, and a clearly labelled simulated checkout when neither is configured.
 */
async function collectPayment(ctx: Ctx, booking: Booking): Promise<void> {
  if (booking.quote.total === 0) {
    const issued = boxOffice(ctx).issue(booking);
    return issued === null ? soldOutAfterHold(ctx, booking) : deliverTickets(ctx, issued);
  }
  const event = findEvent(booking.eventId);
  const tier = event === undefined ? undefined : findTier(event, booking.tierId);
  const payments = await ctx.capabilities.payments();
  if (event === undefined || tier === undefined || payments === null || ctx.user.phone === null) {
    return offerSimulatedPayment(ctx, booking, "Payments aren't set up on this demo number");
  }
  const start = new Date(booking.startsAt);
  const input: CreatePaymentInput = {
    to: ctx.user.phone,
    reference_id: `${booking.id}-${booking.paymentAttempts + 1}`,
    body:
      `${event.title} · ${tier.name} × ${booking.quantity}\n${formatDay(start, ctx.now())}, ${formatTime(start)} · ` +
      `${event.venue.name}, ${event.venue.area}\nSeats held for ${HOLD_MINUTES} minutes.`,
    footer: 'LazyApp demo · tickets arrive in this chat',
    header_image_url: event.image,
    goods_type: 'digital-goods',
    expires_in_minutes: HOLD_MINUTES,
    items: [
      {
        name: `${event.title} · ${tier.name}`,
        amount: tier.price,
        quantity: booking.quantity,
        retailer_id: `${event.id}.${tier.id}`,
      },
      { name: 'Booking fee', amount: BOOKING_FEE, quantity: booking.quantity, retailer_id: 'booking-fee' },
    ],
    tax: { amount: FEE_GST * booking.quantity, description: 'GST 18% on the booking fee' },
    ...(booking.quote.discount > 0
      ? {
          discount: {
            amount: booking.quote.discount,
            description: booking.quote.promo?.note ?? 'Promo',
            program_name: booking.quote.promo?.code ?? 'PROMO',
          },
        }
      : {}),
    payment:
      payments.method === 'payment_gateway'
        ? { method: 'payment_gateway', configuration: payments.configuration }
        : { method: payments.method, gateway_account: payments.gatewayAccount },
    metadata: { demo: 'event-tickets', booking: booking.id, session: ctx.session.id },
  };
  let payment: PaymentOrder;
  try {
    payment = await ctx.api.payments.create(input, {
      idempotencyKey: ctx.idempotencyKey(`payment:${booking.id}:${booking.paymentAttempts + 1}`),
    });
  } catch (error) {
    if (error instanceof LazyAppError && !error.retryable) {
      ctx.log.warn('payment request refused, using the simulated checkout', { error });
      return offerSimulatedPayment(
        ctx,
        booking,
        `LazyApp couldn't create the payment request (${error.message})`,
      );
    }
    throw error;
  }
  boxOffice(ctx).attachPayment(booking, payment.id);
  const until = new Date(booking.holdExpiresAt);
  await ctx.send.text(
    `🎟️ ${booking.quantity} seat${booking.quantity === 1 ? '' : 's'} held until *${formatTime(until)}*. ` +
      `Tap *Review and pay* above to pay ${formatInr(booking.quote.total)} with UPI, a card or netbanking` +
      (payments.method === 'payment_gateway' ? ' without leaving WhatsApp.' : '.'),
  );
}

async function offerSimulatedPayment(ctx: Ctx, booking: Booking, reason: string): Promise<void> {
  await ctx.send.buttons({
    body:
      `Total *${formatInr(booking.quote.total)}* for ${booking.quantity} ticket${booking.quantity === 1 ? '' : 's'}.\n\n` +
      `${reason}, so this checkout is simulated. With a payment setup, LazyApp sends a WhatsApp *Review and pay* card here ` +
      'and confirms the payment by webhook.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: `pay:sim:${booking.id}`, title: 'Simulate payment' },
      { id: `bk:cancel:${booking.id}`, title: 'Cancel' },
    ],
  });
}

/** Only allowed when no real payment request exists for the booking. */
export async function simulatePayment(ctx: Ctx, bookingId: string): Promise<void> {
  const booking = ownBooking(ctx, bookingId);
  if (booking?.paymentId !== null) {
    return showEvents(ctx, 'That booking is no longer waiting for payment. Here is what is on:');
  }
  if (booking.status === 'issued') {
    return showTicket(ctx, booking.id);
  }
  const issued = boxOffice(ctx).issue(booking);
  return issued === null ? soldOutAfterHold(ctx, booking) : deliverTickets(ctx, issued);
}

export async function retryPayment(ctx: Ctx, bookingId: string): Promise<void> {
  const booking = ownBooking(ctx, bookingId);
  if (booking === undefined || booking.status === 'issued' || booking.status === 'cancelled') {
    return showEvents(ctx, 'That booking is already settled. Here is what is on:');
  }
  const renewed = boxOffice(ctx).renewHold(booking);
  if (renewed === null) {
    return soldOutAfterHold(ctx, booking);
  }
  return collectPayment(ctx, renewed);
}

export async function cancelBooking(ctx: Ctx, bookingId: string): Promise<void> {
  const booking = ownBooking(ctx, bookingId);
  if (booking !== undefined && booking.status !== 'issued') {
    boxOffice(ctx).release(booking, 'cancelled');
    if (booking.paymentId !== null) {
      // Cancels the pending WhatsApp order, so the "Review and pay" card can no longer be paid.
      try {
        await ctx.api.payments.updateStatus(
          booking.paymentId,
          { status: 'canceled', description: 'Booking cancelled by the buyer' },
          { idempotencyKey: ctx.idempotencyKey(`cancel:${booking.paymentId}`) },
        );
      } catch (error) {
        ctx.log.warn('could not cancel the pending payment request', { error });
      }
    }
  }
  ctx.setState((state) => ({ ...state, step: 'browse', bookingId: null }));
  await showEvents(ctx, 'Cancelled: the seats are released and nothing was charged.');
}

/** `payment.captured`: issue the tickets (exactly once), or refund if the seats were sold meanwhile. */
export async function onPaymentCaptured(ctx: Ctx, event: DemoEvent): Promise<void> {
  const payment = paymentOf(event);
  const booking = payment === null ? undefined : bookingForPayment(ctx, payment);
  if (payment === null || booking === undefined) {
    return;
  }
  if (booking.status === 'issued') {
    if (booking.paymentId !== payment.id) {
      // An older payment request was paid as well: never keep money twice for one booking.
      await refund(ctx, payment);
      await ctx.send.text(
        `You paid twice for ${booking.id}; the second payment of ${formatInr(payment.total_amount)} is being refunded in full.`,
      );
    }
    return; // Otherwise a redelivered webhook: the tickets are already in the chat.
  }
  const issued = boxOffice(ctx).issue(booking, payment.id);
  if (issued === null) {
    await refund(ctx, payment);
    boxOffice(ctx).release(booking, 'refunded');
    await ctx.send.text(
      `Your payment for ${booking.id} arrived after the ${HOLD_MINUTES}-minute hold, and those seats sold in the meantime. ` +
        `A full refund of ${formatInr(payment.total_amount)} is on its way to the account you paid from.`,
    );
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'ticketed', bookingId: issued.id }));
  if (payment.payment_method === 'payment_gateway') {
    try {
      await ctx.api.payments.updateStatus(
        payment.id,
        { status: 'completed', description: `Tickets issued: booking ${issued.id}` },
        { idempotencyKey: ctx.idempotencyKey(`order-status:${payment.id}`) },
      );
    } catch (error) {
      ctx.log.warn('could not update the WhatsApp order status', { error });
    }
  }
  await deliverTickets(ctx, issued);
}

/** `payment.failed`: say why, keep the seats, offer a retry. */
export async function onPaymentFailed(ctx: Ctx, event: DemoEvent): Promise<void> {
  const payment = paymentOf(event);
  const booking = payment === null ? undefined : bookingForPayment(ctx, payment);
  if (payment === null || booking?.paymentId !== payment.id || booking.status === 'issued') {
    return; // Not ours, an older attempt, or already paid.
  }
  const reason = payment.last_error ?? 'the bank declined it';
  await ctx.send.buttons({
    body:
      `The payment for ${booking.id} didn't go through (${reason}). Nothing was charged.\n\n` +
      `Your seats are held until *${formatTime(new Date(booking.holdExpiresAt))}*.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `pay:retry:${booking.id}`, title: 'Try again' },
      { id: `bk:cancel:${booking.id}`, title: 'Cancel booking' },
    ],
  });
}

async function soldOutAfterHold(ctx: Ctx, booking: Booking): Promise<void> {
  boxOffice(ctx).release(booking, 'expired');
  await ctx.send.text(
    `Sorry, the hold on ${booking.id} ran out and those seats have been sold. Nothing was charged.`,
  );
  return showEvent(ctx, booking.eventId);
}

function ownBooking(ctx: Ctx, bookingId: string): Booking | undefined {
  const booking = boxOffice(ctx).get(bookingId);
  return booking?.address === ctx.user.address ? booking : undefined;
}

function paymentOf(event: DemoEvent): PaymentOrder | null {
  const payment = event.data.payment;
  return typeof payment === 'object' && payment !== null && 'id' in payment
    ? (payment as PaymentOrder)
    : null;
}

/** The booking a payment belongs to: our metadata first, then the `<booking>-<attempt>` reference. */
function bookingForPayment(ctx: Ctx, payment: PaymentOrder): Booking | undefined {
  return ownBooking(ctx, payment.metadata?.booking ?? payment.reference_id.replace(/-\d+$/, ''));
}

async function refund(ctx: Ctx, payment: PaymentOrder): Promise<void> {
  try {
    await ctx.api.payments.refund(
      payment.id,
      { amount: payment.amount_paid > 0 ? payment.amount_paid : payment.total_amount },
      { idempotencyKey: ctx.idempotencyKey(`refund:${payment.id}`) },
    );
  } catch (error) {
    ctx.log.error('refund failed: needs a manual refund', { error, payment: payment.id });
  }
}
