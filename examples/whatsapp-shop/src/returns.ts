import { DEMO_FOOTER, FlowUnavailableError, formatInr } from '@lazyapp-examples/demo-kit';
import type { FlowEndpointHandler, FlowExchangeResponse } from '@lazyapp-examples/demo-kit';
import { findProduct } from './catalog.js';
import { isReturnable, listOrders, orderDetail } from './fulfilment.js';
import { FLOWS } from './manifest.js';
import { OrderBook } from './orders.js';
import type { Order } from './orders.js';
import type { ShopState } from './state.js';
import { nudge } from './views.js';
import type { ShopCtx } from './views.js';

export const RETURN_REASONS = [
  { id: 'size', title: "Size doesn't fit" },
  { id: 'damaged', title: 'Arrived damaged' },
  { id: 'different', title: 'Looks different from photos' },
  { id: 'quality', title: 'Quality not as expected' },
  { id: 'changed', title: 'Changed my mind' },
] as const;

const NO_SIZE = { id: 'none', title: 'Not needed' } as const;

export interface ReturnInput {
  readonly item: string;
  readonly kind: string;
  readonly reason: string;
  readonly newSize: string | null;
}

export interface ReturnPlan {
  readonly sku: string;
  readonly kind: 'return' | 'exchange';
  readonly reason: string;
  readonly newSize: string | null;
  readonly refundPaise: number;
  readonly pickupDate: string;
  readonly summary: string;
  readonly outcome: string;
}

/** Validates a return request against the order. Pure: shared by the Flow endpoint and the button fallback. */
export function planReturn(
  order: Order,
  input: ReturnInput,
  now: Date,
): { ok: true; plan: ReturnPlan } | { ok: false; error: string } {
  if (!isReturnable(order, now.getTime())) {
    return { ok: false, error: 'This order is outside the 7-day return window.' };
  }
  const line = order.lines.find((entry) => entry.sku === input.item);
  if (line === undefined) {
    return { ok: false, error: 'Pick an item from this order.' };
  }
  if (input.kind !== 'return' && input.kind !== 'exchange') {
    return { ok: false, error: 'Choose a return or an exchange.' };
  }
  const reason = RETURN_REASONS.find((entry) => entry.id === input.reason);
  if (reason === undefined) {
    return { ok: false, error: 'Pick a reason.' };
  }
  const sizes = findProduct(line.sku)?.sizes ?? [];
  const newSize = input.newSize === null || input.newSize === NO_SIZE.id ? null : input.newSize;
  if (input.kind === 'exchange') {
    if (sizes.length === 0) {
      return { ok: false, error: `${line.name} comes in one size. Choose a return instead.` };
    }
    if (newSize === null || !sizes.includes(newSize) || newSize === line.size) {
      return { ok: false, error: 'For an exchange, pick a different size.' };
    }
  }
  const refundPaise = line.unitPaise * line.qty;
  const pickupDate = pickupLabel(now);
  const label = line.size === null ? line.name : `${line.name} (${line.size})`;
  return {
    ok: true,
    plan: {
      sku: line.sku,
      kind: input.kind,
      reason: reason.title,
      newSize: input.kind === 'exchange' ? newSize : null,
      refundPaise,
      pickupDate,
      summary: `${input.kind === 'return' ? 'Return' : 'Exchange'} ${label}`,
      outcome:
        input.kind === 'return'
          ? `Refund of ${formatInr(refundPaise)} ${order.payment === 'prepaid' ? 'to your original payment method' : 'to your UPI ID'} within 2 days of pickup.`
          : `We deliver size ${newSize ?? ''} when we collect this one. No extra charge.`,
    },
  };
}

