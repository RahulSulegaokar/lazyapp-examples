import { DEMO_FOOTER, fit, FlowUnavailableError, formatInr, ui } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { PaymentOrder } from '@lazyapp-examples/sdk';
import { BRAND } from './catalog.js';
import { askSize, CART_REMINDER_KEY, firstMissingSize, showCart } from './cart.js';
import {
  addressFromForm,
  addressFromText,
  deliverySlots,
  findSlot,
  formatAddress,
  isCodAvailable,
  toAddressValues,
} from './delivery.js';
import { FLOWS } from './manifest.js';
import { awbFor, OrderBook, orderIdFrom } from './orders.js';
import type { Order } from './orders.js';
import { billText, COD_LIMIT, lineLabel, quote } from './pricing.js';
import type { PaymentChoice, Quote } from './pricing.js';
import { deliveryAddressSchema } from './state.js';
import type { DeliveryAddress } from './state.js';
import { nudge, storefront } from './views.js';
import type { ShopCtx } from './views.js';

const PAYMENT_EXPIRY_MINUTES = 30;

export async function startCheckout(ctx: ShopCtx): Promise<void> {
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: null });
  if (bill.lines.length === 0) {
    return showCart(ctx);
  }
  const missing = firstMissingSize(ctx.state.cart);
  if (missing !== null) {
    return askSize(ctx, missing);
  }
  await askAddress(ctx);
}

// --- Address ----------------------------------------------------------------------

function savedAddress(ctx: ShopCtx): DeliveryAddress | null {
  const parsed = deliveryAddressSchema.safeParse(ctx.kv.get(`address:${ctx.user.address}`));
  return parsed.success ? parsed.data : null;
}

/**
 * India address message for +91 numbers (WhatsApp's native form, with the last
 * address saved), the address Flow elsewhere, and typed text as the last resort.
 */
export async function askAddress(
  ctx: ShopCtx,
  errors?: Record<string, string>,
  values?: Record<string, string>,
): Promise<void> {
  const saved = savedAddress(ctx);
  if (ctx.user.phone?.startsWith('+91') === true) {
    ctx.setState((state) => ({ ...state, step: 'address' }));
    await ctx.send.interactive(
      ui.addressRequest({
        body:
          errors === undefined
            ? 'Where should we deliver? Fill in your address, or pick the one you used last time.'
            : 'A couple of details need fixing. Please check the highlighted fields.',
        values: values ?? {
          ...(ctx.user.displayName === null ? {} : { name: ctx.user.displayName }),
          phone_number: ctx.user.phone.slice(3),
        },
        ...(saved === null || errors !== undefined
          ? {}
          : { savedAddresses: [{ id: 'last-used', value: toAddressValues(saved) }] }),
        ...(errors === undefined ? {} : { validationErrors: errors }),
      }),
    );
    return;
  }
  try {
    ctx.setState((state) => ({ ...state, step: 'address' }));
    await ctx.flows.send({
      key: FLOWS.address,
      header: 'Delivery address',
      body: 'Where should we deliver? It takes 20 seconds.',
      cta: 'Add address',
      screen: 'ADDRESS',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    ctx.setState((state) => ({ ...state, step: 'address_text' }));
    await ctx.send.text(
      'Please type your delivery address with the PIN code, for example:\n_Asha Rao, 12 MG Road, Indiranagar, Bengaluru 560038_',
    );
  }
}

export async function onAddressForm(
  ctx: ShopCtx,
  values: Readonly<Record<string, string>>,
  savedAddressId: string | null,
): Promise<void> {
  const saved = savedAddress(ctx);
  if (savedAddressId !== null && saved !== null && Object.keys(values).length === 0) {
    return useAddress(ctx, saved);
  }
  const result = addressFromForm(values);
  if (!result.ok) {
    return askAddress(ctx, result.errors, { ...values });
  }
  await useAddress(ctx, result.address);
}

/** The address Flow's `complete` payload. */
export async function onAddressFlow(
  ctx: ShopCtx,
  response: Readonly<Record<string, unknown>>,
): Promise<void> {
  const text = (key: string): string => (typeof response[key] === 'string' ? response[key] : '');
  const result = addressFromForm({
    name: text('name'),
    house_number: text('house'),
    address: text('street'),
    landmark_area: text('landmark'),
    city: text('city'),
    in_pin_code: text('pincode'),
    state: text('state'),
  });
  if (!result.ok) {
    await ctx.send.text(`That address is missing something: ${Object.values(result.errors).join('; ')}.`);
    return askAddress(ctx);
  }
  await useAddress(ctx, result.address);
}

export async function onAddressText(ctx: ShopCtx, text: string): Promise<void> {
  const address = addressFromText(text, ctx.user.displayName);
  if (address === null) {
    await ctx.send.text(
      'I need the full address with a 6-digit PIN code, separated by commas:\n_Name, house and street, area, city 560038_',
    );
    return;
  }
  await useAddress(ctx, address);
}

async function useAddress(ctx: ShopCtx, address: DeliveryAddress): Promise<void> {
  ctx.kv.set(`address:${ctx.user.address}`, address);
  ctx.setState((state) => ({ ...state, address }));
  await askSlot(ctx);
}

// --- Slot ---------------------------------------------------------------------------

export async function askSlot(ctx: ShopCtx): Promise<void> {
  const address = ctx.state.address;
  if (address === null) {
    return askAddress(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'slot' }));
  const slots = deliverySlots(ctx.now());
  await ctx.send.list({
    header: 'Pick a delivery slot',
    body: `Delivering to: ${formatAddress(address)}\n\nWhen should we come?`,
    button: 'Choose slot',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Available slots',
        rows: slots.map((slot) => ({
          id: `slot:${slot.id}`,
          title: slot.label.split(', ')[0] ?? slot.label,
          description: slot.label,
        })),
      },
    ],
  });
}

