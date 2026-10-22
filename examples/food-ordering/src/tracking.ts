import { DEMO_FOOTER, formatInr } from '@lazyapp-examples/demo-kit';
import type { OrderStatus as WhatsAppOrderStatus } from '@lazyapp-examples/sdk';
import { BRAND, findOutlet } from './kitchen.js';
import { FoodOrderBook, isFinished, journey, nextStatus, STATUS_LABEL } from './orders.js';
import type { FoodOrder, OrderStatus } from './orders.js';
import { cartView, startOrder } from './ordering.js';
import { review } from './checkout.js';
import { LoyaltyLedger, pointsEarned } from './pricing.js';
import { instantLabel, isKitchenOpen } from './schedule.js';
import { nudge } from './views.js';
import type { FoodCtx } from './views.js';

const RIDER = { name: 'Ravi Kumar', phone: '+919900112233', vehicle: 'KA 01 HX 4821' } as const;
const CHEF = 'Chef Imran';
const DEMO_KITCHEN_FOOTER = 'Demo: ⏩ simulates the kitchen · MENU · EXIT';
/** Goodwill for a bad meal: 200 points (₹100) and an apology. */
const SORRY_POINTS = 200;

const NATIVE_STATUS: Partial<Record<OrderStatus, Exclude<WhatsAppOrderStatus, 'pending'>>> = {
  out_for_delivery: 'shipped',
  delivered: 'completed',
  picked_up: 'completed',
};

function timeline(order: FoodOrder): string {
  const steps = journey(order);
  const reached = steps.indexOf(order.status);
  return steps
    .map(
      (status, index) =>
        `${index < reached ? '✅' : index === reached ? '🟢' : '⚪'} ${STATUS_LABEL[status]}`,
    )
    .join('\n');
}

export async function track(ctx: FoodCtx, id: string): Promise<void> {
  const book = new FoodOrderBook(ctx.kv);
  const order = id === 'latest' ? book.latest(ctx.user.address) : book.get(ctx.user.address, id);
  if (order === undefined) {
    return nudge(ctx, 'You have no orders yet. Hungry?');
  }
  const outlet = findOutlet(order.outletId);
  await ctx.send.buttons({
    body: [
      `*Order ${order.id}* · Masala Mile ${outlet?.name ?? ''}`,
      '',
      timeline(order),
      '',
      isFinished(order) ? '' : `🕒 Expected by ${instantLabel(new Date(order.dueAt), ctx.now())}`,
    ]
      .join('\n')
      .trim(),
    footer: DEMO_KITCHEN_FOOTER,
    buttons: isFinished(order)
      ? [
          { id: `reorder:${order.id}`, title: 'Order this again' },
          { id: 'home:more', title: 'More options' },
        ]
      : [
          { id: `kitchen:${order.id}`, title: '⏩ Kitchen update' },
          { id: 'home:more', title: 'More options' },
        ],
  });
}

/**
 * There is no real kitchen behind the demo, so the customer drives it: each tap
 * moves the order one step and sends exactly what a real kitchen would.
 */
export async function advance(ctx: FoodCtx, id: string): Promise<void> {
  const book = new FoodOrderBook(ctx.kv);
  const order = book.get(ctx.user.address, id);
  const next = order === undefined ? null : nextStatus(order);
  if (order === undefined || next === null) {
    return track(ctx, id);
  }
  const updated = book.update(ctx.user.address, id, (stored) => ({ ...stored, status: next }));
  if (updated === undefined) {
    return;
  }
  await syncWhatsAppOrderStatus(ctx, updated);
  const outlet = findOutlet(updated.outletId);
  const due = instantLabel(new Date(updated.dueAt), ctx.now());
  switch (next) {
    case 'accepted':
      return step(
        ctx,
        updated,
        `👨‍🍳 *Accepted!* Masala Mile ${outlet?.name ?? ''} has your order${updated.scheduled ? ` and will start cooking 30 minutes before ${due}` : `. Expected by ${due}`}.`,
      );
    case 'preparing':
      return step(
        ctx,
        updated,
        `🔥 *On the stove.* ${CHEF} is ${updated.lines.some((line) => line.itemId.includes('biryani')) ? 'sealing your biryani handi with dough' : 'cooking your order'}.`,
      );
    case 'ready':
      if (outlet !== undefined) {
        await ctx.send.location({
          latitude: outlet.latitude,
          longitude: outlet.longitude,
          name: `Masala Mile ${outlet.name}`,
          address: outlet.address,
        });
      }
      return step(
        ctx,
        updated,
        `🛍️ *Ready for pickup!* Show code *${updated.pickupCode}* at the counter${updated.payment === 'cod' ? ` and pay ${formatInr(updated.total)}` : ''}.`,
      );
    case 'out_for_delivery':
      return outForDelivery(ctx, updated);
    case 'delivered':
    case 'picked_up':
      return finished(ctx, updated);
    default:
      return track(ctx, id);
  }
}