function pickupLabel(now: Date): string {
  const tomorrow = new Date(now.getTime() + 330 * 60_000 + 86_400_000);
  const day = tomorrow.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${day}, 10 am – 6 pm`;
}

/** "Return / exchange" on an order: the Flow, or one question at a time without it. */
export async function startReturn(ctx: ShopCtx, orderId: string): Promise<void> {
  const order = new OrderBook(ctx.kv).get(ctx.user.address, orderId);
  if (order === undefined || !isReturnable(order, ctx.now().getTime())) {
    return listOrders(ctx, 'returns');
  }
  if (order.returnRequest !== null) {
    return orderDetail(ctx, orderId);
  }
  ctx.setState((state) => ({ ...state, step: 'returns', returnOrderId: orderId, returnDraft: null }));
  try {
    await ctx.flows.send({
      key: FLOWS.returns,
      header: 'Returns & exchanges',
      body: `Return or exchange anything from order ${orderId}. Free pickup from your door.`,
      cta: 'Start return',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await ctx.send.list({
      header: 'Returns & exchanges',
      body: `Which item from order ${orderId}?`,
      button: 'Choose item',
      footer: DEMO_FOOTER,
      sections: [
        {
          title: 'Items',
          rows: order.lines.map((line) => ({
            id: `ret:item:${line.sku}`,
            title: line.name,
            description: `${line.size === null ? '' : `Size ${line.size} · `}${formatInr(line.unitPaise * line.qty)}`,
          })),
        },
      ],
    });
  }
}

/** The Flow's data endpoint: INIT lists the items, data_exchange validates and prices the refund. */
export const returnsEndpoint: FlowEndpointHandler<ShopState> = async (fctx, request) => {
  const orderId = fctx.state.returnOrderId;
  const order = orderId === null ? undefined : new OrderBook(fctx.kv).get(fctx.user.address, orderId);
  if (order === undefined) {
    return returnScreen(null, 'This return has expired. Close the form and start again from My orders.');
  }
  if (request.action !== 'data_exchange') {
    return returnScreen(order, null);
  }
  const data = request.data ?? {};
  const field = (key: string): string => (typeof data[key] === 'string' ? data[key] : '');
  const result = planReturn(
    order,
    {
      item: field('item'),
      kind: field('kind'),
      reason: field('reason'),
      newSize: field('new_size') === '' ? null : field('new_size'),
    },
    fctx.now(),
  );
  if (!result.ok) {
    return returnScreen(order, result.error);
  }
  const { plan } = result;
  return {
    screen: 'CONFIRM',
    data: {
      summary: plan.summary,
      outcome: plan.outcome,
      pickup: `Pickup on ${plan.pickupDate}.`,
      item: plan.sku,
      kind: plan.kind,
      reason: field('reason'),
      new_size: plan.newSize ?? '',
    },
  };
};

function returnScreen(order: Order | null, error: string | null): FlowExchangeResponse {
  const sizes = [...new Set(order?.lines.flatMap((line) => findProduct(line.sku)?.sizes ?? []) ?? [])];
  return {
    screen: 'RETURN',
    data: {
      order_label:
        order === null
          ? 'Return unavailable'
          : `Order ${order.id} · ${order.lines.length} item${order.lines.length === 1 ? '' : 's'}`,
      items: (order?.lines ?? []).map((line) => ({
        id: line.sku,
        title: line.size === null ? line.name : `${line.name} (${line.size})`,
        description: formatInr(line.unitPaise * line.qty),
      })),
      reasons: RETURN_REASONS.map((reason) => ({ id: reason.id, title: reason.title })),
      sizes: sizes.length === 0 ? [NO_SIZE] : sizes.map((size) => ({ id: size, title: size })),
      error: error ?? '',
      has_error: error !== null,
    },
  };
}

/** The Flow was completed: book the pickup. */
export async function onReturnFlow(ctx: ShopCtx, response: Readonly<Record<string, unknown>>): Promise<void> {
  const text = (key: string): string => (typeof response[key] === 'string' ? response[key] : '');
  await bookReturn(ctx, {
    item: text('item'),
    kind: text('kind'),
    reason: text('reason'),
    newSize: text('new_size') === '' ? null : text('new_size'),
  });
}

// --- Button fallback --------------------------------------------------------------------

export async function fallbackItem(ctx: ShopCtx, sku: string): Promise<void> {
  const product = findProduct(sku);
  ctx.setState((state) => ({ ...state, returnDraft: { sku, kind: null, newSize: null } }));
  await ctx.send.buttons({
    body: `Return *${product?.name ?? sku}* for a refund, or exchange it for another size?`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: 'ret:kind:return', title: 'Refund' },
      ...((product?.sizes.length ?? 0) > 0 ? [{ id: 'ret:kind:exchange', title: 'Exchange size' }] : []),
    ],
  });
}

export async function fallbackKind(ctx: ShopCtx, kind: 'return' | 'exchange'): Promise<void> {
  const draft = ctx.state.returnDraft;
  if (draft === null) {
    return listOrders(ctx, 'returns');
  }
  ctx.setState((state) => ({ ...state, returnDraft: { ...draft, kind } }));
  const sizes = findProduct(draft.sku)?.sizes ?? [];
  if (kind === 'exchange' && sizes.length > 0) {
    await ctx.send.list({
      body: 'Which size should we send instead?',
      button: 'Choose size',
      footer: DEMO_FOOTER,
      sections: [{ title: 'Sizes', rows: sizes.map((size) => ({ id: `ret:size:${size}`, title: size })) }],
    });
    return;
  }
  await askReason(ctx);
}

export async function fallbackSize(ctx: ShopCtx, size: string): Promise<void> {
  const draft = ctx.state.returnDraft;
  if (draft === null) {
    return listOrders(ctx, 'returns');
  }
  ctx.setState((state) => ({ ...state, returnDraft: { ...draft, newSize: size } }));
  await askReason(ctx);
}

async function askReason(ctx: ShopCtx): Promise<void> {
  await ctx.send.list({
    body: 'What went wrong? It helps us improve.',
    button: 'Choose reason',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Reasons',
        rows: RETURN_REASONS.map((reason) => ({ id: `ret:reason:${reason.id}`, title: reason.title })),
      },
    ],
  });
}

export async function fallbackReason(ctx: ShopCtx, reason: string): Promise<void> {
  const draft = ctx.state.returnDraft;
  if (draft?.kind === null || draft === null) {
    return listOrders(ctx, 'returns');
  }
  await bookReturn(ctx, { item: draft.sku, kind: draft.kind, reason, newSize: draft.newSize });
}

async function bookReturn(ctx: ShopCtx, input: ReturnInput): Promise<void> {
  const orderId = ctx.state.returnOrderId;
  const book = new OrderBook(ctx.kv);
  const order = orderId === null ? undefined : book.get(ctx.user.address, orderId);
  if (order === undefined) {
    return listOrders(ctx, 'returns');
  }
  const result = planReturn(order, input, ctx.now());
  ctx.setState((state) => ({ ...state, step: 'browsing', returnOrderId: null, returnDraft: null }));
  if (!result.ok) {
    return nudge(ctx, `I couldn't book that return: ${result.error}`);
  }
  const { plan } = result;
  book.update(ctx.user.address, order.id, (stored) => ({
    ...stored,
    returnRequest: {
      sku: plan.sku,
      kind: plan.kind,
      reason: plan.reason,
      newSize: plan.newSize,
      refundPaise: plan.refundPaise,
      pickupDate: plan.pickupDate,
    },
  }));
  await ctx.send.buttons({
    header: 'Pickup booked ✅',
    body: [
      `*${plan.summary}*`,
      `Pickup: ${plan.pickupDate}`,
      plan.outcome,
      '',
      'Keep it unused with the tags on. Got a photo of a damage? Send it here and we will attach it.',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: `order:${order.id}`, title: 'Order details' },
      { id: 'home:browse', title: 'Shop more' },
    ],
  });
}
