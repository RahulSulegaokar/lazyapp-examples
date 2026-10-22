/**
 * Seed data for Halo Home, a fictional Indian direct-to-consumer appliance brand. Everything
 * here would come from your order system, help centre and workforce tool in production.
 */

export const BRAND = {
  name: 'Halo Home',
  desk: 'Halo Home Care',
  email: 'care@halohome.example',
  website: 'https://halohome.example',
} as const;

export type OrderStatus = 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'refund_initiated';

export interface Order {
  readonly id: string;
  readonly product: string;
  /** Paise. */
  readonly amount: number;
  readonly status: OrderStatus;
  /** Days before "now" the order was placed; dates are computed so the demo never goes stale. */
  readonly placedDaysAgo: number;
  readonly city: string;
  readonly courier: string | null;
  readonly awb: string | null;
  readonly timeline: readonly { readonly daysAgo: number; readonly text: string }[];
}

export const ORDERS: readonly Order[] = [
  {
    id: 'HH-1057',
    product: 'Halo MixMaster 750W mixer grinder',
    amount: 449_900,
    status: 'out_for_delivery',
    placedDaysAgo: 3,
    city: 'Indiranagar, Bengaluru',
    courier: 'Delhivery',
    awb: '1490 2231 7781',
    timeline: [
      { daysAgo: 3, text: 'Order placed and paid (UPI)' },
      { daysAgo: 2, text: 'Packed at the Hosur warehouse' },
      { daysAgo: 1, text: 'Shipped with Delhivery' },
      { daysAgo: 0, text: 'Out for delivery, arriving by 7 pm' },
    ],
  },
  {
    id: 'HH-1042',
    product: 'Halo Air Pro purifier',
    amount: 1_299_900,
    status: 'delivered',
    placedDaysAgo: 6,
    city: 'Powai, Mumbai',
    courier: 'Blue Dart',
    awb: '7712 0094 3310',
    timeline: [
      { daysAgo: 6, text: 'Order placed (no-cost EMI, 6 months)' },
      { daysAgo: 5, text: 'Shipped with Blue Dart' },
      { daysAgo: 3, text: 'Delivered, signed by Asha' },
    ],
  },
  {
    id: 'HH-1063',
    product: 'Halo Smart Bulb, pack of 4',
    amount: 179_600,
    status: 'processing',
    placedDaysAgo: 0,
    city: 'Salt Lake, Kolkata',
    courier: null,
    awb: null,
    timeline: [
      { daysAgo: 0, text: 'Order placed and paid (card)' },
      { daysAgo: 0, text: 'Being packed, ships within 24 hours' },
    ],
  },
  {
    id: 'HH-0998',
    product: 'Halo Breeze BLDC ceiling fan',
    amount: 389_900,
    status: 'refund_initiated',
    placedDaysAgo: 14,
    city: 'Gachibowli, Hyderabad',
    courier: 'Ekart',
    awb: '5520 1188 0042',
    timeline: [
      { daysAgo: 14, text: 'Order placed' },
      { daysAgo: 11, text: 'Delivered' },
      { daysAgo: 6, text: 'Return picked up (noisy motor)' },
      { daysAgo: 2, text: 'Refund of ₹3,899 initiated to the original UPI account' },
    ],
  },
];

export const ORDER_STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  processing: '🧺 Being packed',
  shipped: '🚚 Shipped',
  out_for_delivery: '🛵 Out for delivery',
  delivered: '✅ Delivered',
  refund_initiated: '💸 Refund initiated',
};

