import { DEMO_FOOTER, fit, formatInr, ui } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { PaymentOrder } from '@lazyapp-examples/sdk';
import { BRAND, etaMinutes, findItem, findOutlet } from './kitchen.js';
import type { Outlet } from './kitchen.js';
import { FoodOrderBook, orderIdFrom, pickupCodeFor } from './orders.js';
import type { FoodOrder } from './orders.js';
import { cartView, startOrder } from './ordering.js';
import { bill, billText, LoyaltyLedger, redeemablePoints } from './pricing.js';
import type { Bill } from './pricing.js';
import { instantLabel, isKitchenOpen, laterSlots } from './schedule.js';
import type { Schedule } from './state.js';
import type { FoodCtx } from './views.js';

const PAYMENT_EXPIRY_MINUTES = 15;

function currentBill(ctx: FoodCtx): Bill {
  const points = new LoyaltyLedger(ctx.kv).get(ctx.user.address, ctx.now()).points;
  return bill(ctx.state.cart, {
    mode: ctx.state.mode ?? 'delivery',
    pointsBalance: points,
    usePoints: ctx.state.usePoints,
  });
}

function etaFor(ctx: FoodCtx): number {
  return ctx.state.mode === 'pickup' ? 20 : etaMinutes(ctx.state.drop?.km ?? 3);
}

export async function startCheckout(ctx: FoodCtx): Promise<void> {
  if (ctx.state.cart.length === 0) {
    return cartView(ctx);
  }
  if (findOutlet(ctx.state.outletId) === undefined || ctx.state.mode === null) {
    return startOrder(ctx, 'First, where should we bring it?');
  }
  await askWhen(ctx);
}

// --- When ---------------------------------------------------------------------------------

export async function askWhen(ctx: FoodCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'when' }));
  if (!isKitchenOpen(ctx.now())) {
    return askLater(
      ctx,
      'Our kitchens are closed right now (open 11 am – 11 pm), but you can order for later.',
    );
  }
  await ctx.send.buttons({
    body: ctx.state.mode === 'pickup' ? 'When will you pick it up?' : 'When should we deliver?',
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'when:asap', title: `Now · ~${etaFor(ctx)} min` },
      { id: 'when:later', title: 'Schedule for later' },
    ],
  });
}

export async function askLater(ctx: FoodCtx, intro?: string): Promise<void> {
  await ctx.send.list({
    header: 'Schedule your order',
    body: `${intro === undefined ? '' : `${intro}\n\n`}Pick a time. We start cooking 30 minutes before.`,
    button: 'Choose time',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Time slots',
        rows: laterSlots(ctx.now()).map((slot) => ({
          id: `when:at:${slot.at.getTime()}`,
          title: slot.label.split(', ').at(-1) ?? slot.label,
          description: slot.label,
        })),
      },
    ],
  });
}

export async function chooseWhen(ctx: FoodCtx, choice: string, at?: string): Promise<void> {
  let schedule: Schedule;
  if (choice === 'asap' && isKitchenOpen(ctx.now())) {
    schedule = { kind: 'asap' };
  } else {
    const slot = laterSlots(ctx.now()).find((entry) => String(entry.at.getTime()) === at);
    if (slot === undefined) {
      return askLater(ctx, choice === 'asap' ? 'The kitchen has just closed.' : 'That slot has passed.');
    }
    schedule = { kind: 'later', at: slot.at.toISOString(), label: slot.label };
  }
  ctx.setState((state) => ({ ...state, schedule }));
  if (ctx.state.mode === 'delivery' && ctx.state.drop?.details === null) {
    return askAddress(ctx);
  }
  await review(ctx);
}

// --- Address details ------------------------------------------------------------------------

/** The pin is known; the rider still needs the flat and a landmark. */
export async function askAddress(ctx: FoodCtx): Promise<void> {
  if (ctx.user.phone?.startsWith('+91') === true) {
    ctx.setState((state) => ({ ...state, step: 'address' }));
    await ctx.send.interactive(
      ui.addressRequest({
        body: 'Almost there! Add your flat or house number and a landmark so the rider finds you.',
        values: {
          ...(ctx.user.displayName === null ? {} : { name: ctx.user.displayName }),
          phone_number: ctx.user.phone.slice(3),
          city: 'Bengaluru',
          state: 'Karnataka',
        },
      }),
    );
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'address_text' }));
  await ctx.send.text('Almost there! Type your flat or house number, building and a landmark for the rider.');
}

