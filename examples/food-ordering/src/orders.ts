import { createHash } from 'node:crypto';
import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import { cartLineSchema } from './state.js';

export const orderStatus = z.enum([
  'awaiting_payment',
  'payment_failed',
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'picked_up',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatus>;

export const foodOrderSchema = z.object({
  id: z.string(),
  customer: z.string(),
  createdAt: z.string(),
  outletId: z.string(),
  mode: z.enum(['delivery', 'pickup']),
  lines: z.array(cartLineSchema.extend({ label: z.string(), unitPaise: z.number().int() })),
  subtotal: z.number().int(),
  discount: z.number().int(),
  pointsUsed: z.number().int(),
  packaging: z.number().int(),
  delivery: z.number().int(),
  gst: z.number().int(),
  total: z.number().int(),
  payment: z.enum(['prepaid', 'cod']),
  paymentId: z.string().nullable(),
  nativeOrderStatus: z.boolean(),
  status: orderStatus,
  /** When the customer should have the food (ISO). */
  dueAt: z.string(),
  scheduled: z.boolean(),
  drop: z
    .object({ latitude: z.number(), longitude: z.number(), km: z.number(), details: z.string().nullable() })
    .nullable(),
  pickupCode: z.string(),
  rating: z.number().int().min(1).max(5).nullable(),
  reviewWamid: z.string().nullable(),
});
export type FoodOrder = z.infer<typeof foodOrderSchema>;

const DELIVERY_JOURNEY: readonly OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'out_for_delivery',
  'delivered',
];
const PICKUP_JOURNEY: readonly OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'picked_up'];

export function journey(order: Pick<FoodOrder, 'mode'>): readonly OrderStatus[] {
  return order.mode === 'delivery' ? DELIVERY_JOURNEY : PICKUP_JOURNEY;
}

export function nextStatus(order: Pick<FoodOrder, 'mode' | 'status'>): OrderStatus | null {
  const steps = journey(order);
  const index = steps.indexOf(order.status);
  return index === -1 ? null : (steps[index + 1] ?? null);
}

export function isFinished(order: Pick<FoodOrder, 'status'>): boolean {
  return order.status === 'delivered' || order.status === 'picked_up' || order.status === 'cancelled';
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Waiting for payment',
  payment_failed: 'Payment failed',
  placed: 'Order placed',
  accepted: 'Accepted by the kitchen',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
};

/** Deterministic from the turn's idempotency key: a replayed webhook rebuilds the same order. */
export function orderIdFrom(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  return `MM${(digest.readUInt32BE(0) % 90_000) + 10_000}`;
}

export function pickupCodeFor(orderId: string): string {
  return String((createHash('sha256').update(orderId).digest().readUInt16BE(0) % 9_000) + 1_000);
}

export class FoodOrderBook {
  constructor(private readonly kv: KeyValueStore) {}

  get(customer: string, id: string): FoodOrder | undefined {
    const parsed = foodOrderSchema.safeParse(this.kv.get(`order:${customer}:${id}`));
    return parsed.success ? parsed.data : undefined;
  }

  save(order: FoodOrder): void {
    this.kv.set(`order:${order.customer}:${order.id}`, order);
  }

  update(customer: string, id: string, change: (order: FoodOrder) => FoodOrder): FoodOrder | undefined {
    const order = this.get(customer, id);
    if (order === undefined) {
      return undefined;
    }
    const next = change(order);
    this.save(next);
    return next;
  }

  /** Placed orders, newest first. */
  list(customer: string): FoodOrder[] {
    return this.kv
      .list<unknown>(`order:${customer}:`)
      .flatMap(({ value }) => {
        const parsed = foodOrderSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .filter((order) => order.status !== 'awaiting_payment' && order.status !== 'payment_failed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  latest(customer: string): FoodOrder | undefined {
    return this.list(customer)[0];
  }
}
