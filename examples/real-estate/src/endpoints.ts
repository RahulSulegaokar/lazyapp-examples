import { formatInr } from '@lazyapp-examples/demo-kit';
import type {
  FlowEndpointHandler,
  FlowExchangeContext,
  FlowExchangeResponse,
} from '@lazyapp-examples/demo-kit';
import {
  DEFAULT_RATE,
  DEFAULT_TENURE,
  emiQuote,
  isRate,
  isTenure,
  parseLoanAmount,
  RATES,
  TENURE_YEARS,
} from './emi.js';
import { ANY, budgetsFor, CITIES, CITY_NAMES, formatPrice, getListing, localitiesIn } from './listings.js';
import type { City, Purpose } from './listings.js';
import { defaultLoan } from './loan.js';
import { formatTime, formatWhen, openDays, openSlotsOn } from './schedule.js';
import type { RealEstateState } from './state.js';
import { findVisit, placeVisit, visitIdFrom } from './visits.js';

/**
 * WhatsApp Flow data endpoints. LazyApp decrypts Meta's request, signs it and forwards it
 * here; the router has already checked the flow token belongs to a live session. Handlers
 * answer with the next screen's data, or SUCCESS to close the flow.
 */

type FlowCtx = FlowExchangeContext<RealEstateState>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

// --- Search ------------------------------------------------------------------------

function isCity(value: string): value is City {
  return (CITIES as readonly string[]).includes(value);
}

/** Everything the PREFERENCES screen shows, for the current purpose and city. */
export function searchScreenData(purpose: Purpose, city: City | null): Record<string, unknown> {
  return {
    intro: 'Tell us what you are looking for. Localities and budgets update as you pick.',
    purposes: [
      { id: 'buy', title: 'Buy' },
      { id: 'rent', title: 'Rent' },
    ],
    cities: CITIES.map((id) => ({ id, title: CITY_NAMES[id] })),
    localities: [
      { id: ANY, title: city === null ? 'Pick a city first' : `Anywhere in ${CITY_NAMES[city]}` },
      ...(city === null ? [] : localitiesIn(city).map((locality) => ({ id: locality, title: locality }))),
    ],
    budgets: [
      { id: ANY, title: 'Any budget' },
      ...budgetsFor(purpose).map((band) => ({ id: band.id, title: band.title })),
    ],
    bedrooms: [
      { id: '1', title: '1 BHK' },
      { id: '2', title: '2 BHK' },
      { id: '3', title: '3 BHK' },
      { id: '4', title: '4+ BHK' },
    ],
  };
}

const search: FlowEndpointHandler<RealEstateState> = async (ctx, request) => {
  const purpose: Purpose = str(request.data?.purpose) === 'rent' ? 'rent' : 'buy';
  const city = str(request.data?.city);
  const preferred = ctx.state.prefs?.city ?? null;
  return {
    screen: 'PREFERENCES',
    data: searchScreenData(purpose, isCity(city) ? city : request.action === 'INIT' ? preferred : null),
  };
};

// --- EMI --------------------------------------------------------------------------------

function loanScreen(ctx: FlowCtx, error?: string): FlowExchangeResponse {
  const listing = ctx.state.focus === null ? undefined : getListing(ctx.state.focus);
  const loan = defaultLoan(ctx.state.focus);
  return {
    screen: 'LOAN',
    data: {
      home: listing?.purpose === 'buy' ? `${listing.name}, ${listing.locality}` : 'Home loan',
      price_line:
        listing?.purpose === 'buy'
          ? `Price ${formatPrice(listing)} · typical loan ${formatInr(loan)} (80%)`
          : `A typical loan of ${formatInr(loan)} to start with`,
      loan_amount: String(loan / 100),
      tenures: TENURE_YEARS.map((years) => ({ id: String(years), title: `${years} years` })),
      rates: RATES.map((rate) => ({ id: rate, title: `${rate}% p.a.` })),
      tenure: String(DEFAULT_TENURE),
      rate: DEFAULT_RATE,
      ...(error === undefined ? {} : { error_message: error }),
    },
  };
}

