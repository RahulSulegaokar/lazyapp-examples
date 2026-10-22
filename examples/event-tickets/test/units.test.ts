import { describe, expect, it } from 'vitest';
import { EVENTS, findEvent, findTier, startsAt } from '../src/catalog.js';
import { quote } from '../src/pricing.js';
import { pdfString, qrMatrix, qrPng, ticketPdf, wrap } from '../src/render.js';

const indie = findEvent('indie')!;
const pit = findTier(indie, 'pit')!;

describe('pricing', () => {
  it('adds the booking fee and GST per paid ticket, then the promo', () => {
    expect(quote(indie, pit, 2, 'early100')).toEqual({
      quantity: 2,
      unitPrice: 149_900,
      subtotal: 299_800,
      fees: 6_000,
      tax: 1_080,
      discount: 20_000,
      total: 286_880,
      promo: { code: 'EARLY100', applied: true, note: 'EARLY100: ₹100 off each Monsoon Indie Nights ticket' },
    });
  });

  it('caps LAZY20 at ₹500 and never discounts below zero or on free tickets', () => {
    expect(quote(indie, pit, 4, 'LAZY20').discount).toBe(50_000);
    const devday = findEvent('devday')!;
    expect(quote(devday, findTier(devday, 'community')!, 2, 'LAZY20')).toMatchObject({
      total: 0,
      fees: 0,
      discount: 0,
      promo: { applied: false },
    });
    expect(quote(devday, findTier(devday, 'workshop')!, 1, 'EARLY100').promo).toMatchObject({
      applied: false,
      note: "Code EARLY100 doesn't apply to these tickets.",
    });
  });
});

describe('event dates', () => {
  it('keeps "tonight" tonight until 6 pm, then moves it to tomorrow', () => {
    const laughs = findEvent('laughs')!;
    expect(startsAt(laughs, new Date('2026-10-23T17:59:00+05:30'))).toEqual(
      new Date('2026-10-23T20:30:00+05:30'),
    );
    expect(startsAt(laughs, new Date('2026-10-23T18:00:00+05:30'))).toEqual(
      new Date('2026-10-24T20:30:00+05:30'),
    );
  });

  it('has tier names short enough for reply buttons with prices', () => {
    for (const event of EVENTS) {
      for (const tier of event.tiers) {
        expect(`${tier.name} waitlist`.length).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('ticket rendering', () => {
  const url = 'https://demo.lazyapp.in/x/event-tickets/checkin/Zk3xQ9vB7nLp2Rt4';

  it('renders a square QR PNG with a quiet zone', () => {
    const png = qrPng(url, 4);
    const size = (qrMatrix(url).length + 8) * 4;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });

  it('writes a valid single-page PDF with a correct cross-reference table', () => {
    const pdf = ticketPdf({
      title: 'Monsoon Indie Nights',
      kind: 'Live music',
      when: 'Sun, 25 Oct · 7:00 pm',
      venue: 'Bandstand Amphitheatre (Bandra West)',
      holder: 'Asha Rao',
      tier: 'Fan Pit',
      admits: 2,
      bookingId: 'MIN-24051',
      total: 'Paid ₹2,868.80',
      qrText: url,
    }).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it('escapes and transliterates text for the PDF font', () => {
    expect(pdfString('Paid ₹2,868 (incl. fee) – Asha’s · ticket\\')).toBe(
      "Paid Rs 2,868 \\(incl. fee\\) - Asha's \\267 ticket\\\\",
    );
    expect(pdfString('名前')).toBe('');
  });

  it('wraps words at a width', () => {
    expect(wrap('Hyderabad Street Food Carnival', 16)).toEqual(['Hyderabad Street', 'Food Carnival']);
  });
});
