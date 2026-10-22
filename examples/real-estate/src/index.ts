import { defineExample, DEMO_FOOTER, normalizeCommandText } from '@lazyapp-examples/demo-kit';
import type { Example, Inbound } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import {
  askCancel,
  cancel,
  directions,
  onFeedback,
  onMessageFailed,
  onSlotPicked,
  onVisitFlowCompleted,
  openVisit,
  reschedule,
  showVisits,
  startBooking,
} from './booking.js';
import { configFromEnv } from './config.js';
import type { RealEstateConfig } from './config.js';
import { flowEndpoints } from './endpoints.js';
import { sendBrochure, shortlist, showDetails, showShortlist, unshortlist } from './homes.js';
import { FEEDBACK_PREFIX, HOME_IDS, MENU_IDS, SEARCH_IDS, VISIT_IDS } from './ids.js';
import { CITIES, getListing, parseQuery } from './listings.js';
import type { City, Listing } from './listings.js';
import { onEmiCompleted, quoteInChat, startEmi } from './loan.js';
import { EXAMPLE_ID, manifest, START_CODE } from './manifest.js';
import { advisor, menu, welcome } from './menu.js';
import { parseLoanAmount } from './emi.js';
import {
  askLocation,
  homesNear,
  onBudget,
  onCity,
  onPurpose,
  preferencesFromFlow,
  runSearch,
  showLastResults,
  startSearch,
} from './search.js';
import { initialRealEstateState, realEstateStateSchema } from './state.js';
import type { FeedbackRating, RealEstateState } from './state.js';
import type { Ctx, Deps } from './types.js';
import { findVisit } from './visits.js';

/**
 * Brickfield Homes: property search to site visit, in WhatsApp.
 *
 * Built as a factory so tests (and anyone embedding it) pass configuration explicitly;
 * the default export reads it from the environment.
 */