const emi: FlowEndpointHandler<RealEstateState> = async (ctx, request) => {
  if (request.action !== 'data_exchange') {
    return loanScreen(ctx);
  }
  const loan = parseLoanAmount(str(request.data?.loan_amount));
  const tenure = Number(request.data?.tenure);
  const rate = str(request.data?.rate);
  if (loan === null) {
    return loanScreen(ctx, 'Enter a loan between ₹5 lakh and ₹20 crore.');
  }
  const quote = emiQuote(
    loan,
    isRate(rate) ? Number(rate) : Number(DEFAULT_RATE),
    isTenure(tenure) ? tenure : DEFAULT_TENURE,
  );
  return {
    screen: 'RESULT',
    data: {
      emi_line: `${formatInr(quote.emiPaise)} per month`,
      loan_line: `Loan ${formatInr(quote.principalPaise)} for ${quote.tenureYears} years at ${quote.annualRatePercent}%`,
      interest_line: `Total interest ${formatInr(quote.totalInterestPaise)}`,
      total_line: `Total repayment ${formatInr(quote.totalPaidPaise)}`,
      income_line: `Lenders look for a take-home of about ${formatInr(quote.incomeNeededPaise)} a month.`,
      loan_amount: String(quote.principalPaise / 100),
      tenure: String(quote.tenureYears),
      rate: isRate(rate) ? rate : DEFAULT_RATE,
      emi: String(quote.emiPaise),
    },
  };
};

// --- Site visit -------------------------------------------------------------------------

function scheduleScreen(
  ctx: FlowCtx,
  listingId: string,
  dayId: string | null,
  error?: string,
): FlowExchangeResponse {
  const listing = getListing(listingId);
  const now = ctx.now();
  const days = openDays(ctx.kv, listingId, now);
  const slots = dayId === null ? [] : openSlotsOn(ctx.kv, listingId, dayId, now);
  const rescheduling = ctx.state.pendingVisit?.rescheduleOf ?? null;
  const current = rescheduling === null ? undefined : findVisit(ctx.state, rescheduling);
  return {
    screen: 'SCHEDULE',
    data: {
      home: `${listing?.name ?? 'Site visit'}, ${listing?.locality ?? ''}`,
      address:
        current === undefined
          ? (listing?.address ?? '')
          : `Moving your visit on ${formatWhen(new Date(current.at))}`,
      days: days.map((day) => ({ id: day.id, title: day.title })),
      slots: slots.map((slot) => ({ id: slot.time, title: formatTime(slot.time) })),
      slots_visible: slots.length > 0,
      name: current?.name ?? ctx.user.displayName ?? '',
      ...(error === undefined ? {} : { error_message: error }),
    },
  };
}

const visit: FlowEndpointHandler<RealEstateState> = async (ctx, request) => {
  const pending = ctx.state.pendingVisit;
  if (pending === null) {
    throw new Error('visit flow opened without a pending visit');
  }
  if (request.action !== 'data_exchange') {
    return scheduleScreen(ctx, pending.listingId, null);
  }
  const day = str(request.data?.day);
  if (str(request.data?.trigger) !== 'confirm') {
    const open = openSlotsOn(ctx.kv, pending.listingId, day, ctx.now());
    return scheduleScreen(
      ctx,
      pending.listingId,
      day,
      open.length === 0 ? 'No slots left that day. Pick another day.' : undefined,
    );
  }
  const name = str(request.data?.name).trim().slice(0, 60);
  const result = placeVisit(
    ctx.kv,
    ctx.state,
    {
      visitId: visitIdFrom(request.flow_token),
      listingId: pending.listingId,
      dayId: day,
      time: str(request.data?.time),
      name: name === '' ? (ctx.user.displayName ?? 'Guest') : name,
      party: str(request.data?.party) === 'family' ? 'family' : 'solo',
      rescheduleOf: pending.rescheduleOf,
    },
    ctx.now(),
  );
  if (!result.ok) {
    return scheduleScreen(
      ctx,
      pending.listingId,
      day,
      result.reason === 'taken' ? 'That slot was just taken. Pick another time.' : 'Pick a day and a time.',
    );
  }
  ctx.setState(result.state);
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: { flow_token: request.flow_token, flow: 'visit', visit_id: result.visit.id },
      },
    },
  };
};

export const flowEndpoints: Readonly<Record<string, FlowEndpointHandler<RealEstateState>>> = {
  search,
  emi,
  visit,
};
