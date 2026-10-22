import { DEMO_FOOTER, formatInr } from '@lazyapp-examples/demo-kit';
import type { OrderStatus as WhatsAppOrderStatus } from '@lazyapp-examples/sdk';
import { BRAND } from './catalog.js';
import { showCart } from './cart.js';
import { deliverySlots, findSlot } from './delivery.js';
import { FULFILMENT, nextStatus, OrderBook, RETURN_WINDOW_MS, STATUS_LABEL } from './orders.js';
import type { Order, OrderStatus } from './orders.js';
import { MAX_CART_LINES } from './state.js';
import { nudge } from './views.js';
import type { ShopCtx } from './views.js';

/** Courier tracking page; `{awb}` is replaced. Point it at your carrier. */
export const TRACKING_URL = 'https://www.shiprocket.in/shipment-tracking/?awb={awb}';

const COURIER = { name: 'Sunil Kumar', company: 'BlueRoute Express', phone: '+919845012345' } as const;

/** Which WhatsApp order status a fulfilment step maps to (only for in-WhatsApp payments). */
const NATIVE_STATUS: Partial<Record<OrderStatus, Exclude<WhatsAppOrderStatus, 'pending'>>> = {
  shipped: 'shipped',
  delivered: 'completed',
};

function orderFor(ctx: ShopCtx, id: string): Order | undefined {
  return new OrderBook(ctx.kv).get(ctx.user.address, id);
}

function timeline(order: Order): string {
  const reached = FULFILMENT.indexOf(order.status);
  return FULFILMENT.map((status, index) => {
    const mark = index < reached ? '✅' : index === reached ? '🟢' : '⚪';
    return `${mark} ${STATUS_LABEL[status]}`;
  }).join('\n');
}

function itemsSummary(order: Order): string {
  const count = order.lines.reduce((sum, line) => sum + line.qty, 0);
  const first = order.lines[0]?.name ?? 'items';
  return count === 1 ? first : `${first} + ${count - 1} more`;
}

export async function listOrders(ctx: ShopCtx, mode: 'all' | 'returns'): Promise<void> {
  const now = ctx.now().getTime();
  const orders = new OrderBook(ctx.kv)
    .list(ctx.user.address)
    .filter((order) => mode === 'all' || isReturnable(order, now))
    .slice(0, 10);
  if (orders.length === 0) {
    return nudge(
      ctx,
      mode === 'all'
        ? 'You have no orders yet. Your first one ships free above ₹1,499.'
        : 'No delivered orders from the last 7 days. (In this demo, place an order and tap ⏩ until it is delivered.)',
    );
  }
  await ctx.send.list({
    header: mode === 'all' ? 'My orders' : 'Returns & exchanges',
    body: mode === 'all' ? 'Pick an order to track, reorder or rate it.' : 'Which order is it about?',
    button: 'See orders',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Recent orders',
        rows: orders.map((order) => ({
          id: mode === 'all' ? `order:${order.id}` : `return:${order.id}`,
          title: `${order.id} · ${formatInr(order.total)}`,
          description: `${STATUS_LABEL[order.status]} · ${itemsSummary(order)}`,
        })),
      },
    ],
  });
}

export async function orderDetail(ctx: ShopCtx, id: string): Promise<void> {
  const order = orderFor(ctx, id);
  if (order === undefined) {
    return listOrders(ctx, 'all');
  }
  const returnable = isReturnable(order, ctx.now().getTime());
  await ctx.send.buttons({
    header: { image: order.lines[0]?.imageUrl ?? BRAND.banner },
    body: [
      `*Order ${order.id}* · ${STATUS_LABEL[order.status]}`,
      ...order.lines.map(
        (line) => `• ${line.qty} × ${line.size === null ? line.name : `${line.name} (${line.size})`}`,
      ),
      `Total ${formatInr(order.total)} · ${order.payment === 'prepaid' ? 'paid online' : 'cash on delivery'}`,
      ...(order.returnRequest === null
        ? []
        : [`Return: ${order.returnRequest.kind}, pickup ${order.returnRequest.pickupDate}`]),
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      returnable && order.returnRequest === null
        ? { id: `return:${order.id}`, title: 'Return / exchange' }
        : { id: `track:${order.id}`, title: 'Track order' },
      { id: `reorder:${order.id}`, title: 'Order again' },
      { id: 'menu:orders', title: 'All orders' },
    ],
  });
}

export function isReturnable(order: Order, now: number): boolean {
  return (
    order.status === 'delivered' &&
    order.deliveredAt !== null &&
    now - Date.parse(order.deliveredAt) <= RETURN_WINDOW_MS
  );
}

