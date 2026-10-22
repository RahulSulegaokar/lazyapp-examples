import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { ContactCard } from '@lazyapp-examples/sdk';
import { greetingFor } from './attribution.js';
import { LEAD_IDS } from './ids.js';
import { BRAND_IMAGE, COMPANY, PLANS } from './product.js';
import type { Rep } from './product.js';
import type { Ctx, Deps } from './types.js';

export async function welcome(ctx: Ctx): Promise<void> {
  const name = ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`;
  await ctx.send.buttons({
    header: { image: BRAND_IMAGE },
    body:
      `Hi${name}! ${greetingFor(ctx.state.attribution)}\n\n` +
      `*${COMPANY}* is GST billing and accounting for Indian businesses: e-invoices, e-way bills, ` +
      'GSTR-2B reconciliation and UPI collections in one place.\n\nHow can we help?',
    footer: DEMO_FOOTER,
    buttons: [
      { id: LEAD_IDS.book, title: 'Book a demo' },
      { id: LEAD_IDS.pricing, title: 'See pricing' },
      { id: LEAD_IDS.guide, title: 'Free GST guide' },
    ],
  });
}

export async function mainMenu(ctx: Ctx, body = 'What would you like to do next?'): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  await ctx.send.buttons({
    body,
    footer: DEMO_FOOTER,
    buttons: [
      { id: LEAD_IDS.book, title: ctx.state.meeting?.status === 'booked' ? 'My demo' : 'Book a demo' },
      { id: LEAD_IDS.pricing, title: 'See pricing' },
      { id: LEAD_IDS.guide, title: 'Free GST guide' },
    ],
  });
}

export async function pricing(ctx: Ctx): Promise<void> {
  const lines = PLANS.map((plan) => `*${plan.name}* · ${plan.price}\n${plan.pitch}`);
  await ctx.send.buttons({
    header: `${COMPANY} plans`,
    body: `${lines.join('\n\n')}\n\nAll plans include unlimited invoices, a 14-day free trial and migration from Tally or Excel.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: LEAD_IDS.book, title: 'Book a demo' },
      { id: LEAD_IDS.guide, title: 'Free GST guide' },
    ],
  });
}

/**
 * The rep's vCard. The phone is the demo number (configurable) so "Message" returns to this
 * chat; never a made-up number that might belong to a real person.
 */
export function repCard(rep: Rep, deps: Deps): ContactCard {
  const phone = deps.config.repPhone;
  return {
    name: { formatted_name: rep.name, first_name: rep.firstName, last_name: rep.lastName },
    org: { company: COMPANY, title: rep.title },
    emails: [{ email: rep.email, type: 'WORK' }],
    ...(phone === null ? {} : { phones: [{ phone, type: 'WORK', wa_id: phone.replace(/\D/g, '') }] }),
  };
}