export async function chooseSlot(ctx: ShopCtx, id: string): Promise<void> {
  const slot = findSlot(id, ctx.now());
  if (slot === undefined) {
    await ctx.send.text('That slot is no longer available. Here are the current ones.');
    return askSlot(ctx);
  }
  ctx.setState((state) => ({ ...state, slot }));
  await askPayment(ctx);
}

// --- Payment choice ------------------------------------------------------------------

function codRefusal(bill: Quote, address: DeliveryAddress): string | null {
  if (!isCodAvailable(address.pincode)) {
    return `Cash on delivery isn't available for PIN ${address.pincode}.`;
  }
  if (bill.total + 4_900 > COD_LIMIT) {
    return `Cash on delivery is available up to ${formatInr(COD_LIMIT)}.`;
  }
  return null;
}

export async function askPayment(ctx: ShopCtx): Promise<void> {
  const { address, slot } = ctx.state;
  if (address === null) {
    return askAddress(ctx);
  }
  if (slot === null) {
    return askSlot(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'payment' }));
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: null });
  const codNote = codRefusal(bill, address);
  await ctx.send.buttons({
    header: 'Review your order',
    body: [
      billText(bill),
      '',
      `📍 ${formatAddress(address)}`,
      `🚚 ${slot.label}`,
      '',
      codNote ?? 'Pay now by UPI or card, or pay cash on delivery (+₹49).',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'pay:prepaid', title: 'Pay now · UPI/card' },
      ...(codNote === null ? [{ id: 'pay:cod', title: 'Cash on delivery' }] : []),
      { id: 'checkout:address', title: 'Change address' },
    ],
  });
}

// --- Cash on delivery -----------------------------------------------------------------

/** COD needs an explicit confirmation: it is the cheapest fix for refused deliveries. */
export async function askCodConfirmation(ctx: ShopCtx, intro?: string): Promise<void> {
  const { address, slot } = ctx.state;
  if (address === null || slot === null) {
    return askPayment(ctx);
  }
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: 'cod' });
  const refusal = codRefusal(bill, address);
  if (refusal !== null) {
    return nudge(ctx, `${intro ?? ''} ${refusal} Please pay online instead.`.trim());
  }
  ctx.setState((state) => ({ ...state, step: 'confirming_cod' }));
  await ctx.send.buttons({
    header: 'Confirm cash on delivery',
    body: [
      ...(intro === undefined ? [] : [intro, '']),
      billText(bill),
      '',
      `Please keep *${formatInr(bill.total)}* ready on ${slot.label}. You can also pay the courier by UPI.`,
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'cod:confirm', title: 'Confirm order' },
      { id: 'pay:prepaid', title: 'Pay online instead' },
      { id: 'cart:view', title: 'Back to cart' },
    ],
  });
}

export async function confirmCod(ctx: ShopCtx): Promise<void> {
  const { address, slot } = ctx.state;
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: 'cod' });
  if (address === null || slot === null || bill.lines.length === 0) {
    return showCart(ctx);
  }
  const order = buildOrder(ctx, bill, 'cod', address);
  new OrderBook(ctx.kv).save(order);
  await orderConfirmed(ctx, order);
}

// --- Prepaid --------------------------------------------------------------------------

/**
 * Creates the order and asks WhatsApp for payment with `POST /v1/payments`: an
 * order_details message (UPI apps, cards, netbanking) when the number has a payment
 * configuration, or a gateway payment link. Without either, falls back to COD.
 */
