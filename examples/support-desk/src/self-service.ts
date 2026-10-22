import { DEMO_FOOTER, formatInr, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { Order, ServiceCentre } from './data.js';
import { BRAND, FAQS, findOrder, ORDER_STATUS_LABEL, ORDERS, SERVICE_CENTRES } from './data.js';
import { formatDate, HOURS_LABEL, isOpen } from './hours.js';
import type { Ctx } from './state.js';

export const MENU_IDS = {
  track: 'menu:track',
  faq: 'menu:faq',
  ticket: 'menu:ticket',
  agent: 'menu:agent',
  tickets: 'menu:tickets',
  centre: 'menu:centre',
} as const;

export const FAQ_HELPED = 'faq:helped';

export async function mainMenu(ctx: Ctx, intro?: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu', draft: null }));
  const status = isOpen(ctx.now()) ? '🟢 Agents are online now' : `🌙 Agents are offline (${HOURS_LABEL})`;
  await ctx.send.list({
    header: BRAND.desk,
    body: `${intro ?? 'How can we help?'}\n\n${status}.`,
    button: 'How can we help?',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Self-service',
        rows: [
          {
            id: MENU_IDS.track,
            title: 'Track an order',
            description: 'Live status, courier and delivery time',
          },
          { id: MENU_IDS.faq, title: 'Browse FAQs', description: 'Returns, refunds, payments, warranty' },
          { id: MENU_IDS.centre, title: 'Find a service centre', description: 'The nearest one to you' },
        ],
      },
      {
        title: 'Talk to us',
        rows: [
          { id: MENU_IDS.ticket, title: 'Report a problem', description: 'Raise a ticket with photos' },
          { id: MENU_IDS.agent, title: 'Talk to an agent', description: 'A person, with your details ready' },
          { id: MENU_IDS.tickets, title: 'My tickets', description: 'Status, replies and reopening' },
        ],
      },
    ],
  });
}

// --- FAQs ----------------------------------------------------------------------

export async function faqList(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'faq' }));
  const sections = [...new Set(FAQS.map((faq) => faq.section))].map((section) => ({
    title: section,
    rows: FAQS.filter((faq) => faq.section === section).map((faq) => ({ id: faq.id, title: faq.question })),
  }));
  await ctx.send.list({
    header: 'Help centre',
    body: 'Most answers are one tap away. Pick a question:',
    button: 'See questions',
    footer: DEMO_FOOTER,
    sections,
  });
}

export async function faqAnswer(ctx: Ctx, faqId: string): Promise<boolean> {
  const faq = FAQS.find((entry) => entry.id === faqId);
  if (faq === undefined) {
    return false;
  }
  await ctx.send.buttons({
    header: faq.question,
    body: faq.answer,
    footer: DEMO_FOOTER,
    buttons: [
      { id: FAQ_HELPED, title: 'That helped' },
      { id: MENU_IDS.agent, title: 'Talk to an agent' },
      { id: MENU_IDS.faq, title: 'More questions' },
    ],
  });
  return true;
}

/** Keyword routing for free text, the way a help widget's search does it. */
export function faqForText(text: string): string | null {
  const lower = text.toLowerCase();
  const rules: readonly [RegExp, string][] = [
    [/refund/, 'faq:refunds'],
    [/return|exchange/, 'faq:returns'],
    [/debit|deducted|charged|payment fail/, 'faq:debited'],
    [/emi|instal/, 'faq:emi'],
    [/warrant|install/, 'faq:warranty'],
    [/filter/, 'faq:filter'],
    [/address/, 'faq:address'],
    [/where.*order|track|deliver/, 'faq:where'],
  ];
  return rules.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}

// --- Orders ----------------------------------------------------------------------