async function step(ctx: FoodCtx, order: FoodOrder, body: string): Promise<void> {
  const next = nextStatus(order);
  await ctx.send.buttons({
    body,
    footer: DEMO_KITCHEN_FOOTER,
    buttons: [
      ...(next === null ? [] : [{ id: `kitchen:${order.id}`, title: `⏩ ${shortLabel(next)}` }]),
      { id: `track:${order.id}`, title: 'Track order' },
    ],
  });
}

function shortLabel(status: OrderStatus): string {
  const labels: Partial<Record<OrderStatus, string>> = {
    accepted: 'Accepted',
    preparing: 'Cooking',
    ready: 'Ready',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    picked_up: 'Picked up',
  };
  return labels[status] ?? STATUS_LABEL[status];
}

/** Rider card, the rider's live position as a location pin, and what to pay. */
async function outForDelivery(ctx: FoodCtx, order: FoodOrder): Promise<void> {
  const outlet = findOutlet(order.outletId);
  await ctx.send.contacts([
    {
      name: { formatted_name: `${RIDER.name} (Masala Mile rider)`, first_name: RIDER.name },
      phones: [{ phone: RIDER.phone, type: 'CELL' }],
      org: { company: BRAND.name, title: 'Delivery rider' },
    },
  ]);
  if (outlet !== undefined && order.drop !== null) {
    // 70% of the way from the kitchen to the customer.
    await ctx.send.location({
      latitude: outlet.latitude + (order.drop.latitude - outlet.latitude) * 0.7,
      longitude: outlet.longitude + (order.drop.longitude - outlet.longitude) * 0.7,
      name: `${RIDER.name} is here`,
      address: `Scooter ${RIDER.vehicle} · about 8 minutes away`,
    });
  }
  await step(
    ctx,
    order,
    [
      `🛵 *On the way!* ${RIDER.name} picked up order ${order.id}. His card and live position are above.`,
      order.payment === 'cod'
        ? `Please keep *${formatInr(order.total)}* ready: cash, or UPI to the rider.`
        : 'Already paid: nothing to pay at the door.',
    ].join('\n'),
  );
}

async function finished(ctx: FoodCtx, order: FoodOrder): Promise<void> {
  const earned = pointsEarned(order.subtotal);
  const ledger = new LoyaltyLedger(ctx.kv).add(ctx.user.address, earned, `Earned on ${order.id}`, ctx.now());
  const message = await ctx.send.list({
    header: order.status === 'picked_up' ? 'Enjoy your meal! 🍛' : 'Delivered! Enjoy 🍛',
    body: `You earned *${earned} Club points* (balance ${ledger.points}).\n\nHow was it? Pick a rating, or just react to this message with an emoji.`,
    button: 'Rate your meal',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Your rating',
        rows: [
          { id: `rate:${order.id}:5`, title: '⭐⭐⭐⭐⭐', description: 'Loved it' },
          { id: `rate:${order.id}:4`, title: '⭐⭐⭐⭐', description: 'Really good' },
          { id: `rate:${order.id}:3`, title: '⭐⭐⭐', description: 'It was okay' },
          { id: `rate:${order.id}:2`, title: '⭐⭐', description: 'Not great' },
          { id: `rate:${order.id}:1`, title: '⭐', description: 'Disappointing' },
        ],
      },
    ],
  });
  new FoodOrderBook(ctx.kv).update(ctx.user.address, order.id, (stored) => ({
    ...stored,
    reviewWamid: message.provider_message_id ?? null,
  }));
}

async function syncWhatsAppOrderStatus(ctx: FoodCtx, order: FoodOrder): Promise<void> {
  const status = NATIVE_STATUS[order.status];
  if (!order.nativeOrderStatus || order.paymentId === null || status === undefined) {
    return;
  }
  try {
    await ctx.api.payments.updateStatus(
      order.paymentId,
      { status, description: status === 'shipped' ? `${RIDER.name} is on the way` : 'Enjoy your meal!' },
      { idempotencyKey: ctx.idempotencyKey(`order-status:${status}`) },
    );
  } catch (error) {
    ctx.log.warn('order status update refused', { error, status });
  }
}

const REACTION_RATINGS: Readonly<Record<string, number>> = {
  '😍': 5,
  '🤤': 5,
  '😋': 5,
  '❤️': 5,
  '🔥': 5,
  '👏': 5,
  '👍': 4,
  '🙂': 4,
  '😊': 4,
  '😐': 3,
  '😕': 2,
  '👎': 2,
  '🤢': 1,
  '😡': 1,
  '😠': 1,
};