export async function onAddress(ctx: FoodCtx, values: Readonly<Record<string, string>>): Promise<void> {
  const details = [
    values.house_number,
    values.floor_number === undefined ? undefined : `floor ${values.floor_number}`,
    values.building_name,
    values.address,
    values.landmark_area === undefined ? undefined : `near ${values.landmark_area}`,
  ]
    .filter((part): part is string => part !== undefined && part.trim() !== '')
    .join(', ');
  if (details.length < 3) {
    await ctx.send.interactive(
      ui.addressRequest({
        body: 'The rider needs at least a house or flat number.',
        values: { ...values },
        validationErrors: { house_number: 'Add your flat or house number' },
      }),
    );
    return;
  }
  await saveDetails(ctx, details);
}

export async function onAddressText(ctx: FoodCtx, text: string): Promise<void> {
  if (text.trim().length < 5) {
    await ctx.send.text('A little more detail please: flat or house number, building, landmark.');
    return;
  }
  await saveDetails(ctx, text.trim().slice(0, 200));
}

async function saveDetails(ctx: FoodCtx, details: string): Promise<void> {
  ctx.setState((state) => ({ ...state, drop: state.drop === null ? null : { ...state.drop, details } }));
  await review(ctx);
}

// --- Review & pay ----------------------------------------------------------------------------

export async function review(ctx: FoodCtx): Promise<void> {
  const outlet = findOutlet(ctx.state.outletId);
  const schedule = ctx.state.schedule;
  if (outlet === undefined || ctx.state.mode === null) {
    return startOrder(ctx);
  }
  if (schedule === null) {
    return askWhen(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'review' }));
  const value = currentBill(ctx);
  const ledger = new LoyaltyLedger(ctx.kv).get(ctx.user.address, ctx.now());
  const redeemable = ctx.state.usePoints ? 0 : redeemablePoints(ledger.points, value.subtotal);
  const pickup = ctx.state.mode === 'pickup';
  await ctx.send.buttons({
    header: 'Review your order',
    body: [
      billText(value),
      '',
      pickup ? `🛍️ Pickup at Masala Mile ${outlet.name}` : `🛵 From Masala Mile ${outlet.name}`,
      ...(pickup || ctx.state.drop?.details === null || ctx.state.drop === null
        ? []
        : [`📍 ${ctx.state.drop.details}`]),
      `🕒 ${schedule.kind === 'asap' ? `Now, about ${etaFor(ctx)} minutes` : schedule.label}`,
      ...(redeemable === 0
        ? []
        : ['', `🎁 Use ${redeemable} Club points to save ${formatInr(redeemable * 50)}?`]),
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'pay:prepaid', title: 'Pay now · UPI' },
      { id: 'pay:cod', title: pickup ? 'Pay at pickup' : 'Cash on delivery' },
      ...(redeemable === 0 ? [] : [{ id: 'points:use', title: `Use ${redeemable} points` }]),
    ],
  });
}

export async function usePoints(ctx: FoodCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, usePoints: true }));
  await review(ctx);
}

