/**
 * Ledgerly, a fictional GST billing and accounting SaaS for Indian SMBs: the business this
 * lead machine sells. Everything the qualification asks about lives here, so the Flow JSON,
 * the button fallback and the scoring read from one definition.
 */

export const COMPANY = 'Ledgerly';

export interface Option {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export const NEEDS = [
  { id: 'gst-billing', title: 'GST invoicing', description: 'GST invoices and e-invoices (IRN)' },
  { id: 'eway', title: 'E-way bills', description: 'Generate e-way bills from invoices' },
  { id: 'inventory', title: 'Inventory', description: 'Stock across godowns and batches' },
  { id: 'recon', title: 'GSTR-2B reconciliation', description: 'Match purchases, never lose ITC' },
  { id: 'collections', title: 'Payment collection', description: 'UPI links and WhatsApp reminders' },
  { id: 'multi-gstin', title: 'Multiple branches', description: 'Several GSTINs in one account' },
] as const satisfies readonly Option[];

export const SIZES = [
  { id: '1-10', title: '1–10 people' },
  { id: '11-50', title: '11–50 people' },
  { id: '51-200', title: '51–200 people' },
  { id: '201+', title: '201+ people' },
] as const satisfies readonly Option[];

export const ROLES = [
  { id: 'owner', title: 'Owner or founder' },
  { id: 'finance', title: 'Finance or accounts' },
  { id: 'ops', title: 'Operations' },
  { id: 'other', title: 'Something else' },
] as const satisfies readonly Option[];

export const BUDGETS = [
  { id: 'lt1k', title: 'Under ₹1,000 a month' },
  { id: '1k-3k', title: '₹1,000 – ₹3,000 a month' },
  { id: '3k-10k', title: '₹3,000 – ₹10,000 a month' },
  { id: '10k+', title: 'Above ₹10,000 a month' },
  { id: 'unsure', title: 'Not sure yet' },
] as const satisfies readonly Option[];

export const TIMELINES = [
  { id: 'now', title: 'This month' },
  { id: '1-3m', title: 'In 1–3 months' },
  { id: '3-6m', title: 'In 3–6 months' },
  { id: 'exploring', title: 'Just exploring' },
] as const satisfies readonly Option[];

export type Need = (typeof NEEDS)[number]['id'];
export type Size = (typeof SIZES)[number]['id'];
export type Role = (typeof ROLES)[number]['id'];
export type Budget = (typeof BUDGETS)[number]['id'];
export type Timeline = (typeof TIMELINES)[number]['id'];

export const ids = <T extends readonly Option[]>(options: T): [T[number]['id'], ...T[number]['id'][]] =>
  options.map((option) => option.id) as [T[number]['id'], ...T[number]['id'][]];

export function titleOf(options: readonly Option[], id: string): string {
  return options.find((option) => option.id === id)?.title ?? id;
}

export interface Plan {
  readonly id: 'starter' | 'growth' | 'enterprise';
  readonly name: string;
  readonly price: string;
  readonly pitch: string;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '₹799/month',
    pitch: '1 GSTIN, 2 users, unlimited GST invoices and e-way bills',
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '₹1,999/month',
    pitch: 'e-invoicing, inventory, GSTR-2B reconciliation and UPI collections for up to 10 users',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom pricing',
    pitch: 'multiple GSTINs, Tally migration, approvals and SSO, with a dedicated success manager',
  },
];

export interface Rep {
  readonly id: string;
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly title: string;
  readonly email: string;
}

export const REPS: readonly Rep[] = [
  {
    id: 'ananya',
    name: 'Ananya Iyer',
    firstName: 'Ananya',
    lastName: 'Iyer',
    title: 'Account executive',
    email: 'ananya.iyer@example.com',
  },
  {
    id: 'vikram',
    name: 'Vikram Shah',
    firstName: 'Vikram',
    lastName: 'Shah',
    title: 'Enterprise account executive',
    email: 'vikram.shah@example.com',
  },
];

export function getRep(id: string): Rep | undefined {
  return REPS.find((rep) => rep.id === id);
}

/** Office image for the welcome card. */
export const BRAND_IMAGE = 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200&q=80&fm=jpg';
/** The GST guide in `public/`, served by the demo server. */
export const GUIDE_FILE = 'ledgerly-gst-invoicing-guide.pdf';