/** `hh1057`, `HH 1057`, `#hh-1057` → `HH-1057`. */
export function normaliseOrderId(text: string): string | null {
  const match = /\bHH[\s-]?(\d{4})\b/i.exec(text.replace(/#/g, ''));
  return match === null ? null : `HH-${match[1] ?? ''}`;
}

export function findOrder(id: string): Order | undefined {
  return ORDERS.find((order) => order.id === id);
}

// --- Help centre -------------------------------------------------------------

export interface Faq {
  readonly id: string;
  readonly section: string;
  readonly question: string;
  readonly answer: string;
}

export const FAQS: readonly Faq[] = [
  {
    id: 'faq:where',
    section: 'Orders & delivery',
    question: 'Where is my order?',
    answer:
      'Most orders ship within 24 hours and arrive in 2–4 days in metros, 4–7 days elsewhere. Tap *Track an order* in the menu for live status, or type your order number (it looks like HH-1057).',
  },
  {
    id: 'faq:address',
    section: 'Orders & delivery',
    question: 'Change delivery address',
    answer:
      'You can change the address until the order ships. After that, the courier can only redirect within the same city: raise a ticket under *Order not delivered* and we will arrange it.',
  },
  {
    id: 'faq:returns',
    section: 'Returns & refunds',
    question: 'Return policy',
    answer:
      '10-day no-questions return on every appliance, with free pickup. Keep the box and accessories; a photo of the item helps us approve the pickup in one go.',
  },
  {
    id: 'faq:refunds',
    section: 'Returns & refunds',
    question: 'How long do refunds take?',
    answer:
      'UPI refunds land in 1–3 working days, cards in 5–7, EMI in 7–10 (the bank cancels the remaining instalments). We start the refund as soon as the pickup is scanned.',
  },
  {
    id: 'faq:debited',
    section: 'Payments',
    question: 'Money debited, no order',
    answer:
      'If a payment fails after the debit, the bank reverses it automatically within 3–5 working days. If it is older than that, raise a *Payment issue* ticket with a screenshot of the debit and we will chase the bank.',
  },
  {
    id: 'faq:emi',
    section: 'Payments',
    question: 'No-cost EMI',
    answer:
      'No-cost EMI is available on orders above ₹3,000 with most credit cards and Bajaj Finserv: 3 or 6 months, the interest is paid by us as an upfront discount.',
  },
  {
    id: 'faq:warranty',
    section: 'Product care',
    question: 'Warranty & installation',
    answer:
      'Every appliance has a 2-year warranty (fans: 5 years on the motor). Ceiling fans and purifiers include free installation: we call within a day of delivery to book it.',
  },
  {
    id: 'faq:filter',
    section: 'Product care',
    question: 'Air Pro filter change',
    answer:
      'Replace the Air Pro HEPA filter every 6–8 months; the ring turns amber when it is due. After fitting a new one, hold the fan button for 5 seconds to reset the reminder.',
  },
];

// --- Tickets -------------------------------------------------------------------

export type Priority = 'P1' | 'P2' | 'P3';

export interface Category {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  /** Whether the ticket is about an order (we then ask which one). */
  readonly needsOrder: boolean;
  /** Whether a photo is required before submitting. */
  readonly needsPhoto: boolean;
  /** What the (simulated) agent says first. `{order}` is replaced. */
  readonly agentReply: string;
}

export const CATEGORIES: readonly Category[] = [
  {
    id: 'not_delivered',
    title: 'Order not delivered',
    description: 'Late, stuck in transit, or marked delivered',
    priority: 'P1',
    needsOrder: true,
    needsPhoto: false,
    agentReply:
      "I've checked with the courier: {order} is at the local hub and will be re-attempted today by 7 pm. I've flagged it so the rider calls you before arriving.",
  },
  {
    id: 'payment',
    title: 'Payment issue',
    description: 'Money debited but no order, or charged twice',
    priority: 'P1',
    needsOrder: false,
    needsPhoto: false,
    agentReply:
      'I can see the failed payment. The bank has already started the reversal (reference RVSL-58213); it reaches your account within 3 working days. If it does not, reply here and I will escalate it with the bank.',
  },
  {
    id: 'damaged',
    title: 'Damaged or wrong item',
    description: 'Broken in transit, missing parts, wrong model',
    priority: 'P2',
    needsOrder: true,
    needsPhoto: true,
    agentReply:
      "So sorry about {order}! Thanks for the photos, they're all we need. I've approved a free replacement: the new unit ships today and the courier collects the damaged one at the same visit.",
  },
  {
    id: 'install',
    title: 'Installation or demo',
    description: 'Book or reschedule a technician visit',
    priority: 'P2',
    needsOrder: true,
    needsPhoto: false,
    agentReply:
      "I've booked a technician for {order}: tomorrow between 11 am and 2 pm. They will call 30 minutes before arriving. Reply here if you need a different slot.",
  },
  {
    id: 'refund',
    title: 'Refund status',
    description: 'Where is my refund?',
    priority: 'P2',
    needsOrder: true,
    needsPhoto: false,
    agentReply:
      'The refund for {order} was processed to your original payment method (reference RFND-20931). UPI refunds land in 1–3 working days; I will check in again if it has not arrived by then.',
  },
  {
    id: 'product',
    title: 'Product not working',
    description: 'Not switching on, noise, error lights',
    priority: 'P2',
    needsOrder: true,
    needsPhoto: false,
    agentReply:
      "Let's try a quick reset on {order}: unplug it for 30 seconds, then hold the power button for 10 seconds while plugging it back in. If that doesn't fix it, I'll book a technician under warranty, free of charge.",
  },
  {
    id: 'other',
    title: 'Something else',
    description: 'Anything not listed here',
    priority: 'P3',
    needsOrder: false,
    needsPhoto: false,
    agentReply:
      "Thanks for the details, I've read through them and I'm on it. I'll update this ticket as soon as I have an answer.",
  },
];

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((category) => category.id === id);
}

/** First-response targets by priority, in business minutes. */
export const SLA_MINUTES: Readonly<Record<Priority, number>> = { P1: 15, P2: 60, P3: 240 };

export interface Agent {
  readonly name: string;
  readonly team: string;
}

/** Who picks up what. Real desks pull this from their workforce tool; LazyApp's inbox shows the assignee. */
export const ROSTER: Readonly<Record<Priority, readonly Agent[]>> = {
  P1: [
    { name: 'Meera', team: 'Priority desk' },
    { name: 'Farhan', team: 'Priority desk' },
  ],
  P2: [
    { name: 'Arjun', team: 'Customer care' },
    { name: 'Divya', team: 'Customer care' },
  ],
  P3: [{ name: 'Kavya', team: 'General support' }],
};

export const TEAM_LEAD: Agent = { name: 'Rohan', team: 'Team lead' };

export const ESCALATION_REPLY =
  "I've read the whole thread and I'm sorry it took this long. I've approved the fix on my side and set this ticket to the highest priority; you'll get a confirmation here within the hour, and I'll personally check it's done.";

// --- Service centres -------------------------------------------------------------

export interface ServiceCentre {
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly hours: string;
}

export const SERVICE_CENTRES: readonly ServiceCentre[] = [
  {
    name: 'Halo Home Care, Koramangala',
    address: '80 Feet Road, 4th Block, Koramangala, Bengaluru 560034',
    latitude: 12.9352,
    longitude: 77.6245,
    hours: 'Mon–Sat, 10 am–7 pm',
  },
  {
    name: 'Halo Home Care, Andheri East',
    address: 'Chakala, Andheri-Kurla Road, Mumbai 400099',
    latitude: 19.1136,
    longitude: 72.8697,
    hours: 'Mon–Sat, 10 am–7 pm',
  },
  {
    name: 'Halo Home Care, Saket',
    address: 'Press Enclave Marg, Saket, New Delhi 110017',
    latitude: 28.5245,
    longitude: 77.2066,
    hours: 'Mon–Sat, 10 am–7 pm',
  },
];