export async function payNow(ctx: ShopCtx): Promise<void> {
  const { address, slot } = ctx.state;
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: 'prepaid' });
  if (address === null || slot === null || bill.lines.length === 0) {
    return showCart(ctx);
  }
  const payments = await ctx.capabilities.payments();
  const phone = ctx.user.phone;
  if (payments === null || phone === null) {
    const refusal = codRefusal(
      quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: 'cod' }),
      address,
    );
    if (refusal !== null) {
      return nudge(
        ctx,
        `Online payment is not set up on this demo number, and ${refusal.charAt(0).toLowerCase()}${refusal.slice(1)} Try another address or a smaller order.`,
      );
    }
    return askCodConfirmation(
      ctx,
      payments === null
        ? 'Online payment is not set up on this demo number yet, so this order can only be cash on delivery.'
        : 'WhatsApp payments need a phone number, so this order can only be cash on delivery.',
    );
  }

  const order = buildOrder(ctx, bill, 'prepaid', address);
  const book = new OrderBook(ctx.kv);
  book.save(order);
  const catalog = await storefront(ctx);
  const fromCatalog = catalog !== null && bill.lines.every((line) => catalog.skus.has(line.product.sku));

  let payment: PaymentOrder;
  try {
    payment = await ctx.api.payments.create(
      {
        to: phone,
        reference_id: order.id,
        body: `Order ${order.id} from ${BRAND.name}. Check the items and pay securely with any UPI app or card.`,
        footer: 'LazyApp demo store',
        header_image_url: order.lines[0]?.imageUrl ?? BRAND.banner,
        goods_type: 'physical-goods',
        ...(fromCatalog ? { catalog_id: catalog.catalogId } : { importer: BRAND.importer }),
        expires_in_minutes: PAYMENT_EXPIRY_MINUTES,
        items: bill.lines.map((line) => ({
          name: fit(lineLabel(line), 60),
          amount: line.product.pricePaise,
          quantity: line.qty,
          retailer_id: line.product.sku,
          image_url: line.product.imageUrl,
          ...(fromCatalog ? {} : { country_of_origin: 'India' }),
        })),
        ...(bill.shipping === 0
          ? {}
          : { shipping: { amount: bill.shipping, description: 'Standard delivery' } }),
        ...(bill.coupon === null
          ? {}
          : {
              discount: {
                amount: bill.discount,
                description: `Coupon ${bill.coupon.code}`,
                program_name: bill.coupon.code,
              },
            }),
        payment:
          payments.method === 'payment_gateway'
            ? { method: 'payment_gateway', configuration: payments.configuration }
            : { method: payments.method, gateway_account: payments.gatewayAccount },
        metadata: { demo: 'whatsapp-shop', order: order.id },
      },
      { idempotencyKey: ctx.idempotencyKey('payment') },
    );
  } catch (error) {
    if (!(error instanceof LazyAppError) || error.retryable) {
      throw error;
    }
    ctx.log.warn('payment request refused, offering cash on delivery', {
      code: error.code,
      status: error.status,
    });
    book.update(ctx.user.address, order.id, (stored) => ({ ...stored, status: 'cancelled' }));
    return askCodConfirmation(
      ctx,
      `WhatsApp could not create the payment request (${error.message}). You can still pay cash on delivery.`,
    );
  }

  book.update(ctx.user.address, order.id, (stored) => ({
    ...stored,
    paymentId: payment.id,
    nativeOrderStatus: payment.payment_method === 'payment_gateway',
  }));
  ctx.setState((state) => ({ ...state, step: 'awaiting_payment', checkoutOrderId: order.id }));
  if (payments.method !== 'payment_gateway') {
    await ctx.send.text(
      'In-WhatsApp checkout is not set up on this demo number, so the order above opens a secure payment link instead.',
    );
  }
}

/** `payment.captured`: the only place a prepaid order becomes real. */
export async function onPaymentCaptured(ctx: ShopCtx, payment: PaymentOrder): Promise<void> {
  const orderId = payment.metadata?.order ?? payment.reference_id;
  const book = new OrderBook(ctx.kv);
  const order = book.get(ctx.user.address, orderId);
  if (order === undefined || (order.status !== 'awaiting_payment' && order.status !== 'payment_failed')) {
    return;
  }
  const confirmed = book.update(ctx.user.address, orderId, (stored) => ({
    ...stored,
    status: 'confirmed',
    paymentId: payment.id,
  }));
  if (confirmed === undefined) {
    return;
  }
  if (confirmed.nativeOrderStatus) {
    // WhatsApp shows the order as paid only after the merchant moves it to "processing".
    try {
      await ctx.api.payments.updateStatus(
        payment.id,
        { status: 'processing', description: `Order ${orderId} confirmed. We are packing it.` },
        { idempotencyKey: ctx.idempotencyKey('order-status:processing') },
      );
    } catch (error) {
      ctx.log.warn('could not move the order to processing', { error });
    }
  }
  await orderConfirmed(ctx, confirmed);
}

