import { formatInr } from '@lazyapp-examples/demo-kit';
import type { EventInfo, Tier } from './catalog.js';

/** Booking fee per paid ticket, and GST on it (18%), in paise. Free tickets carry no fee. */
export const BOOKING_FEE = 3_000;
export const FEE_GST = 540;

export interface Promo {
  readonly code: string;
  readonly label: string;
  /** Discount in paise for this ticket subtotal, quantity and event (0 when it does not apply). */
  readonly discount: (input: {
    readonly subtotal: number;
    readonly quantity: number;
    readonly event: EventInfo;
  }) => number;
}

export const PROMOS: readonly Promo[] = [
  {
    code: 'LAZY20',
    label: '20% off tickets, up to ₹500',
    discount: ({ subtotal }) => Math.min(Math.round(subtotal * 0.2), 50_000),
  },
  {
    code: 'EARLY100',
    label: '₹100 off each Monsoon Indie Nights ticket',
    discount: ({ quantity, event }) => (event.id === 'indie' ? quantity * 10_000 : 0),
  },
];

export interface Quote {
  readonly quantity: number;
  readonly unitPrice: number;
  /** Ticket price × quantity. */
  readonly subtotal: number;
  readonly fees: number;
  readonly tax: number;
  readonly discount: number;
  readonly total: number;
  /** The promo that applied, or why it did not. */
  readonly promo: { readonly code: string; readonly applied: boolean; readonly note: string } | null;
}

/** Prices a booking. Everything is integer paise, so totals match what Meta checks to the paisa. */
export function quote(event: EventInfo, tier: Tier, quantity: number, promoCode: string | null): Quote {
  const subtotal = tier.price * quantity;
  const paid = tier.price > 0;
  const fees = paid ? BOOKING_FEE * quantity : 0;
  const tax = paid ? FEE_GST * quantity : 0;
  const code = promoCode?.trim().toUpperCase() ?? '';
  let promo: Quote['promo'] = null;
  let discount = 0;
  if (code !== '') {
    const match = PROMOS.find((entry) => entry.code === code);
    const amount =
      match === undefined || !paid ? 0 : Math.min(match.discount({ subtotal, quantity, event }), subtotal);
    discount = amount;
    promo =
      match === undefined
        ? { code, applied: false, note: `Code ${code} isn't valid, so no discount was applied.` }
        : amount === 0
          ? { code, applied: false, note: `Code ${code} doesn't apply to these tickets.` }
          : { code, applied: true, note: `${match.code}: ${match.label}` };
  }
  return {
    quantity,
    unitPrice: tier.price,
    subtotal,
    fees,
    tax,
    discount,
    total: subtotal + fees + tax - discount,
    promo,
  };
}

/** Receipt lines for the Flow summary and the chat. */
export function receiptLines(tier: Tier, value: Quote): string[] {
  if (value.total === 0) {
    return [`${tier.name} × ${value.quantity}: Free`];
  }
  return [
    `${tier.name} × ${value.quantity}: ${formatInr(value.subtotal)}`,
    `Booking fee: ${formatInr(value.fees)} (+ ${formatInr(value.tax)} GST)`,
    ...(value.discount > 0
      ? [`Discount (${value.promo?.code ?? 'promo'}): −${formatInr(value.discount)}`]
      : []),
    `Total: ${formatInr(value.total)}`,
  ];
}
