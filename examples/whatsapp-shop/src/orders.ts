import { createHash } from 'node:crypto';
import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import { deliveryAddressSchema, slotSchema } from './state.js';

export const orderStatus = z.enum([
  'awaiting_payment',
  'payment_failed',
  'confirmed',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatus>;

export const orderSchema = z.object({
  id: z.string(),
  customer: z.string(),
  createdAt: z.string(),
  lines: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      size: z.string().nullable(),
      qty: z.number().int().min(1),
      unitPaise: z.number().int().min(0),
      imageUrl: z.string(),
    }),
  ),
  subtotal: z.number().int(),
  shipping: z.number().int(),
  discount: z.number().int(),
  coupon: z.string().nullable(),
  codFee: z.number().int(),
  total: z.number().int(),
  payment: z.enum(['prepaid', 'cod']),
  /** LazyApp payment id for prepaid orders, used for order-status updates. */
  paymentId: z.string().nullable(),
  /** Order-status updates only work for in-WhatsApp (`payment_gateway`) payments. */
  nativeOrderStatus: z.boolean(),
  status: orderStatus,
  address: deliveryAddressSchema,
  slot: slotSchema,
  awb: z.string(),
  deliveredAt: z.string().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  /** The "how did we do?" message: a reaction to it counts as a rating. */
  reviewWamid: z.string().nullable(),
  returnRequest: z
    .object({
      sku: z.string(),
      kind: z.enum(['return', 'exchange']),
      reason: z.string(),
      newSize: z.string().nullable(),
      refundPaise: z.number().int(),
      pickupDate: z.string(),
    })
    .nullable(),
});
export type Order = z.infer<typeof orderSchema>;

/** The journey after confirmation, in order. */
export const FULFILMENT: readonly OrderStatus[] = [
  'confirmed',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
];

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const index = FULFILMENT.indexOf(status);
  return index === -1 || index === FULFILMENT.length - 1 ? null : (FULFILMENT[index + 1] ?? null);
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Waiting for payment',
  payment_failed: 'Payment failed',
  confirmed: 'Confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Returns are accepted for seven days after delivery. */
export const RETURN_WINDOW_MS = 7 * 86_400_000;

/**
 * Order ids are derived from the turn's idempotency key, so a redelivered webhook
 * recreates the same id (and LazyApp replays the same payment request).
 */
export function orderIdFrom(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  return `IL${(digest.readUInt32BE(0) % 900_000) + 100_000}`;
}

export function awbFor(orderId: string): string {
  return `DL${createHash('sha256').update(orderId).digest('hex').slice(0, 10).toUpperCase()}`;
}

/** Orders in example storage, keyed by customer so one person never sees another's orders. */
export class OrderBook {
  constructor(private readonly kv: KeyValueStore) {}

  get(customer: string, id: string): Order | undefined {
    const parsed = orderSchema.safeParse(this.kv.get(key(customer, id)));
    return parsed.success ? parsed.data : undefined;
  }

  save(order: Order): void {
    this.kv.set(key(order.customer, order.id), order);
  }

  update(customer: string, id: string, change: (order: Order) => Order): Order | undefined {
    const order = this.get(customer, id);
    if (order === undefined) {
      return undefined;
    }
    const next = change(order);
    this.save(next);
    return next;
  }

  /** Newest first. Unpaid checkouts are left out. */
  list(customer: string): Order[] {
    return this.kv
      .list<unknown>(`order:${customer}:`)
      .flatMap(({ value }) => {
        const parsed = orderSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .filter((order) => order.status !== 'awaiting_payment' && order.status !== 'payment_failed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function key(customer: string, id: string): string {
  return `order:${customer}:${id}`;
}