export async function payNow(ctx: FoodCtx): Promise<void> {
  const outlet = findOutlet(ctx.state.outletId);
  const value = currentBill(ctx);
  if (outlet === undefined || value.lines.length === 0 || ctx.state.schedule === null) {
    return cartView(ctx);
  }
  const payments = await ctx.capabilities.payments();
  const phone = ctx.user.phone;
  if (payments === null || phone === null) {
    await ctx.send.text(
      payments === null
        ? `Online payment is not set up on this demo number yet, so this order is ${ctx.state.mode === 'pickup' ? 'pay at pickup' : 'cash on delivery'} (UPI to the rider works too).`
        : 'WhatsApp payments need a phone number, so this order is cash on delivery.',
    );
    return placeCod(ctx);
  }

  const order = buildOrder(ctx, value, outlet, 'prepaid');
  const book = new FoodOrderBook(ctx.kv);
  book.save(order);
  let payment: PaymentOrder;
  try {
    payment = await ctx.api.payments.create(
      {
        to: phone,
        reference_id: order.id,
        body: `Order ${order.id} from Masala Mile ${outlet.name}. Pay with any UPI app and we start cooking.`,
        footer: 'LazyApp demo kitchen',
        header_image_url: value.lines[0]?.item.imageUrl ?? BRAND.banner,
        goods_type: 'physical-goods',
        importer: BRAND.importer,
        expires_in_minutes: PAYMENT_EXPIRY_MINUTES,
        items: value.lines.map((line) => ({
          name: fit(line.label, 60),
          amount: line.unitPaise,
          quantity: line.line.qty,
          retailer_id: line.item.id,
          country_of_origin: 'India',
        })),
        tax: { amount: value.gst, description: 'GST 5%' },
        shipping: {
          amount: value.packaging + value.delivery,
          description: value.delivery === 0 ? 'Packaging' : 'Delivery and packaging',
        },
        ...(value.discount === 0
          ? {}
          : {
              discount: {
                amount: value.discount,
                description: `${value.pointsUsed} Club points`,
                program_name: 'Masala Mile Club',
              },
            }),
        payment:
          payments.method === 'payment_gateway'
            ? { method: 'payment_gateway', configuration: payments.configuration }
            : { method: payments.method, gateway_account: payments.gatewayAccount },
        metadata: { demo: 'food-ordering', order: order.id },
      },
      { idempotencyKey: ctx.idempotencyKey('payment') },
    );
  } catch (error) {
    if (!(error instanceof LazyAppError) || error.retryable) {
      throw error;
    }
    ctx.log.warn('payment request refused', { code: error.code, status: error.status });
    book.update(ctx.user.address, order.id, (stored) => ({ ...stored, status: 'cancelled' }));
    await ctx.send.text(
      `WhatsApp could not create the payment request (${error.message}). Switching to cash on delivery.`,
    );
    return placeCod(ctx);
  }
  book.update(ctx.user.address, order.id, (stored) => ({
    ...stored,
    paymentId: payment.id,
    nativeOrderStatus: payment.payment_method === 'payment_gateway',
  }));
  ctx.setState((state) => ({ ...state, step: 'awaiting_payment', checkoutOrderId: order.id }));
  if (payments.method !== 'payment_gateway') {
    await ctx.send.text(
      'In-WhatsApp checkout is not set up on this demo number, so the order above opens a secure payment link.',
    );
  }
}

export async function placeCod(ctx: FoodCtx): Promise<void> {
  const outlet = findOutlet(ctx.state.outletId);
  const value = currentBill(ctx);
  if (outlet === undefined || value.lines.length === 0 || ctx.state.schedule === null) {
    return cartView(ctx);
  }
  const order = buildOrder(ctx, value, outlet, 'cod');
  new FoodOrderBook(ctx.kv).save(order);
  await orderPlaced(ctx, order);
}

export async function onPaymentCaptured(ctx: FoodCtx, payment: PaymentOrder): Promise<void> {
  const id = payment.metadata?.order ?? payment.reference_id;
  const book = new FoodOrderBook(ctx.kv);
  const order = book.get(ctx.user.address, id);
  if (order === undefined || (order.status !== 'awaiting_payment' && order.status !== 'payment_failed')) {
    return;
  }
  const placed = book.update(ctx.user.address, id, (stored) => ({
    ...stored,
    status: 'placed',
    paymentId: payment.id,
  }));
  if (placed === undefined) {
    return;
  }
  if (placed.nativeOrderStatus) {
    try {
      await ctx.api.payments.updateStatus(
        payment.id,
        { status: 'processing', description: `Paid. Masala Mile is cooking order ${id}.` },
        { idempotencyKey: ctx.idempotencyKey('order-status:processing') },
      );
    } catch (error) {
      ctx.log.warn('could not move the order to processing', { error });
    }
  }
  await orderPlaced(ctx, placed);
}

