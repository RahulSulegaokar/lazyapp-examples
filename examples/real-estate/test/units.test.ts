import { readFileSync } from 'node:fs';
import { DemoStore } from '@lazyapp-examples/demo-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { emiQuote, parseLoanAmount, typicalLoanPaise } from '../src/emi.js';
import { queryAfterStartCode } from '../src/index.js';
import { findHomes, formatPrice, LISTINGS, nearestHomes, parseQuery } from '../src/listings.js';
import { manifest } from '../src/manifest.js';
import {
  formatWhen,
  isBookable,
  openSlotsOn,
  reserveSlot,
  SLOT_CAPACITY,
  upcomingDays,
} from '../src/schedule.js';
import { scoreLead, tagDiff, tagsFor } from '../src/scoring.js';
import { initialRealEstateState } from '../src/state.js';
import { cancelVisit, followUpPlan, placeVisit, visitIdFrom } from '../src/visits.js';

const NOW = new Date('2026-10-23T09:00:00+05:30');
const stores: DemoStore[] = [];
const kv = () => {
  const store = new DemoStore(':memory:');
  stores.push(store);
  return store.keyValue('example:real-estate', () => NOW);
};
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe('listings', () => {
  it('formats prices the way Indian listings do', () => {
    expect(formatPrice({ purpose: 'buy', pricePaise: 92 * 1_00_000 * 100 })).toBe('₹92 L');
    expect(formatPrice({ purpose: 'buy', pricePaise: 148 * 1_00_000 * 100 })).toBe('₹1.48 Cr');
    expect(formatPrice({ purpose: 'buy', pricePaise: 390 * 1_00_000 * 100 })).toBe('₹3.9 Cr');
    expect(formatPrice({ purpose: 'rent', pricePaise: 42_000 * 100 })).toBe('₹42,000/mo');
  });

  it('matches exactly first, then relaxes locality, bedrooms and budget in that order', () => {
    expect(
      findHomes({ purpose: 'buy', city: 'pune', locality: 'Baner', budget: 'buy-150', bhk: [2] }),
    ).toMatchObject({ homes: [{ id: 'pune-baner' }], relaxed: [] });
    expect(
      findHomes({ purpose: 'buy', city: 'pune', locality: 'Kharadi', budget: 'buy-150', bhk: [2] }),
    ).toMatchObject({ homes: [{ id: 'pune-baner' }], relaxed: ['locality'] });
    expect(
      findHomes({ purpose: 'buy', city: 'pune', locality: null, budget: 'buy-max', bhk: [4] }).relaxed,
    ).toEqual(['locality', 'bhk', 'budget']);
  });

  it('treats 4 bedrooms as "4 or more"', () => {
    expect(
      findHomes({ purpose: 'buy', city: 'hyderabad', locality: null, budget: null, bhk: [4] }).homes.map(
        (home) => home.id,
      ),
    ).toEqual(['hyd-kokapet']);
  });

  it('reads typed searches with city aliases, localities and bedrooms', () => {
    expect(parseQuery('2bhk to rent in bangalore')).toEqual({
      purpose: 'rent',
      city: 'bengaluru',
      locality: null,
      budget: null,
      bhk: [2],
    });
    expect(parseQuery('3 BHK Baner')).toMatchObject({
      purpose: 'buy',
      city: 'pune',
      locality: 'Baner',
      bhk: [3],
    });
    expect(parseQuery('5 bhk bombay')).toMatchObject({ city: 'mumbai', bhk: [4] });
    expect(parseQuery('cheap flat please')).toBeNull();
  });

  it('only searches from the start message when it carries a query', () => {
    expect(queryAfterStartCode('DEMO HOMES - 2 BHK in Pune')).toMatchObject({
      text: '2 BHK in Pune',
      prefs: { city: 'pune' },
    });
    expect(queryAfterStartCode('DEMO HOMES')).toBeNull();
    expect(queryAfterStartCode('demo homes hello')).toBeNull();
  });

  it('sorts homes by distance', () => {
    const [closest] = nearestHomes(17.44, 78.35);
    expect(closest?.listing.id).toBe('hyd-gachibowli');
    expect(closest?.km).toBeLessThan(1);
  });

  it('ships a brochure for every listing', () => {
    for (const listing of LISTINGS) {
      const pdf = readFileSync(new URL(`../public/${listing.brochure}`, import.meta.url));
      expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    }
  });
});

