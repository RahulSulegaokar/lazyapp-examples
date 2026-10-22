import { DEMO_FOOTER, formatInr } from '@lazyapp-examples/demo-kit';
import type { OrderItem } from '@lazyapp-examples/demo-kit';
import { findProduct } from './catalog.js';
import { TEMPLATES } from './manifest.js';
import { billText, findCoupon, FREE_SHIPPING_FROM, lineLabel, quote } from './pricing.js';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from './state.js';
import type { CartLine } from './state.js';
import { nudge } from './views.js';
import type { ShopCtx } from './views.js';

const SIZE_GUIDE: Readonly<Record<string, string>> = {
  XS: 'Chest 32 in · waist 26 in',
  S: 'Chest 34 in · waist 28 in',
  M: 'Chest 36 in · waist 30 in',
  L: 'Chest 38 in · waist 32 in',
  XL: 'Chest 40 in · waist 34 in',
  XXL: 'Chest 42 in · waist 36 in',
};

export const CART_REMINDER_KEY = 'cart-reminder';
const REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const MARKETING_CONSENT =
  'Yes, send me cart reminders and offers from Indigo Loom on WhatsApp. I can reply STOP at any time.';

/** Adds one unit. Sized products ask for the size first. */
export async function addToCart(ctx: ShopCtx, sku: string): Promise<void> {
  const product = findProduct(sku);
  if (product === undefined) {
    return nudge(ctx, 'That product is no longer available.');
  }
  const cart = ctx.state.cart;
  const existing = cart.findIndex((line) => line.sku === sku && line.size === null);
  if (product.sizes.length === 0 && existing !== -1) {
    return changeQuantity(ctx, existing, 1);
  }
  if (cart.length >= MAX_CART_LINES) {
    return nudge(
      ctx,
      `Your cart is full (${MAX_CART_LINES} different items). Check out or remove something first.`,
    );
  }
  const lines = [...cart, { sku, size: null, qty: 1 }];
  ctx.setState((state) => ({ ...state, cart: lines }));
  if (product.sizes.length > 0) {
    return askSize(ctx, lines.length - 1);
  }
  await ctx.send.react('🛍️');
  await added(ctx, `Added *${product.name}* to your cart.`);
}

/** Merges a cart sent from the WhatsApp catalog into the shop cart. */
export async function mergeCatalogOrder(ctx: ShopCtx, items: readonly OrderItem[]): Promise<void> {
  let cart: CartLine[] = [...ctx.state.cart];
  const unknown: string[] = [];
  for (const item of items) {
    if (findProduct(item.retailerId) === undefined) {
      unknown.push(item.retailerId);
      continue;
    }
    const index = cart.findIndex((line) => line.sku === item.retailerId && line.size === null);
    if (index === -1 && cart.length < MAX_CART_LINES) {
      cart = [...cart, { sku: item.retailerId, size: null, qty: Math.min(item.quantity, MAX_LINE_QUANTITY) }];
    } else if (index !== -1) {
      cart = cart.map((line, at) =>
        at === index ? { ...line, qty: Math.min(line.qty + item.quantity, MAX_LINE_QUANTITY) } : line,
      );
    }
  }
  ctx.setState((state) => ({ ...state, cart }));
  if (unknown.length > 0) {
    ctx.log.warn('catalog order had products outside the shop', { unknown });
  }
  await ctx.send.react('🛒');
  const missing = firstMissingSize(cart);
  if (missing !== null) {
    return askSize(ctx, missing);
  }
  await showCart(ctx);
}

/** Index of the first sized line without a size, if any. */
export function firstMissingSize(cart: readonly CartLine[]): number | null {
  const index = cart.findIndex(
    (line) => line.size === null && (findProduct(line.sku)?.sizes.length ?? 0) > 0,
  );
  return index === -1 ? null : index;
}

export async function askSize(ctx: ShopCtx, index: number): Promise<void> {
  const line = ctx.state.cart[index];
  const product = line === undefined ? undefined : findProduct(line.sku);
  if (product === undefined) {
    return showCart(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'choosing_size', activeLine: index }));
  await ctx.send.list({
    header: 'Pick a size',
    body: `Which size for *${product.name}*? Free exchange if it doesn't fit.`,
    button: 'Choose size',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Sizes',
        rows: product.sizes.map((size) => ({
          id: `size:${size}`,
          title: size,
          ...(SIZE_GUIDE[size] === undefined ? {} : { description: SIZE_GUIDE[size] }),
        })),
      },
    ],
  });
}