export async function trackPrompt(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'track' }));
  await ctx.send.list({
    header: 'Track an order',
    body: 'Type your order number (it looks like *HH-1057*), or pick one of these sample orders:',
    button: 'Sample orders',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Sample orders',
        rows: ORDERS.map((order) => ({
          id: `order:${order.id}`,
          title: order.id,
          description: `${ORDER_STATUS_LABEL[order.status]} · ${order.product}`,
        })),
      },
    ],
  });
}

export async function showOrder(ctx: Ctx, orderId: string): Promise<void> {
  const order = findOrder(orderId);
  await ctx.send.typing();
  if (order === undefined) {
    await ctx.send.buttons({
      body: `I couldn't find *${orderId}*. Order numbers are in your confirmation email and look like *HH-1057*.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.track, title: 'Sample orders' },
        { id: MENU_IDS.agent, title: 'Talk to an agent' },
      ],
    });
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  await ctx.send.buttons({
    header: `📦 ${order.id}`,
    body: orderCard(order, ctx.now()),
    footer: DEMO_FOOTER,
    buttons: [
      { id: `report:${order.id}`, title: 'Report a problem' },
      { id: MENU_IDS.track, title: 'Another order' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
  if (order.awb !== null && (order.status === 'shipped' || order.status === 'out_for_delivery')) {
    await ctx.send.cta({
      body: `${order.courier ?? 'Courier'} AWB ${order.awb}. Follow the parcel live:`,
      displayText: 'Track shipment',
      url: `${ctx.config.publicBaseUrl}/x/support-desk/track/${order.id}`,
    });
  }
}

export function orderCard(order: Order, now: Date): string {
  const day = (daysAgo: number) => formatDate(new Date(now.getTime() - daysAgo * 86_400_000));
  const lines = order.timeline.map((step) => `${day(step.daysAgo)} · ${step.text}`);
  return [
    `*${order.product}*`,
    `${formatInr(order.amount)} · placed ${day(order.placedDaysAgo)} · to ${order.city}`,
    '',
    `Status: *${ORDER_STATUS_LABEL[order.status]}*`,
    ...(order.courier === null
      ? []
      : [`Courier: ${order.courier}${order.awb === null ? '' : ` (AWB ${order.awb})`}`]),
    '',
    ...lines,
  ].join('\n');
}

// --- Service centres --------------------------------------------------------------

export async function askLocation(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'centre' }));
  await ctx.send.locationRequest(
    'Share your location and I will find the nearest Halo Home service centre. Your location is only used for this search.',
  );
}

export async function nearestCentre(ctx: Ctx, latitude: number, longitude: number): Promise<void> {
  const ranked = SERVICE_CENTRES.map((centre) => ({
    centre,
    km: distanceKm(latitude, longitude, centre.latitude, centre.longitude),
  })).sort((a, b) => a.km - b.km);
  const nearest = ranked[0];
  if (nearest === undefined) {
    return mainMenu(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  await ctx.send.location({
    latitude: nearest.centre.latitude,
    longitude: nearest.centre.longitude,
    name: nearest.centre.name,
    address: nearest.centre.address,
  });
  await ctx.send.contacts([centreContact(nearest.centre)]);
  await ctx.send.buttons({
    body:
      `Your nearest centre is *${nearest.centre.name}*, about ${Math.round(nearest.km).toLocaleString('en-IN')} km away. ` +
      `Open ${nearest.centre.hours}; walk-ins welcome, or book a home visit with a ticket.\n\n` +
      'I also sent the centre as a contact card, so it is one tap to save.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: MENU_IDS.ticket, title: 'Book a visit' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

function centreContact(centre: ServiceCentre) {
  return {
    name: { formatted_name: centre.name, first_name: BRAND.desk },
    emails: [{ email: BRAND.email, type: 'WORK' }],
    urls: [{ url: BRAND.website, type: 'WORK' }],
    org: { company: BRAND.name, department: 'Customer care' },
    addresses: [{ street: centre.address, country: 'India', country_code: 'IN', type: 'WORK' }],
  };
}

/** Great-circle distance (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