describe('EMI maths', () => {
  it('matches the standard amortisation formula', () => {
    const quote = emiQuote(50 * 1_00_000 * 100, 8.5, 20);
    expect(quote.emiPaise).toBe(43_391 * 100);
    expect(quote.totalPaidPaise).toBe(43_391 * 100 * 240);
    expect(quote.totalInterestPaise).toBe(quote.totalPaidPaise - quote.principalPaise);
    expect(quote.incomeNeededPaise).toBe(87_000 * 100);
  });

  it('parses loan amounts the way people type them', () => {
    expect(parseLoanAmount('7500000')).toBe(75 * 1_00_000 * 100);
    expect(parseLoanAmount('₹75,00,000')).toBe(75 * 1_00_000 * 100);
    expect(parseLoanAmount('60 lakh')).toBe(60 * 1_00_000 * 100);
    expect(parseLoanAmount('1.2 cr')).toBe(120 * 1_00_000 * 100);
    expect(parseLoanAmount('Rs. 45L')).toBe(45 * 1_00_000 * 100);
    expect(parseLoanAmount('400000')).toBeNull();
    expect(parseLoanAmount('lots')).toBeNull();
  });

  it('lends 80% of the price, rounded to the lakh', () => {
    expect(typicalLoanPaise(92 * 1_00_000 * 100)).toBe(74 * 1_00_000 * 100);
  });
});

describe('visit calendar', () => {
  it('lists IST days and formats visit times', () => {
    expect(upcomingDays(new Date('2026-10-23T20:00:00Z'), 2)).toEqual([
      { id: '2026-10-24', title: 'Sat, 24 Oct' },
      { id: '2026-10-25', title: 'Sun, 25 Oct' },
    ]);
    expect(formatWhen(new Date('2026-10-24T06:00:00Z'))).toBe('Sat, 24 Oct at 11:30 AM');
  });

  it('needs two hours of notice and a known slot', () => {
    expect(isBookable('2026-10-23', '10:00', NOW)).toBe(false);
    expect(isBookable('2026-10-23', '11:30', NOW)).toBe(true);
    expect(isBookable('2026-10-23', '11:45', NOW)).toBe(false);
    expect(isBookable('2026-11-30', '11:30', NOW)).toBe(false);
  });

  it('fills a slot to capacity and frees it on cancel', () => {
    const store = kv();
    const at = new Date('2026-10-24T04:30:00Z');
    for (let index = 0; index < SLOT_CAPACITY; index += 1) {
      expect(reserveSlot(store, 'blr-aurora', at, `V-${index}`)).toBe(true);
    }
    expect(reserveSlot(store, 'blr-aurora', at, 'V-late')).toBe(false);
    expect(reserveSlot(store, 'blr-aurora', at, 'V-0')).toBe(true);
    expect(openSlotsOn(store, 'blr-aurora', '2026-10-24', NOW).map((slot) => slot.time)).not.toContain(
      '10:00',
    );
  });
});

