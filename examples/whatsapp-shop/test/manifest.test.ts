import { describe, expect, it } from 'vitest';
import shop from '../src/index.js';
import { manifest } from '../src/manifest.js';
import { deliverySlots, addressFromText, isCodAvailable } from '../src/delivery.js';
import { quote } from '../src/pricing.js';
import { searchProducts } from '../src/catalog.js';

/** Meta's template rules that reviews reject most often, checked before anything is submitted. */
describe('whatsapp-shop manifest', () => {
  for (const spec of manifest.templates ?? []) {
    if (spec.kind !== 'standard') {
      continue;
    }
    const { input } = spec;
    describe(input.name, () => {
      const body = input.body_text ?? '';
      const variables = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));

      it('is namespaced to the example', () => {
        expect(input.name.startsWith(`demo_${shop.id.replace(/-/g, '_')}_`)).toBe(true);
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
      expect(shop.flowEndpoints?.[flow.key] !== undefined).toBe(flow.dataExchange);
    });
  }
});

describe('whatsapp-shop domain', () => {
  it('offers nine slots from tomorrow before noon IST, from the day after after noon', () => {
    const morning = deliverySlots(new Date('2026-10-23T09:00:00+05:30'));
    expect(morning).toHaveLength(9);
    expect(morning[0]).toEqual({ id: '2026-10-24:am', label: 'Sat, 24 Oct, 9 am – 1 pm' });
    expect(deliverySlots(new Date('2026-10-23T13:00:00+05:30'))[0]?.id).toBe('2026-10-25:am');
  });

  it('prices COD, shipping and coupons', () => {
    const cart = [{ sku: 'il-pillow-cotton', size: null, qty: 1 }];
    expect(quote(cart, { couponCode: null, payment: 'cod' })).toMatchObject({
      subtotal: 99_900,
      shipping: 7_900,
      codFee: 4_900,
      total: 112_700,
    });
    expect(quote([{ ...cart[0]!, qty: 3 }], { couponCode: 'FESTIVE200', payment: 'prepaid' })).toMatchObject({
      shipping: 0,
      discount: 20_000,
      total: 279_700,
    });
    expect(quote(cart, { couponCode: 'NOPE', payment: null }).couponNote).toBe('NOPE is not a valid code');
    expect(quote([{ sku: 'gone', size: null, qty: 1 }], { couponCode: null, payment: null }).total).toBe(0);
  });

  it('parses typed addresses and knows prepaid-only PIN codes', () => {
    expect(addressFromText('12 MG Road, Indiranagar, Bengaluru 560038', 'Asha')).toMatchObject({
      name: 'Asha',
      line1: '12 MG Road, Indiranagar',
      city: 'Bengaluru',
      pincode: '560038',
    });
    expect(addressFromText('no pin here, city', null)).toBeNull();
    expect(isCodAvailable('744101')).toBe(false);
    expect(isCodAvailable('560038')).toBe(true);
  });

  it('ranks search results by name before description', () => {
    expect(searchProducts('red silk').map((product) => product.sku)).toEqual(['il-saree-kanjivaram-red']);
    expect(searchProducts('bedsheets')[0]?.sku).toBe('il-bedsheet-rust');
    expect(searchProducts('  ')).toEqual([]);
  });
});