export async function chooseSize(ctx: ShopCtx, size: string): Promise<void> {
  const index = ctx.state.activeLine;
  const line = index === null ? undefined : ctx.state.cart[index];
  const product = line === undefined ? undefined : findProduct(line.sku);
  if (index === null || line === undefined || !product?.sizes.includes(size)) {
    return showCart(ctx);
  }
  const duplicate = ctx.state.cart.findIndex(
    (other, at) => at !== index && other.sku === line.sku && other.size === size,
  );
  const cart =
    duplicate === -1
      ? ctx.state.cart.map((entry, at) => (at === index ? { ...entry, size } : entry))
      : ctx.state.cart
          .map((entry, at) =>
            at === duplicate ? { ...entry, qty: Math.min(entry.qty + line.qty, MAX_LINE_QUANTITY) } : entry,
          )
          .filter((_entry, at) => at !== index);
  ctx.setState((state) => ({ ...state, cart, step: 'browsing', activeLine: null }));
  const missing = firstMissingSize(cart);
  if (missing !== null) {
    return askSize(ctx, missing);
  }
  await ctx.send.react('🛍️');
  await added(ctx, `Added *${product.name}* in size *${size}*.`);
}

async function added(ctx: ShopCtx, message: string): Promise<void> {
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: null });
  const freeShippingGap = FREE_SHIPPING_FROM - bill.subtotal;
  await ctx.send.buttons({
    body: [
      message,
      `Cart: ${bill.itemCount} item${bill.itemCount === 1 ? '' : 's'} · ${formatInr(bill.subtotal)}`,
      freeShippingGap > 0 ? `Add ${formatInr(freeShippingGap)} more for free shipping.` : 'Shipping is free.',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'checkout', title: 'Checkout' },
      { id: 'cart:view', title: 'View cart' },
      { id: 'home:browse', title: 'Keep shopping' },
    ],
  });
}

export async function showCart(ctx: ShopCtx, intro?: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'browsing', activeLine: null }));
  const bill = quote(ctx.state.cart, { couponCode: ctx.state.coupon, payment: null });
  if (bill.lines.length === 0) {
    await ctx.send.buttons({
      body: `${intro ?? ''}${intro === undefined ? '' : '\n\n'}Your cart is empty. Let's fix that.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: 'home:browse', title: 'Shop collections' },
        { id: 'home:deals', title: "Today's deals" },
      ],
    });
    return;
  }
  // Opted-in shoppers get the reminder offered elsewhere; keep the third button useful.
  const optedIn = ctx.session.marketingOptIn;
  await ctx.send.buttons({
    header: '🛒 Your cart',
    body: [
      ...(intro === undefined ? [] : [intro, '']),
      billText(bill),
      ...(bill.couponNote === null ? [] : ['', `_${bill.couponNote}_`]),
      ...(bill.coupon === null && ctx.state.coupon === null ? ['', 'Have a coupon? Type it here.'] : []),
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'checkout', title: 'Checkout' },
      { id: 'cart:edit', title: 'Edit cart' },
      optedIn
        ? { id: 'home:browse', title: 'Keep shopping' }
        : { id: 'cart:remind', title: 'Remind me later' },
    ],
  });
}

export async function editCart(ctx: ShopCtx): Promise<void> {
  const bill = quote(ctx.state.cart, { couponCode: null, payment: null });
  if (bill.lines.length === 0) {
    return showCart(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'editing_cart' }));
  await ctx.send.list({
    body: 'Which item do you want to change?',
    button: 'Choose item',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'In your cart',
        rows: [
          ...ctx.state.cart.flatMap((line, index) => {
            const product = findProduct(line.sku);
            return product === undefined
              ? []
              : [
                  {
                    id: `cart:line:${index}`,
                    title: lineLabel({ product, size: line.size }),
                    description: `${line.qty} × ${formatInr(product.pricePaise)}`,
                  },
                ];
          }),
          { id: 'cart:clear', title: 'Empty the cart', description: 'Remove everything' },
        ],
      },
    ],
  });
}

export async function lineMenu(ctx: ShopCtx, index: number): Promise<void> {
  const line = ctx.state.cart[index];
  const product = line === undefined ? undefined : findProduct(line.sku);
  if (line === undefined || product === undefined) {
    return showCart(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'editing_cart', activeLine: index }));
  await ctx.send.buttons({
    body: `*${lineLabel({ product, size: line.size })}*\nQuantity: ${line.qty}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'cart:inc', title: 'Add one' },
      { id: 'cart:dec', title: 'Remove one' },
      { id: 'cart:remove', title: 'Remove item' },
    ],
  });
}

