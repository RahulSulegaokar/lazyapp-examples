import { formatInr } from '@lazyapp-examples/demo-kit';
import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import { findItem, SPICE_LEVELS } from './kitchen.js';
import type { MenuItem } from './kitchen.js';
import type { CartLine } from './state.js';

export const PACKAGING_FEE = 2_000;
export const DELIVERY_FEE = 3_900;
export const FREE_DELIVERY_FROM = 49_900;
/** Restaurant food in India carries 5% GST. */
export const GST_RATE = 0.05;

/** Masala Mile Club: 1 point per ₹10, a point is worth 50 paise, redeem from 100 points. */
export const POINT_VALUE_PAISE = 50;
export const MIN_REDEEM_POINTS = 100;
export const WELCOME_POINTS = 100;

export interface PricedLine {
  readonly line: CartLine;
  readonly item: MenuItem;
  readonly unitPaise: number;
  readonly totalPaise: number;
  readonly label: string;
}

export function unitPrice(item: MenuItem, line: Pick<CartLine, 'size' | 'addOns'>): number {
  const size = item.options?.sizes.find((choice) => choice.id === line.size);
  const extras = line.addOns.reduce(
    (sum, id) => sum + (item.options?.addOns.find((choice) => choice.id === id)?.pricePaise ?? 0),
    0,
  );
  return (size?.pricePaise ?? item.pricePaise) + extras;
}

/** "Hyderabadi chicken dum biryani (Full, Spicy, + Extra raita)". */
export function lineLabel(item: MenuItem, line: Pick<CartLine, 'size' | 'spice' | 'addOns'>): string {
  const size = item.options?.sizes.find((choice) => choice.id === line.size);
  const parts = [
    size === undefined || size.id === 'regular' ? null : size.label.replace(/ \(.*\)$/, ''),
    SPICE_LEVELS.find((level) => level.id === line.spice)?.label ?? null,
    ...line.addOns.map((id) => {
      const addOn = item.options?.addOns.find((choice) => choice.id === id);
      return addOn === undefined ? null : `+ ${addOn.label}`;
    }),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? item.name : `${item.name} (${parts.join(', ')})`;
}

export function priceLines(cart: readonly CartLine[]): PricedLine[] {
  return cart.flatMap((line): PricedLine[] => {
    const item = findItem(line.itemId);
    if (item === undefined) {
      return [];
    }
    const unitPaise = unitPrice(item, line);
    return [{ line, item, unitPaise, totalPaise: unitPaise * line.qty, label: lineLabel(item, line) }];
  });
}

export interface Bill {
  readonly lines: readonly PricedLine[];
  readonly itemCount: number;
  readonly subtotal: number;
  readonly pointsUsed: number;
  readonly discount: number;
  readonly packaging: number;
  readonly delivery: number;
  readonly gst: number;
  readonly total: number;
}

export function redeemablePoints(balance: number, subtotal: number): number {
  if (balance < MIN_REDEEM_POINTS) {
    return 0;
  }
  const cap = Math.floor((subtotal * 0.5) / POINT_VALUE_PAISE);
  return Math.floor(Math.min(balance, cap) / 10) * 10;
}

export function bill(
  cart: readonly CartLine[],
  options: {
    readonly mode: 'delivery' | 'pickup';
    readonly pointsBalance: number;
    readonly usePoints: boolean;
  },
): Bill {
  const lines = priceLines(cart);
  const subtotal = lines.reduce((sum, line) => sum + line.totalPaise, 0);
  const pointsUsed = options.usePoints ? redeemablePoints(options.pointsBalance, subtotal) : 0;
  const discount = pointsUsed * POINT_VALUE_PAISE;
  const packaging = lines.length === 0 ? 0 : PACKAGING_FEE;
  const delivery =
    options.mode === 'pickup' || subtotal === 0 || subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
  const gst = Math.round((subtotal - discount) * GST_RATE);
  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.line.qty, 0),
    subtotal,
    pointsUsed,
    discount,
    packaging,
    delivery,
    gst,
    total: subtotal - discount + packaging + delivery + gst,
  };
}

export function billText(value: Bill): string {
  return [
    ...value.lines.map((line) => `• ${line.line.qty} × ${line.label} — ${formatInr(line.totalPaise)}`),
    '',
    `Item total: ${formatInr(value.subtotal)}`,
    ...(value.discount === 0 ? [] : [`Club points (${value.pointsUsed}): −${formatInr(value.discount)}`]),
    `Packaging: ${formatInr(value.packaging)}`,
    `Delivery: ${value.delivery === 0 ? 'Free' : formatInr(value.delivery)}`,
    `GST (5%): ${formatInr(value.gst)}`,
    `*To pay: ${formatInr(value.total)}*`,
  ].join('\n');
}

/** Points earned on an order: one per ₹10 of food. */
export function pointsEarned(subtotal: number): number {
  return Math.floor(subtotal / 1_000);
}

// --- Loyalty ledger ------------------------------------------------------------------

const ledgerSchema = z.object({
  points: z.number().int().min(0),
  history: z.array(z.object({ at: z.string(), delta: z.number().int(), reason: z.string() })),
});
export type Ledger = z.infer<typeof ledgerSchema>;

export class LoyaltyLedger {
  constructor(private readonly kv: KeyValueStore) {}

  /** The member's ledger; first-time members get the welcome bonus. */
  get(member: string, now: Date): Ledger {
    const parsed = ledgerSchema.safeParse(this.kv.get(`loyalty:${member}`));
    if (parsed.success) {
      return parsed.data;
    }
    const welcome: Ledger = {
      points: WELCOME_POINTS,
      history: [{ at: now.toISOString(), delta: WELCOME_POINTS, reason: 'Welcome to Masala Mile Club' }],
    };
    this.kv.set(`loyalty:${member}`, welcome);
    return welcome;
  }

  add(member: string, delta: number, reason: string, now: Date): Ledger {
    const current = this.get(member, now);
    const next: Ledger = {
      points: Math.max(0, current.points + delta),
      history: [{ at: now.toISOString(), delta, reason }, ...current.history].slice(0, 20),
    };
    this.kv.set(`loyalty:${member}`, next);
    return next;
  }
}
