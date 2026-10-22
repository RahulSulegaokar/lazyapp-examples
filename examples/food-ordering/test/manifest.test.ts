import { describe, expect, it } from 'vitest';
import food from '../src/index.js';
import { manifest } from '../src/manifest.js';
import { bill, LoyaltyLedger, redeemablePoints } from '../src/pricing.js';
import { bookableTimes, dayLabel, laterSlots } from '../src/schedule.js';
import { etaMinutes, nearestOutlet } from '../src/kitchen.js';
import { TableBook, book } from '../src/bookings.js';
import { DemoStore } from '@lazyapp-examples/demo-kit';

/** Meta's template rules that reviews reject most often, checked before anything is submitted. */
describe('food-ordering manifest', () => {
  for (const spec of manifest.templates ?? []) {
    if (spec.kind !== 'standard') {
      continue;
    }
    const { input } = spec;
    describe(input.name, () => {
      const body = input.body_text ?? '';
      const variables = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));

      it('is namespaced to the example', () => {
        expect(input.name.startsWith(`demo_${food.id.replace(/-/g, '_')}_`)).toBe(true);
      });

      it('numbers variables from 1 with an example for each', () => {
        expect(variables).toEqual(variables.map((_value, index) => index + 1));
        expect(input.body_examples ?? []).toHaveLength(variables.length);
      });

      it('never starts or ends with a variable, or puts two side by side', () => {
        expect(body.trim()).not.toMatch(/^\{\{/);
        expect(body.trim()).not.toMatch(/\}\}$/);
        expect(body).not.toMatch(/\}\}\s*\{\{/);
      });

      it('fits Meta limits', () => {
        expect(body.length).toBeLessThanOrEqual(input.limited_time_offer === undefined ? 1024 : 600);
        expect((input.footer_text ?? '').length).toBeLessThanOrEqual(60);
        for (const button of input.buttons ?? []) {
          if ('text' in button && typeof button.text === 'string') {
            expect(button.text.length).toBeLessThanOrEqual(25);
          }
        }
        if (input.limited_time_offer !== undefined) {
          expect(input.category).toBe('MARKETING');
          expect(input.footer_text).toBeUndefined();
          expect(input.limited_time_offer.text.length).toBeLessThanOrEqual(16);
        }
      });
    });
  }

  for (const flow of manifest.flows ?? []) {
    it(`flow ${flow.key} is valid Flow JSON with reachable screens`, () => {
      const json = flow.flowJson as {
        version: string;
        routing_model?: Record<string, string[]>;
        screens: { id: string; terminal?: boolean; layout: { children: { type: string }[] } }[];
      };
      expect(Number(json.version)).toBeGreaterThanOrEqual(6);
      const ids = new Set(json.screens.map((screen) => screen.id));
      for (const [from, targets] of Object.entries(json.routing_model ?? {})) {
        expect(ids.has(from)).toBe(true);
        for (const target of targets) {
          expect(ids.has(target)).toBe(true);
        }
      }
      expect(flow.dataExchange).toBe(json.routing_model !== undefined);
      for (const screen of json.screens.filter((entry) => entry.terminal === true)) {
        expect(screen.layout.children.some((child) => child.type === 'Footer')).toBe(true);
      }
      expect(food.flowEndpoints?.[flow.key] !== undefined).toBe(flow.dataExchange);
    });
  }
});

describe('food-ordering domain', () => {
  const lunch = new Date('2026-10-23T13:00:00+05:30');

  it('prices GST on food after points, packaging and the delivery threshold', () => {
    const cart = [{ itemId: 'ml-samosa', size: null, spice: null, addOns: [], qty: 2, note: null }];
    expect(bill(cart, { mode: 'delivery', pointsBalance: 0, usePoints: false })).toMatchObject({
      subtotal: 19_800,
      delivery: 3_900,
      packaging: 2_000,
      gst: 990,
      total: 26_690,
    });
    expect(bill(cart, { mode: 'pickup', pointsBalance: 500, usePoints: true })).toMatchObject({
      pointsUsed: 190,
      discount: 9_500,
      delivery: 0,
      gst: 515,
    });
    expect(redeemablePoints(99, 100_000)).toBe(0);
    expect(redeemablePoints(1_000, 100_000)).toBe(1_000);
  });

  it('finds the nearest kitchen and estimates the ride', () => {
    expect(nearestOutlet(12.912, 77.645).outlet.id).toBe('hsr');
    expect(etaMinutes(0.3)).toBe(20);
    expect(etaMinutes(5.8)).toBe(45);
  });

  it('schedules inside kitchen hours, in IST', () => {
    const late = laterSlots(new Date('2026-10-23T22:10:00+05:30'));
    expect(late[0]?.label).toBe('Tomorrow, Sat 24 Oct, 11:30 am');
    expect(laterSlots(lunch)[0]?.label).toBe('Today, Fri 23 Oct, 2:00 pm');
    expect(bookableTimes('2026-10-23', lunch)[0]).toBe('14:00');
    expect(dayLabel('2026-10-25', lunch)).toBe('Sun 25 Oct');
  });

  it('never overbooks a slot', () => {
    const store = new DemoStore(':memory:');
    const tables = new TableBook(store.keyValue('t', () => lunch));
    const input = {
      outletId: 'koramangala',
      date: '2026-10-24',
      party: 10,
      time: '19:30',
      name: 'A',
      occasion: null,
      requests: null,
    };
    expect(book(tables, 'a', input, 's1', lunch).ok).toBe(true);
    expect(book(tables, 'b', input, 's2', lunch).ok).toBe(true);
    expect(book(tables, 'c', input, 's3', lunch)).toEqual({
      ok: false,
      error: '7:30 pm just filled up. Please pick another time.',
    });
    expect(book(tables, 'c', { ...input, party: 4 }, 's4', lunch).ok).toBe(true);
    expect(book(tables, 'd', { ...input, outletId: 'hsr' }, 's5', lunch).ok).toBe(false);
    expect(book(tables, 'd', { ...input, party: 11 }, 's6', lunch).ok).toBe(false);
    expect(book(tables, 'd', { ...input, date: '2026-12-01' }, 's7', lunch).ok).toBe(false);
    store.close();
  });

  it('starts every Club member with the welcome bonus', () => {
    const store = new DemoStore(':memory:');
    const ledger = new LoyaltyLedger(store.keyValue('l', () => lunch));
    expect(ledger.get('x', lunch).points).toBe(100);
    expect(ledger.add('x', -150, 'redeemed', lunch).points).toBe(0);
    store.close();
  });
});