export function createRealEstateExample(config: RealEstateConfig): Example<RealEstateState> {
  const deps: Deps = { config };

  return defineExample<RealEstateState>({
    id: EXAMPLE_ID,
    title: 'Brickfield Homes',
    startCode: START_CODE,
    manifest,
    stateSchema: realEstateStateSchema,
    initialState: initialRealEstateState,
    flowEndpoints,
    describe: () => ({
      summary: 'Property search to site visit: Flows, listing carousels, brochures, EMI and agent hand-off.',
      metaFeatures: [
        'WhatsApp Flows (data exchange)',
        'Media carousel',
        'CTA URL button',
        'Reply buttons',
        'List messages',
        'Document (PDF brochure)',
        'Location + location request',
        'Contact card',
        'Reactions',
        'Utility templates (location header, quick replies)',
        'Scheduled follow-ups',
        'Contact tags',
        'Events API',
      ],
      emoji: '🏡',
    }),

    async onStart(ctx, inbound) {
      const query = inbound.kind === 'text' ? queryAfterStartCode(inbound.text) : null;
      if (query !== null) {
        await ctx.send.text(`Welcome to Brickfield Homes! Searching for "${query.text}"…`);
        await runSearch(ctx, query.prefs);
        return;
      }
      await welcome(ctx);
    },

    async onMenu(ctx) {
      await menu(ctx);
    },

    async onMessage(ctx, inbound) {
      switch (inbound.kind) {
        case 'button':
        case 'list':
          return onChoice(ctx, inbound.id);
        case 'flow':
          return onFlow(ctx, inbound.response);
        case 'location':
          return homesNear(ctx, inbound.latitude, inbound.longitude);
        case 'text':
          return onText(ctx, inbound.text);
        default:
          return onUnexpected(ctx, inbound);
      }
    },

    async onEvent(ctx, event) {
      if (isEventType(event, 'message.failed')) {
        await onMessageFailed(ctx, event.data.message.uuid);
      }
    },
  });

  async function onChoice(ctx: Ctx, id: string): Promise<void> {
    const [scope = '', action = '', ...rest] = id.split(':');
    const argument = rest.join(':');
    const listing = getListing(argument);
    const visit = findVisit(ctx.state, argument);

    if (scope === 'menu') {
      return onMenuChoice(ctx, id);
    }
    if (id === SEARCH_IDS.start) {
      return startSearch(ctx);
    }
    if (id.startsWith(SEARCH_IDS.purpose)) {
      return onPurpose(ctx, argument === 'rent' ? 'rent' : 'buy');
    }
    if (id.startsWith(SEARCH_IDS.city) && isCity(argument)) {
      return onCity(ctx, argument);
    }
    if (id.startsWith(SEARCH_IDS.budget)) {
      return onBudget(ctx, argument);
    }
    if (id === HOME_IDS.results) {
      return showLastResults(ctx);
    }
    if (id.startsWith(VISIT_IDS.slot)) {
      return onSlotPicked(ctx, deps, argument);
    }
    if (scope === 'home' && listing !== undefined) {
      return onHome(ctx, action, listing);
    }
    if (scope === 'visit' && action === 'book' && listing !== undefined) {
      return startBooking(ctx, listing);
    }
    if (scope === 'visit' && visit?.status === 'booked') {
      switch (action) {
        case 'open':
          return openVisit(ctx, visit);
        case 'reschedule':
          return reschedule(ctx, visit);
        case 'cancel':
          return askCancel(ctx, visit);
        case 'cancel-yes':
          return cancel(ctx, deps, visit);
        case 'directions':
          return directions(ctx, visit);
      }
    }
    if (id.startsWith(FEEDBACK_PREFIX) && visit !== undefined && isRating(action)) {
      return onFeedback(ctx, visit, action);
    }
    await menu(ctx, 'That option has expired (the home or visit may have changed). Here is the menu:');
  }

  async function onMenuChoice(ctx: Ctx, id: string): Promise<void> {
    switch (id) {
      case MENU_IDS.search:
        return startSearch(ctx);
      case MENU_IDS.near:
        return askLocation(ctx);
      case MENU_IDS.shortlist:
        return showShortlist(ctx);
      case MENU_IDS.visits:
        return showVisits(ctx);
      case MENU_IDS.emi:
        return startEmi(ctx);
      case MENU_IDS.advisor:
        return advisor(ctx, deps);
      default:
        return menu(ctx);
    }
  }

  async function onHome(ctx: Ctx, action: string, listing: Listing): Promise<void> {
    switch (action) {
      case 'view':
        return showDetails(ctx, listing);
      case 'save':
        return shortlist(ctx, listing);
      case 'unsave':
        return unshortlist(ctx, listing);
      case 'brochure':
        return sendBrochure(ctx, listing);
      case 'emi':
        ctx.setState((state) => ({ ...state, focus: listing.id }));
        return startEmi(ctx);
      default:
        return showDetails(ctx, listing);
    }
  }

  async function onFlow(ctx: Ctx, response: Readonly<Record<string, unknown>>): Promise<void> {
    switch (response.flow) {
      case 'search': {
        const prefs = preferencesFromFlow(response);
        return prefs === null ? startSearch(ctx) : runSearch(ctx, prefs);
      }
      case 'emi':
        return onEmiCompleted(ctx, response);
      case 'visit':
        return onVisitFlowCompleted(ctx, deps, response.visit_id);
      default:
        return menu(ctx, 'That form is from an older message. Here is the menu:');
    }
  }

  /** Typed text: a property search ("3 bhk in baner"), a loan amount on the EMI step, or help. */
  async function onText(ctx: Ctx, text: string): Promise<void> {
    if (ctx.state.step === 'emi') {
      const loan = parseLoanAmount(text);
      if (loan !== null) {
        return quoteInChat(ctx, loan);
      }
    }
    const prefs = parseQuery(text);
    if (prefs !== null) {
      return runSearch(ctx, prefs);
    }
    await ctx.send.buttons({
      body:
        "I didn't catch that. Try typing a search like *2 BHK to rent in Pune* or *3 BHK Whitefield*, " +
        'or pick an option below.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.search, title: 'Find a home' },
        { id: MENU_IDS.near, title: 'Homes near me' },
        { id: MENU_IDS.more, title: 'More options' },
      ],
    });
  }

  async function onUnexpected(ctx: Ctx, inbound: Inbound): Promise<void> {
    if (inbound.kind === 'reaction') {
      return;
    }
    if (inbound.kind === 'media' || inbound.kind === 'contacts') {
      await ctx.send.react('👍');
    }
    await menu(ctx, 'This demo works with taps and short searches. Here is what you can do:');
  }
}

/**
 * "DEMO HOMES 2 BHK in Pune" (the ice breaker, a QR prefill, an ad) searches straight away.
 * Returns null when nothing after the start code reads as a search.
 */
export function queryAfterStartCode(
  text: string,
): { text: string; prefs: NonNullable<ReturnType<typeof parseQuery>> } | null {
  const normalized = normalizeCommandText(text);
  if (!normalized.startsWith(START_CODE)) {
    return null;
  }
  const rest = text
    .trim()
    .slice(START_CODE.length)
    .replace(/^[\s:,.–-]+/, '')
    .trim();
  const prefs = rest === '' ? null : parseQuery(rest);
  return prefs === null ? null : { text: rest, prefs };
}

function isCity(value: string): value is City {
  return (CITIES as readonly string[]).includes(value);
}

function isRating(value: string): value is FeedbackRating {
  return value === 'loved' || value === 'okay' || value === 'no';
}

export default createRealEstateExample(configFromEnv(process.env));
