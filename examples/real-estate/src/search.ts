import { DEMO_FOOTER, FlowUnavailableError, ui } from '@lazyapp-examples/demo-kit';
import { syncLeadTags } from './crm.js';
import {
  ANY,
  BUDGETS,
  budgetsFor,
  CITIES,
  CITY_NAMES,
  findHomes,
  getListing,
  localitiesIn,
  nearestHomes,
  summaryLine,
} from './listings.js';
import type { City, Listing, Preferences, Purpose } from './listings.js';
import { FLOWS } from './manifest.js';
import { HOME_IDS, MENU_IDS as IDS, SEARCH_IDS } from './ids.js';
import { preferencesSchema } from './state.js';
import type { Ctx } from './types.js';

/** Opens the preferences Flow, or walks the same questions with buttons when it is unavailable. */
export async function startSearch(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'search', draft: { purpose: null, city: null } }));
  try {
    await ctx.flows.send({
      key: FLOWS.search,
      header: 'Find your home',
      body: 'Tell us what you are looking for: buy or rent, city, locality, budget and bedrooms. It takes 20 seconds.',
      cta: 'Set preferences',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await askPurpose(ctx, '(The search form is not available right now, so let us do it with buttons.)\n\n');
  }
}

async function askPurpose(ctx: Ctx, prefix = ''): Promise<void> {
  await ctx.send.buttons({
    body: `${prefix}Are you looking to buy or rent?`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${SEARCH_IDS.purpose}buy`, title: 'Buy' },
      { id: `${SEARCH_IDS.purpose}rent`, title: 'Rent' },
    ],
  });
}

export async function onPurpose(ctx: Ctx, purpose: Purpose): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'search', draft: { purpose, city: null } }));
  await ctx.send.list({
    header: purpose === 'buy' ? 'Homes to buy' : 'Homes to rent',
    body: 'Which city?',
    button: 'Choose city',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Cities',
        rows: CITIES.map((city) => ({
          id: `${SEARCH_IDS.city}${city}`,
          title: CITY_NAMES[city],
          description: localitiesIn(city).join(', '),
        })),
      },
    ],
  });
}

export async function onCity(ctx: Ctx, city: City): Promise<void> {
  const purpose = ctx.state.draft.purpose;
  if (purpose === null) {
    await askPurpose(ctx);
    return;
  }
  ctx.setState((state) => ({ ...state, draft: { purpose, city } }));
  await ctx.send.list({
    header: CITY_NAMES[city],
    body: 'And your budget?',
    button: 'Choose budget',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Budget',
        rows: [
          ...budgetsFor(purpose).map((band) => ({ id: `${SEARCH_IDS.budget}${band.id}`, title: band.title })),
          { id: `${SEARCH_IDS.budget}${ANY}`, title: 'Any budget' },
        ],
      },
    ],
  });
}

export async function onBudget(ctx: Ctx, budget: string): Promise<void> {
  const { purpose, city } = ctx.state.draft;
  if (purpose === null || city === null) {
    await askPurpose(ctx);
    return;
  }
  const known = budget === ANY || BUDGETS.some((band) => band.id === budget && band.purpose === purpose);
  await runSearch(ctx, {
    purpose,
    city,
    locality: null,
    budget: known && budget !== ANY ? budget : null,
    bhk: [],
  });
}

/**
 * Turns the Flow's `complete` payload into preferences. Everything from the client is
 * re-validated: dropdown ids, the "any" sentinels and the bedroom chips.
 */
export function preferencesFromFlow(response: Readonly<Record<string, unknown>>): Preferences | null {
  const text = (value: unknown) =>
    typeof value === 'string' && value !== '' && value !== ANY ? value : null;
  const bedrooms = Array.isArray(response.bedrooms) ? response.bedrooms : [];
  const parsed = preferencesSchema.safeParse({
    purpose: response.purpose,
    city: response.city,
    locality: text(response.locality),
    budget: text(response.budget),
    bhk: bedrooms.map(Number).filter((count) => Number.isInteger(count) && count >= 1 && count <= 4),
  });
  if (!parsed.success) {
    return null;
  }
  const prefs = parsed.data;
  const localityKnown = prefs.locality === null || localitiesIn(prefs.city).includes(prefs.locality);
  const budgetKnown =
    prefs.budget === null ||
    BUDGETS.some((band) => band.id === prefs.budget && band.purpose === prefs.purpose);
  return {
    ...prefs,
    locality: localityKnown ? prefs.locality : null,
    budget: budgetKnown ? prefs.budget : null,
  };
}

export async function runSearch(ctx: Ctx, prefs: Preferences): Promise<void> {
  const { homes, relaxed } = findHomes(prefs);
  ctx.setState((state) => ({
    ...state,
    step: 'results',
    prefs: { ...prefs, bhk: [...prefs.bhk] },
    draft: { purpose: null, city: null },
    results: homes.map((home) => home.id),
  }));
  const where = prefs.locality ?? CITY_NAMES[prefs.city];
  const what = [
    prefs.bhk.length === 0
      ? null
      : `${prefs.bhk.map((count) => (count >= 4 ? '4+' : String(count))).join('/')} BHK`,
    BUDGETS.find((band) => band.id === prefs.budget)?.title ?? null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const note =
    relaxed.length === 0
      ? ''
      : `\nNothing matched exactly, so I widened the ${relaxed.join(', ').replace(/bhk/, 'bedrooms')}.`;
  const headline =
    `${homes.length} ${homes.length === 1 ? 'home' : 'homes'} to ${prefs.purpose} in ${where}` +
    (what === '' ? '' : ` (${what})`) +
    `.${note}`;
  await showHomes(ctx, homes, headline);
  await syncLeadTags(ctx);
}

/** "Homes near me": the five closest projects to a shared location. */
export async function homesNear(ctx: Ctx, latitude: number, longitude: number): Promise<void> {
  const nearby = nearestHomes(latitude, longitude);
  ctx.setState((state) => ({ ...state, step: 'results', results: nearby.map((entry) => entry.listing.id) }));
  const closest = nearby[0];
  const distance = (km: number) => (km < 10 ? km.toFixed(1) : km.toFixed(0));
  await showHomes(
    ctx,
    nearby.map((entry) => entry.listing),
    closest === undefined
      ? 'No homes near you yet.'
      : `The closest Brickfield homes to you; ${closest.listing.name} is ${distance(closest.km)} km away.`,
    new Map(nearby.map((entry) => [entry.listing.id, `${distance(entry.km)} km away`])),
  );
}

export async function askLocation(ctx: Ctx): Promise<void> {
  await ctx.send.locationRequest(
    'Share your location (or drop a pin where you work) and I will show the Brickfield homes closest to it.',
  );
}

/**
 * Two or more homes: a media carousel (photo, one-line spec, two quick replies per card).
 * One home: a single card. None: a way out. Always followed by next steps.
 */
async function showHomes(
  ctx: Ctx,
  homes: readonly Listing[],
  headline: string,
  extra: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  const [first] = homes;
  if (first === undefined) {
    await ctx.send.buttons({
      body: `${headline}\nTry another city or budget, or see what is near you.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: SEARCH_IDS.start, title: 'Change search' },
        { id: IDS.near, title: 'Homes near me' },
      ],
    });
    return;
  }
  if (homes.length === 1) {
    await ctx.send.buttons({
      header: { image: first.image },
      body: `${headline}\n\n*${first.name}*, ${first.locality}\n${summaryLine(first)}\n${first.possession}`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: `${HOME_IDS.view}${first.id}`, title: 'View details' },
        { id: `${HOME_IDS.save}${first.id}`, title: 'Shortlist' },
        { id: SEARCH_IDS.start, title: 'Change search' },
      ],
    });
    return;
  }
  await ctx.send.interactive(
    ui.mediaCarousel(
      `${headline} Swipe to compare.`,
      homes.map((home) => ({
        image: home.image,
        body: [
          `*${home.name}*`,
          `${home.locality} · ${summaryLine(home)}`,
          extra.get(home.id) ?? home.possession,
        ].join('\n'),
        quickReplies: [
          { id: `${HOME_IDS.view}${home.id}`, title: 'View details' },
          { id: `${HOME_IDS.save}${home.id}`, title: 'Shortlist' },
        ],
      })),
    ),
  );
  await ctx.send.buttons({
    body: 'Tap *View details* for photos, a street view, the brochure and visit slots.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: SEARCH_IDS.start, title: 'Change search' },
      { id: IDS.shortlist, title: 'My shortlist' },
      { id: IDS.more, title: 'More options' },
    ],
  });
}

/** Re-shows the last results ("Back to results"). */
export async function showLastResults(ctx: Ctx): Promise<void> {
  const homes = ctx.state.results.flatMap((id) => {
    const listing = getListing(id);
    return listing === undefined ? [] : [listing];
  });
  await showHomes(ctx, homes, homes.length === 0 ? 'No recent search.' : 'Your last search again.');
}

/** Homes like the given one (same city and purpose) for "show me alternatives". */
export function alternativesTo(listing: Listing): Listing[] {
  return findHomes({ purpose: listing.purpose, city: listing.city, locality: null, budget: null, bhk: [] })
    .homes.filter((home) => home.id !== listing.id)
    .slice(0, 5);
}

export async function showAlternatives(ctx: Ctx, listing: Listing, headline: string): Promise<void> {
  const homes = alternativesTo(listing);
  ctx.setState((state) => ({ ...state, step: 'results', results: homes.map((home) => home.id) }));
  await showHomes(ctx, homes, headline);
}