export async function onPaymentFailed(ctx: ShopCtx, payment: PaymentOrder): Promise<void> {
  const orderId = payment.metadata?.order ?? payment.reference_id;
  const book = new OrderBook(ctx.kv);
  const order = book.get(ctx.user.address, orderId);
  if (order?.status !== 'awaiting_payment') {
    return;
  }
  book.update(ctx.user.address, orderId, (stored) => ({ ...stored, status: 'payment_failed' }));
  ctx.setState((state) => ({ ...state, step: 'payment', checkoutOrderId: null }));
  await ctx.send.buttons({
    body: `Your payment for order ${orderId} didn't go through${payment.last_error === null || payment.last_error === undefined ? '' : ` (${payment.last_error})`}. No money was taken. Try again, or pay cash on delivery.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'pay:prepaid', title: 'Try again' },
      { id: 'pay:cod', title: 'Cash on delivery' },
    ],
  });
}

// --- Shared -----------------------------------------------------------------------------

function buildOrder(ctx: ShopCtx, bill: Quote, payment: PaymentChoice, address: DeliveryAddress): Order {
  const slot = ctx.state.slot ?? { id: 'unscheduled', label: 'Next available slot' };
  const id = orderIdFrom(ctx.idempotencyKey('order'));
  return {
    id,
    customer: ctx.user.address,
    createdAt: ctx.now().toISOString(),
    lines: bill.lines.map((line) => ({
      sku: line.product.sku,
      name: line.product.name,
      size: line.size,
      qty: line.qty,
      unitPaise: line.product.pricePaise,
      imageUrl: line.product.imageUrl,
    })),
    subtotal: bill.subtotal,
    shipping: bill.shipping,
    discount: bill.discount,
    coupon: bill.coupon?.code ?? null,
    codFee: bill.codFee,
    total: bill.total,
    payment,
    paymentId: null,
    nativeOrderStatus: false,
    status: payment === 'cod' ? 'confirmed' : 'awaiting_payment',
    address,
    slot,
    awb: awbFor(id),
    deliveredAt: null,
    rating: null,
    reviewWamid: null,
    returnRequest: null,
  };
}

/** The receipt: one rich message, then housekeeping (reminder, CRM event). */
async function orderConfirmed(ctx: ShopCtx, order: Order): Promise<void> {
  ctx.setState((state) => ({
    ...state,
    step: 'browsing',
    cart: [],
    coupon: null,
    slot: null,
    checkoutOrderId: null,
  }));
  await ctx.followUps.cancel(CART_REMINDER_KEY);
  await ctx.send.react('✅');
  await ctx.send.buttons({
    header: { image: order.lines[0]?.imageUrl ?? BRAND.banner },
    body: [
      `*Order ${order.id} confirmed* 🎉`,
      '',
      ...order.lines.map(
        (line) =>
          `• ${line.qty} × ${line.size === null ? line.name : `${line.name} (${line.size})`} — ${formatInr(line.unitPaise * line.qty)}`,
      ),
      '',
      ...(order.discount === 0 ? [] : [`Coupon ${order.coupon ?? ''}: −${formatInr(order.discount)}`]),
      ...(order.shipping === 0 ? [] : [`Shipping: ${formatInr(order.shipping)}`]),
      ...(order.codFee === 0 ? [] : [`COD fee: ${formatInr(order.codFee)}`]),
      order.payment === 'prepaid'
        ? `*Paid: ${formatInr(order.total)}*`
        : `*To pay on delivery: ${formatInr(order.total)}*`,
      '',
      `🚚 ${order.slot.label}`,
      `📍 ${formatAddress(order.address)}`,
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: `track:${order.id}`, title: 'Track order' },
      { id: 'home:browse', title: 'Shop more' },
      { id: 'menu:orders', title: 'My orders' },
    ],
  });
  await recordPurchase(ctx);
}

/**
 * CRM: tag the contact so the purchase shows up in LazyApp segments. Not `POST /v1/events`: that
 * endpoint always sends the event's mapped template, which here would be a second, paid "order
 * placed" message on top of the confirmation already in the chat.
 */
async function recordPurchase(ctx: ShopCtx): Promise<void> {
  if (ctx.user.contactUuid === null) {
    return;
  }
  try {
    await ctx.api.contacts.addTags(ctx.user.contactUuid, ['demo-shop-customer'], {
      idempotencyKey: ctx.idempotencyKey('tag:customer'),
    });
  } catch (error) {
    ctx.log.warn('could not tag the customer in LazyApp', { error });
  }
}
