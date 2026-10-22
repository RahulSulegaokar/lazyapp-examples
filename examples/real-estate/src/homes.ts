import { DEMO_FOOTER, publicAssetUrl } from '@lazyapp-examples/demo-kit';
import { syncLeadTags } from './crm.js';
import { CITY_NAMES, getListing, streetViewUrl, summaryLine } from './listings.js';
import type { Listing } from './listings.js';
import { HOME_IDS, MENU_IDS as IDS, SEARCH_IDS, VISIT_IDS } from './ids.js';
import type { Ctx } from './types.js';

const MAX_SHORTLIST = 10;

/** Full details: photo, specs and a Street View link, then the next steps. */
export async function showDetails(ctx: Ctx, listing: Listing): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'listing', focus: listing.id }));
  await ctx.send.cta({
    header: { image: listing.image },
    body: [
      `*${listing.name}*, ${listing.locality}, ${CITY_NAMES[listing.city]}`,
      summaryLine(listing),
      listing.possession,
      '',
      ...listing.highlights.map((line) => `• ${line}`),
      '',
      `📍 ${listing.address}`,
    ].join('\n'),
    displayText: 'Street view',
    url: streetViewUrl(listing),
    footer: DEMO_FOOTER,
  });
  const saved = ctx.state.shortlist.includes(listing.id);
  await ctx.send.buttons({
    body: `What would you like to do with ${listing.name}?`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.book}${listing.id}`, title: 'Book a site visit' },
      { id: `${HOME_IDS.brochure}${listing.id}`, title: 'Brochure & map' },
      listing.purpose === 'buy'
        ? { id: `${HOME_IDS.emi}${listing.id}`, title: 'EMI for this home' }
        : saved
          ? { id: `${HOME_IDS.unsave}${listing.id}`, title: 'Remove from list' }
          : { id: `${HOME_IDS.save}${listing.id}`, title: 'Shortlist' },
    ],
  });
}

/** The brochure PDF and the project pin, then a nudge towards a visit. */
export async function sendBrochure(ctx: Ctx, listing: Listing): Promise<void> {
  ctx.setState((state) => ({
    ...state,
    focus: listing.id,
    brochures: state.brochures.includes(listing.id) ? state.brochures : [...state.brochures, listing.id],
  }));
  await ctx.send.document(
    publicAssetUrl(ctx.config.publicBaseUrl, ctx.example.id, listing.brochure),
    `${listing.name.replace(/\s+/g, '-')}-brochure.pdf`,
    `${listing.name}: floor plans, specifications and price sheet.`,
  );
  await ctx.send.location({
    latitude: listing.latitude,
    longitude: listing.longitude,
    name: `${listing.name} sales gallery`,
    address: listing.address,
  });
  await ctx.send.buttons({
    body: 'The pin above opens directions to the sales gallery. Want to see it in person?',
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.book}${listing.id}`, title: 'Book a site visit' },
      { id: HOME_IDS.results, title: 'Back to results' },
    ],
  });
  await syncLeadTags(ctx);
}

export async function shortlist(ctx: Ctx, listing: Listing): Promise<void> {
  const current = ctx.state.shortlist;
  if (!current.includes(listing.id) && current.length >= MAX_SHORTLIST) {
    await ctx.send.buttons({
      body: `Your shortlist is full (${MAX_SHORTLIST} homes). Remove one to make room.`,
      footer: DEMO_FOOTER,
      buttons: [{ id: IDS.shortlist, title: 'My shortlist' }],
    });
    return;
  }
  const next = current.includes(listing.id) ? current : [...current, listing.id];
  ctx.setState((state) => ({ ...state, shortlist: next, focus: listing.id }));
  await ctx.send.react('❤️');
  await ctx.send.buttons({
    body: `Saved *${listing.name}* to your shortlist (${next.length} ${next.length === 1 ? 'home' : 'homes'}).`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.book}${listing.id}`, title: 'Book a site visit' },
      { id: IDS.shortlist, title: 'My shortlist' },
      { id: HOME_IDS.results, title: 'Back to results' },
    ],
  });
  await syncLeadTags(ctx);
}

export async function unshortlist(ctx: Ctx, listing: Listing): Promise<void> {
  ctx.setState((state) => ({ ...state, shortlist: state.shortlist.filter((id) => id !== listing.id) }));
  await showShortlist(ctx, `Removed ${listing.name}.`);
}

export async function showShortlist(ctx: Ctx, prefix = ''): Promise<void> {
  const homes = ctx.state.shortlist.flatMap((id) => {
    const listing = getListing(id);
    return listing === undefined ? [] : [listing];
  });
  if (homes.length === 0) {
    await ctx.send.buttons({
      body: `${prefix ? `${prefix}\n\n` : ''}Your shortlist is empty. Tap *Shortlist* on any home to save it here.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: SEARCH_IDS.start, title: 'Find a home' },
        { id: IDS.near, title: 'Homes near me' },
      ],
    });
    return;
  }
  await ctx.send.list({
    header: 'My shortlist',
    body: `${prefix ? `${prefix}\n\n` : ''}Your saved homes. Pick one for details, the brochure or a visit.`,
    button: 'See homes',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Saved homes',
        rows: homes.map((home) => ({
          id: `${HOME_IDS.view}${home.id}`,
          title: home.name,
          description: `${home.locality} · ${summaryLine(home)}`,
        })),
      },
    ],
  });
}