export async function track(ctx: ShopCtx, id: string): Promise<void> {
  const order = orderFor(ctx, id);
  if (order === undefined || !FULFILMENT.includes(order.status)) {
    return listOrders(ctx, 'all');
  }
  if (order.status === 'shipped' || order.status === 'out_for_delivery') {
    await ctx.send.cta({
      body: `*Order ${order.id}*\n\n${timeline(order)}\n\n${COURIER.company} · AWB ${order.awb}`,
      displayText: 'Track shipment',
      url: TRACKING_URL.replace('{awb}', order.awb),
      footer: DEMO_FOOTER,
    });
  }
  await updateButtons(
    ctx,
    order,
    order.status === 'shipped' || order.status === 'out_for_delivery'
      ? 'Want to see the next step?'
      : `*Order ${order.id}*\n\n${timeline(order)}\n\nDelivery: ${order.slot.label}`,
  );
}

/**
 * The demo has no warehouse, so the shopper plays the courier: each tap moves the
 * order one step and sends what a real store sends at that step.
 */
export async function advance(ctx: ShopCtx, id: string): Promise<void> {
  const book = new OrderBook(ctx.kv);
  const order = book.get(ctx.user.address, id);
  const next = order === undefined ? null : nextStatus(order.status);
  if (order === undefined || next === null) {
    return order === undefined ? listOrders(ctx, 'all') : orderDetail(ctx, id);
  }
  const updated = book.update(ctx.user.address, id, (stored) => ({
    ...stored,
    status: next,
    deliveredAt: next === 'delivered' ? ctx.now().toISOString() : stored.deliveredAt,
  }));
  if (updated === undefined) {
    return;
  }
  await syncWhatsAppOrderStatus(ctx, updated);
  switch (next) {
    case 'packed':
      return updateButtons(
        ctx,
        updated,
        `📦 *Packed!* Order ${id} is packed and waiting for ${COURIER.company}.`,
      );
    case 'shipped':
      await ctx.send.cta({
        body: `🚚 *Shipped!* Order ${id} is on its way with ${COURIER.company}.\nAWB ${updated.awb} · arriving ${updated.slot.label}.`,
        displayText: 'Track shipment',
        url: TRACKING_URL.replace('{awb}', updated.awb),
        footer: DEMO_FOOTER,
      });
      return updateButtons(ctx, updated, 'Tap ⏩ when you want the courier to head out.');
    case 'out_for_delivery':
      return outForDelivery(ctx, updated);
    case 'delivered':
      return delivered(ctx, updated);
    default:
      return orderDetail(ctx, id);
  }
}

async function outForDelivery(ctx: ShopCtx, order: Order): Promise<void> {
  await ctx.send.contacts([
    {
      name: { formatted_name: `${COURIER.name} (${COURIER.company})`, first_name: COURIER.name },
      phones: [{ phone: COURIER.phone, type: 'WORK' }],
      org: { company: COURIER.company, title: 'Delivery partner' },
    },
  ]);
  await ctx.send.buttons({
    body: [
      `🛵 *Out for delivery!* ${COURIER.name} is bringing order ${order.id} today (${order.slot.label}). His contact card is above.`,
      order.payment === 'cod'
        ? `Please keep *${formatInr(order.total)}* ready: cash or UPI to the courier.`
        : 'Already paid: nothing to pay at the door.',
      '',
      'Will you be available?',
    ].join('\n'),
    footer: 'Demo: ⏩ simulates the courier · MENU · EXIT',
    buttons: [
      { id: `next:${order.id}`, title: "Yes, I'm home ⏩" },
      { id: `resched:${order.id}`, title: 'Reschedule' },
    ],
  });
}

async function delivered(ctx: ShopCtx, order: Order): Promise<void> {
  const message = await ctx.send.list({
    header: 'Delivered 🎉',
    body: `Order ${order.id} was delivered. How did we do?\n\nPick a rating, or simply react to this message with an emoji.`,
    button: 'Rate your order',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Your rating',
        rows: [
          { id: `rate:${order.id}:5`, title: '⭐⭐⭐⭐⭐', description: 'Loved it' },
          { id: `rate:${order.id}:4`, title: '⭐⭐⭐⭐', description: 'Really good' },
          { id: `rate:${order.id}:3`, title: '⭐⭐⭐', description: 'It was okay' },
          { id: `rate:${order.id}:2`, title: '⭐⭐', description: 'Not great' },
          { id: `rate:${order.id}:1`, title: '⭐', description: 'Disappointed' },
        ],
      },
    ],
  });
  new OrderBook(ctx.kv).update(ctx.user.address, order.id, (stored) => ({
    ...stored,
    reviewWamid: message.provider_message_id ?? null,
  }));
}

async function updateButtons(ctx: ShopCtx, order: Order, body: string): Promise<void> {
  const next = nextStatus(order.status);
  await ctx.send.buttons({
    body,
    footer: 'Demo: ⏩ simulates the courier · MENU · EXIT',
    buttons: [
      ...(next === null ? [] : [{ id: `next:${order.id}`, title: `⏩ ${STATUS_LABEL[next]}` }]),
      { id: `order:${order.id}`, title: 'Order details' },
      { id: 'home:browse', title: 'Shop more' },
    ],
  });
}

