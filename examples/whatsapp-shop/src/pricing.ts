import { formatInr } from '@lazyapp-examples/demo-kit';
import { findProduct } from './catalog.js';
import type { Product } from './catalog.js';
import type { CartLine } from './state.js';

export const FREE_SHIPPING_FROM = 149_900;
export const SHIPPING_FEE = 7_900;
export const COD_FEE = 4_900;
/** Cash on delivery above this is refused: couriers cap COD value. */
export const COD_LIMIT = 1_000_000;

export type PaymentChoice = 'prepaid' | 'cod';

export interface Coupon {
  readonly code: string;
  readonly label: string;
  readonly minimumPaise: number;
  readonly discount: (subtotal: number) => number;
}

export const COUPONS: readonly Coupon[] = [
  {
    code: 'FESTIVE200',
    label: '₹200 off orders above ₹1,999',
    minimumPaise: 199_900,
    discount: () => 20_000,
  },
  {
    code: 'WELCOME10',
    label: '10% off up to ₹300, orders above ₹999',
    minimumPaise: 99_900,
    discount: (subtotal) => Math.min(Math.round(subtotal / 1000) * 100, 30_000),
  },
];

/** The coupon the limited-time offer template hands out. */
export const OFFER_COUPON = 'FESTIVE200';

export function findCoupon(code: string): Coupon | undefined {
  const normalized = code.trim().toUpperCase();
  return COUPONS.find((coupon) => coupon.code === normalized);
}

export interface QuoteLine {
  readonly product: Product;
  readonly size: string | null;
  readonly qty: number;
  readonly totalPaise: number;
}

export interface Quote {
  readonly lines: readonly QuoteLine[];
  readonly itemCount: number;
  readonly subtotal: number;
  readonly shipping: number;
  readonly discount: number;
  /** Applied coupon, or null when none applies (with the reason in `couponNote`). */
  readonly coupon: Coupon | null;
  readonly couponNote: string | null;
  readonly codFee: number;
  readonly total: number;
}

/** Prices a cart. Lines whose SKU no longer exists are dropped. */
export function quote(
  cart: readonly CartLine[],
  options: { readonly couponCode: string | null; readonly payment: PaymentChoice | null },
): Quote {
  const lines = cart.flatMap((line): QuoteLine[] => {
    const product = findProduct(line.sku);
    return product === undefined
      ? []
      : [{ product, size: line.size, qty: line.qty, totalPaise: product.pricePaise * line.qty }];
  });
  const subtotal = lines.reduce((sum, line) => sum + line.totalPaise, 0);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;

  const requested = options.couponCode === null ? undefined : findCoupon(options.couponCode);
  let coupon: Coupon | null = null;
  let couponNote: string | null = null;
  if (options.couponCode !== null && requested === undefined) {
    couponNote = `${options.couponCode} is not a valid code`;
  } else if (requested !== undefined && subtotal < requested.minimumPaise) {
    couponNote = `${requested.code} needs ${formatInr(requested.minimumPaise)} or more`;
  } else if (requested !== undefined) {
    coupon = requested;
  }
  const discount = coupon === null ? 0 : Math.min(coupon.discount(subtotal), subtotal);
  const codFee = options.payment === 'cod' ? COD_FEE : 0;

  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    subtotal,
    shipping,
    discount,
    coupon,
    couponNote,
    codFee,
    total: subtotal + shipping + codFee - discount,
  };
}

export function lineLabel(line: { readonly product: Product; readonly size: string | null }): string {
  return line.size === null ? line.product.name : `${line.product.name} (${line.size})`;
}

/** A WhatsApp-formatted bill: one line per item, then the totals. */
export function billText(bill: Quote): string {
  const items = bill.lines.map(
    (line) => `• ${line.qty} × ${lineLabel(line)} — ${formatInr(line.totalPaise)}`,
  );
  const totals = [
    `Subtotal: ${formatInr(bill.subtotal)}`,
    `Shipping: ${bill.shipping === 0 ? 'Free' : formatInr(bill.shipping)}`,
    ...(bill.coupon === null ? [] : [`Coupon ${bill.coupon.code}: −${formatInr(bill.discount)}`]),
    ...(bill.codFee === 0 ? [] : [`Cash on delivery fee: ${formatInr(bill.codFee)}`]),
    `*Total: ${formatInr(bill.total)}*`,
  ];
  return [...items, '', ...totals].join('\n');
}

export function priceTag(product: Product): string {
  return product.mrpPaise === null
    ? formatInr(product.pricePaise)
    : `${formatInr(product.pricePaise)} ~${formatInr(product.mrpPaise)}~ (${percentOff(product)}% off)`;
}

/** Plain price for list rows, where WhatsApp markdown is not rendered. */
export function plainPrice(product: Product): string {
  return product.mrpPaise === null
    ? formatInr(product.pricePaise)
    : `${formatInr(product.pricePaise)} · ${percentOff(product)}% off`;
}

function percentOff(product: Product): number {
  return product.mrpPaise === null ? 0 : Math.round((1 - product.pricePaise / product.mrpPaise) * 100);
}