export async function changeQuantity(ctx: ShopCtx, index: number | null, delta: number): Promise<void> {
  const line = index === null ? undefined : ctx.state.cart[index];
  if (index === null || line === undefined) {
    return showCart(ctx);
  }
  const qty = line.qty + delta;
  if (qty > MAX_LINE_QUANTITY) {
    return showCart(ctx, `You can order up to ${MAX_LINE_QUANTITY} of one item.`);
  }
  const cart =
    qty <= 0
      ? ctx.state.cart.filter((_line, at) => at !== index)
      : ctx.state.cart.map((entry, at) => (at === index ? { ...entry, qty } : entry));
  ctx.setState((state) => ({ ...state, cart }));
  await showCart(ctx, qty <= 0 ? 'Removed.' : 'Updated.');
}

export async function clearCart(ctx: ShopCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, cart: [], coupon: null }));
  await ctx.followUps.cancel(CART_REMINDER_KEY);
  await showCart(ctx);
}

/** A coupon typed in the chat. */
export async function applyCoupon(ctx: ShopCtx, code: string): Promise<void> {
  const coupon = findCoupon(code);
  if (coupon === undefined) {
    return showCart(ctx, `*${code.toUpperCase()}* is not a valid coupon.`);
  }
  ctx.setState((state) => ({ ...state, coupon: coupon.code }));
  const bill = quote(ctx.state.cart, { couponCode: coupon.code, payment: null });
  await showCart(
    ctx,
    bill.coupon === null
      ? `*${coupon.code}* is saved: ${coupon.label}. It applies once your cart qualifies.`
      : `*${coupon.code}* applied: you save ${formatInr(bill.discount)}.`,
  );
}

/** Step 1 of the abandoned-cart reminder: ask, because it is a marketing message. */
export async function offerReminder(ctx: ShopCtx): Promise<void> {
  if (ctx.state.cart.length === 0) {
    return showCart(ctx);
  }
  if (ctx.session.marketingOptIn) {
    return scheduleReminder(ctx);
  }
  await ctx.send.buttons({
    body: `I can remind you about your cart in 3 hours.\n\nTapping *Yes* means: "${MARKETING_CONSENT}"`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'remind:yes', title: 'Yes, remind me' },
      { id: 'cart:view', title: 'No thanks' },
    ],
  });
}

/** Step 2: the shopper tapped "Yes": record consent, then schedule the approved template. */
export async function acceptReminder(ctx: ShopCtx): Promise<void> {
  if (ctx.state.cart.length === 0) {
    return showCart(ctx);
  }
  await ctx.consent.optInToMarketing(MARKETING_CONSENT);
  await scheduleReminder(ctx);
}

async function scheduleReminder(ctx: ShopCtx): Promise<void> {
  const bill = quote(ctx.state.cart, { couponCode: null, payment: null });
  const [first] = bill.lines;
  if (first === undefined) {
    return showCart(ctx);
  }
  const rest = bill.lines.length - 1;
  const summary = rest === 0 ? first.product.name : `${first.product.name} and ${rest} more`;
  await ctx.followUps.schedule({
    key: CART_REMINDER_KEY,
    category: 'marketing',
    sendAt: new Date(ctx.now().getTime() + REMINDER_DELAY_MS),
    template: {
      name: TEMPLATES.cartReminder,
      language: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: ctx.user.displayName ?? 'there' },
            { type: 'text', text: summary },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: 'cart:view' }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: 'offers:optout' }],
        },
      ],
    },
  });
  await ctx.send.buttons({
    body: 'Done: I will remind you in 3 hours. Checking out (or typing EXIT) cancels the reminder.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'checkout', title: 'Checkout now' },
      { id: 'home:browse', title: 'Keep shopping' },
    ],
  });
}

/** "Stop reminders" on the template, or STOP-like intent: withdraw consent and cancel. */
export async function stopReminders(ctx: ShopCtx): Promise<void> {
  await ctx.consent.optOutOfMarketing();
  await ctx.followUps.cancel(CART_REMINDER_KEY);
  await nudge(ctx, 'Done: no more reminders or offers. Your cart is still here if you need it.');
}