/** For in-WhatsApp payments, WhatsApp shows the order's status natively: keep it in step. */
async function syncWhatsAppOrderStatus(ctx: ShopCtx, order: Order): Promise<void> {
  const status = NATIVE_STATUS[order.status];
  if (!order.nativeOrderStatus || order.paymentId === null || status === undefined) {
    return;
  }
  try {
    await ctx.api.payments.updateStatus(
      order.paymentId,
      {
        status,
        description:
          status === 'shipped'
            ? `Shipped with ${COURIER.company}, AWB ${order.awb}`
            : 'Delivered. Thank you!',
      },
      { idempotencyKey: ctx.idempotencyKey(`order-status:${status}`) },
    );
  } catch (error) {
    ctx.log.warn('order status update refused', { error, status });
  }
}

export async function askReschedule(ctx: ShopCtx, id: string): Promise<void> {
  const order = orderFor(ctx, id);
  if (order?.status !== 'out_for_delivery') {
    return orderDetail(ctx, id);
  }
  await ctx.send.list({
    header: 'Reschedule delivery',
    body: 'No problem. When should the courier come back?',
    button: 'Choose slot',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Available slots',
        rows: deliverySlots(ctx.now()).map((slot) => ({
          id: `reslot:${id}:${slot.id}`,
          title: slot.label.split(', ')[0] ?? slot.label,
          description: slot.label,
        })),
      },
    ],
  });
}

export async function reschedule(ctx: ShopCtx, id: string, slotId: string): Promise<void> {
  const slot = findSlot(slotId, ctx.now());
  const book = new OrderBook(ctx.kv);
  const order = book.get(ctx.user.address, id);
  if (slot === undefined || order?.status !== 'out_for_delivery') {
    return orderDetail(ctx, id);
  }
  const updated = book.update(ctx.user.address, id, (stored) => ({ ...stored, slot, status: 'shipped' }));
  if (updated !== undefined) {
    await updateButtons(ctx, updated, `📅 Done: order ${id} will now arrive ${slot.label}.`);
  }
}

const REACTION_RATINGS: Readonly<Record<string, number>> = {
  '😍': 5,
  '🤩': 5,
  '❤️': 5,
  '🔥': 5,
  '🥰': 5,
  '👏': 5,
  '👍': 4,
  '😊': 4,
  '🙂': 4,
  '😐': 3,
  '🤔': 3,
  '😕': 2,
  '🙁': 2,
  '👎': 2,
  '😡': 1,
  '😠': 1,
  '😢': 1,
};

/** A reaction to the "Delivered" message is a rating. Reactions elsewhere are acknowledged quietly. */
export async function onReaction(
  ctx: ShopCtx,
  emoji: string | null,
  targetWamid: string | null,
): Promise<void> {
  if (emoji === null || targetWamid === null) {
    return;
  }
  const order = new OrderBook(ctx.kv)
    .list(ctx.user.address)
    .find((entry) => entry.reviewWamid === targetWamid);
  if (order === undefined) {
    return;
  }
  const rating = REACTION_RATINGS[emoji];
  if (rating === undefined) {
    await ctx.send.text(
      `Thanks for the ${emoji}! Pick a star rating from the list if you'd like to tell us more.`,
    );
    return;
  }
  await rate(ctx, order.id, rating);
}

export async function rate(ctx: ShopCtx, id: string, rating: number): Promise<void> {
  const book = new OrderBook(ctx.kv);
  const order = book.update(ctx.user.address, id, (stored) => ({ ...stored, rating }));
  if (order === undefined || rating < 1 || rating > 5) {
    return listOrders(ctx, 'all');
  }
  if (rating <= 2) {
    if (ctx.user.contactUuid !== null) {
      try {
        await ctx.api.contacts.addTags(ctx.user.contactUuid, ['demo-shop-unhappy']);
      } catch (error) {
        ctx.log.warn('could not tag the contact', { error });
      }
    }
    await ctx.send.buttons({
      body: `I'm sorry order ${id} let you down. A person from our care team will look into it. You can also return or exchange it for free within 7 days.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: `return:${id}`, title: 'Return / exchange' },
        { id: 'support', title: 'Talk to support' },
      ],
    });
    return;
  }
  await ctx.send.buttons({
    body: `Thank you for the ${'⭐'.repeat(rating)}! It helps a small Jaipur workshop more than you know.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `reorder:${id}`, title: 'Order again' },
      { id: 'home:deals', title: "Today's deals" },
    ],
  });
}

export async function reorder(ctx: ShopCtx, id: string): Promise<void> {
  const order = orderFor(ctx, id);
  if (order === undefined) {
    return listOrders(ctx, 'all');
  }
  const cart = [...ctx.state.cart];
  for (const line of order.lines) {
    const index = cart.findIndex((entry) => entry.sku === line.sku && entry.size === line.size);
    if (index !== -1) {
      const existing = cart[index];
      if (existing !== undefined) {
        cart[index] = { ...existing, qty: Math.min(existing.qty + line.qty, 10) };
      }
    } else if (cart.length < MAX_CART_LINES) {
      cart.push({ sku: line.sku, size: line.size, qty: line.qty });
    }
  }
  ctx.setState((state) => ({ ...state, cart }));
  await showCart(ctx, `Added everything from order ${id}, same sizes as last time.`);
}