export async function onReaction(ctx: FoodCtx, emoji: string | null, target: string | null): Promise<void> {
  if (emoji === null || target === null) {
    return;
  }
  const order = new FoodOrderBook(ctx.kv)
    .list(ctx.user.address)
    .find((entry) => entry.reviewWamid === target);
  if (order === undefined) {
    return;
  }
  const rating = REACTION_RATINGS[emoji];
  if (rating === undefined) {
    await ctx.send.text(`Thanks for the ${emoji}! Pick stars from the list if you'd like to tell us more.`);
    return;
  }
  await rate(ctx, order.id, rating);
}

export async function rate(ctx: FoodCtx, id: string, rating: number): Promise<void> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return track(ctx, id);
  }
  const order = new FoodOrderBook(ctx.kv).update(ctx.user.address, id, (stored) => ({ ...stored, rating }));
  if (order === undefined) {
    return track(ctx, 'latest');
  }
  if (rating <= 2) {
    const ledger = new LoyaltyLedger(ctx.kv).add(
      ctx.user.address,
      SORRY_POINTS,
      `Sorry about ${id}`,
      ctx.now(),
    );
    if (ctx.user.contactUuid !== null) {
      try {
        await ctx.api.contacts.addTags(ctx.user.contactUuid, ['demo-food-feedback']);
      } catch (error) {
        ctx.log.warn('could not tag the contact', { error });
      }
    }
    await ctx.send.buttons({
      body: `I'm sorry order ${id} wasn't right. Our kitchen manager will call you today, and we've added *${SORRY_POINTS} points* (₹100) to your Club balance (${ledger.points} now).`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: 'support', title: 'Talk to us now' },
        { id: 'home:more', title: 'More options' },
      ],
    });
    return;
  }
  await ctx.send.buttons({
    body: `Thank you for the ${'⭐'.repeat(rating)}! ${CHEF} says thanks too.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `reorder:${id}`, title: 'Order this again' },
      { id: 'table:start', title: 'Book a table' },
    ],
  });
}

/** "Reorder last meal": same dishes, kitchen and address, straight to the bill. */
export async function reorder(ctx: FoodCtx, id: string): Promise<void> {
  const book = new FoodOrderBook(ctx.kv);
  const order = id === 'last' ? book.latest(ctx.user.address) : book.get(ctx.user.address, id);
  if (order === undefined) {
    return startOrder(ctx, "You haven't ordered yet, so there's nothing to repeat. Let's fix that!");
  }
  ctx.setState((state) => ({
    ...state,
    cart: order.lines.map(({ label: _label, unitPaise: _unit, ...line }) => line),
    outletId: order.outletId,
    mode: order.mode,
    drop: order.drop === null ? state.drop : { ...order.drop, name: state.drop?.name ?? null },
    schedule: isKitchenOpen(ctx.now()) ? { kind: 'asap' } : null,
    usePoints: false,
  }));
  if (order.mode === 'delivery' && order.drop === null) {
    return startOrder(ctx, 'Same order coming up. Where should we deliver it?');
  }
  if (!isKitchenOpen(ctx.now())) {
    return cartView(
      ctx,
      'Your last meal is in the cart. The kitchens are closed now, so pick a time at checkout.',
    );
  }
  await review(ctx);
}

export async function club(ctx: FoodCtx): Promise<void> {
  const ledger = new LoyaltyLedger(ctx.kv).get(ctx.user.address, ctx.now());
  await ctx.send.buttons({
    header: '🎁 Masala Mile Club',
    body: [
      `You have *${ledger.points} points* (worth ${formatInr(ledger.points * 50)}).`,
      '',
      ...ledger.history
        .slice(0, 5)
        .map((entry) => `${entry.delta > 0 ? '+' : ''}${entry.delta} · ${entry.reason}`),
      '',
      'Earn 1 point for every ₹10. Use 100 or more at checkout, up to half the bill.',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'order:start', title: 'Order food' },
      { id: 'home:more', title: 'More options' },
    ],
  });
}

export async function talkToUs(ctx: FoodCtx): Promise<void> {
  if (ctx.user.contactUuid !== null) {
    try {
      await ctx.api.contacts.addTags(ctx.user.contactUuid, ['demo-food-support']);
    } catch (error) {
      ctx.log.warn('could not tag the contact', { error });
    }
  }
  await ctx.send.contacts([
    {
      name: { formatted_name: `${BRAND.name} help desk`, first_name: BRAND.name, last_name: 'Help desk' },
      phones: [{ phone: BRAND.phone, type: 'WORK' }],
      org: { company: BRAND.name, title: 'Customer care' },
    },
  ]);
  await nudge(
    ctx,
    'A person from our team will reply right here within a few minutes (11 am – 11 pm). You can also call the number on the card above.\n\n_Demo: this chat is now tagged demo-food-support in the LazyApp inbox._',
  );
}