export async function onPaymentFailed(ctx: FoodCtx, payment: PaymentOrder): Promise<void> {
  const id = payment.metadata?.order ?? payment.reference_id;
  const book = new FoodOrderBook(ctx.kv);
  if (book.get(ctx.user.address, id)?.status !== 'awaiting_payment') {
    return;
  }
  book.update(ctx.user.address, id, (stored) => ({ ...stored, status: 'payment_failed' }));
  ctx.setState((state) => ({ ...state, step: 'review', checkoutOrderId: null }));
  await ctx.send.buttons({
    body: `The payment for order ${id} didn't go through, and no money was taken. Your cart is still here.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'pay:prepaid', title: 'Try again' },
      { id: 'pay:cod', title: ctx.state.mode === 'pickup' ? 'Pay at pickup' : 'Cash on delivery' },
    ],
  });
}

function buildOrder(ctx: FoodCtx, value: Bill, outlet: Outlet, payment: 'prepaid' | 'cod'): FoodOrder {
  const schedule = ctx.state.schedule ?? { kind: 'asap' };
  const id = orderIdFrom(ctx.idempotencyKey('order'));
  const due =
    schedule.kind === 'asap' ? new Date(ctx.now().getTime() + etaFor(ctx) * 60_000) : new Date(schedule.at);
  const drop = ctx.state.drop;
  return {
    id,
    customer: ctx.user.address,
    createdAt: ctx.now().toISOString(),
    outletId: outlet.id,
    mode: ctx.state.mode ?? 'delivery',
    lines: value.lines.map((line) => ({ ...line.line, label: line.label, unitPaise: line.unitPaise })),
    subtotal: value.subtotal,
    discount: value.discount,
    pointsUsed: value.pointsUsed,
    packaging: value.packaging,
    delivery: value.delivery,
    gst: value.gst,
    total: value.total,
    payment,
    paymentId: null,
    nativeOrderStatus: false,
    status: payment === 'cod' ? 'placed' : 'awaiting_payment',
    dueAt: due.toISOString(),
    scheduled: schedule.kind === 'later',
    drop:
      ctx.state.mode === 'delivery' && drop !== null
        ? { latitude: drop.latitude, longitude: drop.longitude, km: drop.km, details: drop.details }
        : null,
    pickupCode: pickupCodeFor(id),
    rating: null,
    reviewWamid: null,
  };
}

async function orderPlaced(ctx: FoodCtx, order: FoodOrder): Promise<void> {
  if (order.pointsUsed > 0) {
    new LoyaltyLedger(ctx.kv).add(ctx.user.address, -order.pointsUsed, `Redeemed on ${order.id}`, ctx.now());
  }
  ctx.setState((state) => ({
    ...state,
    step: 'home',
    cart: [],
    usePoints: false,
    schedule: null,
    checkoutOrderId: null,
  }));
  const outlet = findOutlet(order.outletId);
  const due = instantLabel(new Date(order.dueAt), ctx.now());
  await ctx.send.react('✅');
  await ctx.send.buttons({
    header: { image: orderImage(order) },
    body: [
      `*Order ${order.id} placed* 🎉`,
      '',
      ...order.lines.map((line) => `• ${line.qty} × ${line.label}`),
      '',
      order.payment === 'prepaid'
        ? `*Paid: ${formatInr(order.total)}*`
        : `*To pay ${order.mode === 'pickup' ? 'at pickup' : 'on delivery'}: ${formatInr(order.total)}* (cash or UPI)`,
      `${order.mode === 'pickup' ? '🛍️ Pickup' : '🛵 Delivery'} from Masala Mile ${outlet?.name ?? ''}`,
      `🕒 ${order.scheduled ? 'Scheduled for' : 'Expected by'} ${due}`,
    ].join('\n'),
    footer: 'Demo: ⏩ simulates the kitchen · MENU · EXIT',
    buttons: [
      { id: `kitchen:${order.id}`, title: '⏩ Kitchen update' },
      { id: `track:${order.id}`, title: 'Track order' },
      { id: 'home:more', title: 'More options' },
    ],
  });
  await recordOrder(ctx);
}

function orderImage(order: FoodOrder): string {
  for (const line of order.lines) {
    const image = findItem(line.itemId)?.imageUrl;
    if (image !== undefined && image !== null) {
      return image;
    }
  }
  return BRAND.banner;
}

/**
 * CRM: tag the contact so the order shows up in LazyApp segments (e.g. a broadcast to consented
 * repeat customers). Not `POST /v1/events`: that endpoint always sends the event's mapped template,
 * which here would be a second, paid "order placed" message on top of the one already in the chat.
 */
async function recordOrder(ctx: FoodCtx): Promise<void> {
  if (ctx.user.contactUuid === null) {
    return;
  }
  try {
    await ctx.api.contacts.addTags(ctx.user.contactUuid, ['demo-food-customer'], {
      idempotencyKey: ctx.idempotencyKey('tag:customer'),
    });
  } catch (error) {
    ctx.log.warn('could not tag the customer in LazyApp', { error });
  }
}
