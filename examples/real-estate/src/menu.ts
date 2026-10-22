import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { ContactCard } from '@lazyapp-examples/sdk';
import { syncLeadTags } from './crm.js';
import { MENU_IDS as IDS } from './ids.js';
import { agentFor, BRAND_IMAGE, CITY_NAMES, getListing } from './listings.js';
import type { Agent, City } from './listings.js';
import type { Ctx, Deps } from './types.js';

/** First message: a branded card with the three things most people came for. */
export async function welcome(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  const name = ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`;
  await ctx.send.buttons({
    header: { image: BRAND_IMAGE },
    body:
      `Namaste${name}! 🏡 Welcome to *Brickfield Homes*.\n\n` +
      'Search homes to buy or rent in Bengaluru, Pune, Mumbai and Hyderabad, get brochures, check your EMI ' +
      'and book a site visit, all in this chat.\n\nTip: you can also just type what you want, like ' +
      '"2 BHK to rent in Pune".',
    footer: DEMO_FOOTER,
    buttons: [
      { id: IDS.search, title: 'Find a home' },
      { id: IDS.near, title: 'Homes near me' },
      { id: IDS.more, title: 'More options' },
    ],
  });
}

/** The full menu ("MENU" or "More options"). */
export async function menu(ctx: Ctx, body = 'What would you like to do?'): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu' }));
  const saved = ctx.state.shortlist.length;
  const booked = ctx.state.visits.filter((visit) => visit.status === 'booked').length;
  await ctx.send.list({
    header: 'Brickfield Homes',
    body,
    button: 'Open menu',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Find a home',
        rows: [
          { id: IDS.search, title: 'Search homes', description: 'City, locality, budget and bedrooms' },
          {
            id: IDS.near,
            title: 'Homes near me',
            description: 'Share your location, see the closest projects',
          },
        ],
      },
      {
        title: 'Your homes',
        rows: [
          {
            id: IDS.shortlist,
            title: 'My shortlist',
            description: saved === 0 ? 'Homes you save show up here' : `${saved} saved`,
          },
          {
            id: IDS.visits,
            title: 'My site visits',
            description: booked === 0 ? 'Book, move or cancel visits' : `${booked} booked`,
          },
        ],
      },
      {
        title: 'Help',
        rows: [
          { id: IDS.emi, title: 'EMI calculator', description: 'Monthly EMI and the income lenders expect' },
          { id: IDS.advisor, title: 'Talk to an advisor', description: 'Get your relationship manager' },
        ],
      },
    ],
  });
}

/** The city the buyer cares about right now: the home in focus, else their search. */
export function currentCity(ctx: Ctx): City {
  const focus = ctx.state.focus === null ? undefined : getListing(ctx.state.focus);
  return focus?.city ?? ctx.state.prefs?.city ?? 'bengaluru';
}

/**
 * A vCard for the agent. The phone is the demo number (configurable), so "Message" on the
 * card returns to this chat; a demo must never hand out a made-up number someone might own.
 */
export function agentCard(agent: Agent, deps: Deps): ContactCard {
  const phone = deps.config.agentPhone;
  return {
    name: { formatted_name: agent.name, first_name: agent.firstName, last_name: agent.lastName },
    org: { company: 'Brickfield Homes', title: `Relationship manager, ${CITY_NAMES[agent.city]}` },
    emails: [{ email: agent.email, type: 'WORK' }],
    ...(phone === null ? {} : { phones: [{ phone, type: 'WORK', wa_id: phone.replace(/\D/g, '') }] }),
  };
}

export async function advisor(ctx: Ctx, deps: Deps): Promise<void> {
  const agent = agentFor(currentCity(ctx));
  ctx.setState((state) => ({ ...state, advisorRequested: true }));
  await ctx.send.contacts([agentCard(agent, deps)]);
  await ctx.send.buttons({
    body:
      `Meet *${agent.name}*, your relationship manager for ${CITY_NAMES[agent.city]}. Save the card above; ` +
      `${agent.firstName} has your search, shortlist and visits, so you never repeat yourself.\n\n` +
      '_Demo: in production this assigns the chat to the agent in the LazyApp inbox._',
    footer: DEMO_FOOTER,
    buttons: [
      { id: IDS.visits, title: 'My site visits' },
      { id: IDS.search, title: 'Find a home' },
    ],
  });
  await syncLeadTags(ctx);
}