describe('visits', () => {
  const request = {
    visitId: visitIdFrom('flow-token-1'),
    listingId: 'blr-aurora',
    dayId: '2026-10-24',
    time: '10:00',
    name: 'Asha',
    party: 'solo' as const,
    rescheduleOf: null,
  };

  it('derives short, unambiguous ids', () => {
    expect(visitIdFrom('a')).toMatch(/^V-[2-9A-HJ-NP-Z]{6}$/);
    expect(visitIdFrom('a')).toBe(visitIdFrom('a'));
    expect(visitIdFrom('a')).not.toBe(visitIdFrom('b'));
  });

  it('is idempotent per visit id (a retried data_exchange takes one place)', () => {
    const store = kv();
    const first = placeVisit(store, initialRealEstateState(), request, NOW);
    if (!first.ok) {
      throw new Error('expected a booking');
    }
    const again = placeVisit(store, first.state, request, NOW);
    expect(again).toMatchObject({ ok: true, visit: { id: request.visitId } });
    expect(again.ok && again.state.visits).toHaveLength(1);
    expect(store.list('slot:')).toEqual([
      { key: 'slot:blr-aurora:2026-10-24T04:30:00.000Z', value: [request.visitId] },
    ]);
  });

  it('refuses unknown listings, past slots and reschedules of visits that do not exist', () => {
    const store = kv();
    const state = initialRealEstateState();
    expect(placeVisit(store, state, { ...request, listingId: 'nope' }, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(placeVisit(store, state, { ...request, dayId: '2026-10-22' }, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(placeVisit(store, state, { ...request, rescheduleOf: 'V-NOPE22' }, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('cancels once and frees the slot', () => {
    const store = kv();
    const booked = placeVisit(store, initialRealEstateState(), request, NOW);
    if (!booked.ok) {
      throw new Error('expected a booking');
    }
    const cancelled = cancelVisit(store, booked.state, request.visitId);
    expect(cancelled.visits[0]?.status).toBe('cancelled');
    expect(store.list('slot:')).toEqual([]);
    expect(cancelVisit(store, cancelled, request.visitId)).toBe(cancelled);
  });

  it('plans follow-ups: compressed in the demo, around the visit in production', () => {
    const visitAt = new Date('2026-10-24T12:00:00Z');
    expect(followUpPlan(visitAt, NOW, 'demo')).toEqual({
      reminderAt: new Date(NOW.getTime() + 2 * 60_000),
      feedbackAt: new Date(NOW.getTime() + 7 * 60_000),
    });
    expect(followUpPlan(visitAt, NOW, 'production')).toEqual({
      reminderAt: new Date('2026-10-24T09:00:00Z'),
      feedbackAt: new Date('2026-10-24T14:00:00Z'),
    });
    expect(followUpPlan(new Date(NOW.getTime() + 3 * 3_600_000), NOW, 'production').reminderAt).toBeNull();
  });
});

describe('lead scoring', () => {
  it('weighs actions, not words', () => {
    const state = initialRealEstateState();
    expect(scoreLead(state)).toEqual({ score: 0, temperature: 'cold', signals: [] });
    expect(
      scoreLead({ ...state, shortlist: ['a', 'b', 'c', 'd'], emiQuotes: 1, brochures: ['a'] }),
    ).toMatchObject({ score: 35, temperature: 'warm' });
  });

  it('tags purpose, city, temperature and bookings, and diffs them', () => {
    const state = {
      ...initialRealEstateState(),
      prefs: { purpose: 'rent' as const, city: 'pune' as const, locality: null, budget: null, bhk: [] },
    };
    expect(tagsFor(state)).toEqual([
      'demo-homes',
      'demo-homes:city-pune',
      'demo-homes:cold',
      'demo-homes:rent',
    ]);
    expect(tagDiff(['demo-homes', 'demo-homes:cold'], ['demo-homes', 'demo-homes:warm'])).toEqual({
      add: ['demo-homes:warm'],
      remove: ['demo-homes:cold'],
    });
  });
});

describe('manifest', () => {
  it('names every template demo_real_estate_* and keeps variables off the edges and apart', () => {
    for (const spec of manifest.templates ?? []) {
      expect(spec.input.name).toMatch(/^demo_real_estate_[a-z_]+$/);
      if (spec.kind !== 'standard') {
        continue;
      }
      const body = spec.input.body_text ?? '';
      expect(body).not.toMatch(/^\s*\{\{|\}\}[.!?]?\s*$/);
      expect(body).not.toMatch(/\}\}\s*\{\{/);
      expect(body.match(/\{\{\d+\}\}/g)?.length ?? 0).toBe(spec.input.body_examples?.length ?? 0);
    }
  });

  it('reads its settings from the environment', () => {
    expect(configFromEnv({})).toEqual({ agentPhone: null, reminders: 'demo', useEvents: false });
    expect(
      configFromEnv({
        DEMO_PHONE_NUMBER: '+91 98765 43210',
        REAL_ESTATE_REMINDERS: 'production',
        REAL_ESTATE_USE_EVENTS: 'true',
      }),
    ).toEqual({ agentPhone: '+919876543210', reminders: 'production', useEvents: true });
  });
});
