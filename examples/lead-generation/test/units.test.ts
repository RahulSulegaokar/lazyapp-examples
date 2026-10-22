import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DemoStore } from '@lazyapp-examples/demo-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { greetingFor, parseAttribution } from '../src/attribution.js';
import { configFromEnv } from '../src/config.js';
import { signCrmBody } from '../src/crm.js';
import { asksForDemo } from '../src/index.js';
import { manifest } from '../src/manifest.js';
import { meetingIdFrom, placeMeeting } from '../src/meeting.js';
import { GUIDE_FILE } from '../src/product.js';
import { businessDays, formatWhen, isBookable } from '../src/schedule.js';
import { recommendedPlan, repFor, scoreLead, tagsFor } from '../src/scoring.js';
import { EMPTY_ANSWERS, initialLeadState } from '../src/state.js';
import type { Answers } from '../src/state.js';

const NOW = new Date('2026-10-23T09:00:00+05:30');
const stores: DemoStore[] = [];
const kv = () => {
  const store = new DemoStore(':memory:');
  stores.push(store);
  return store.keyValue('example:lead-generation', () => NOW);
};
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

const answers = (overrides: Partial<Answers>): Answers => ({ ...EMPTY_ANSWERS, ...overrides });

describe('attribution', () => {
  it('prefers the ad referral Meta attached over anything typed', () => {
    expect(
      parseAttribution(
        {
          source_url: 'https://www.instagram.com/p/abc',
          source_id: '42',
          source_type: 'ad',
          ctwa_clid: 'clid',
        },
        'DEMO LEADS src=qr',
      ),
    ).toMatchObject({ channel: 'ad', source: 'instagram', adId: '42', ctwaClid: 'clid', headline: null });
  });

  it('reads utm_* and short tags from prefilled text', () => {
    expect(
      parseAttribution(null, 'DEMO LEADS utm_source=linkedin utm_medium=social utm_campaign=gst-week'),
    ).toEqual({
      channel: 'link',
      source: 'linkedin',
      medium: 'social',
      campaign: 'gst-week',
      adId: null,
      headline: null,
      ctwaClid: null,
    });
    expect(parseAttribution(null, 'DEMO LEADS src=qr-expo')).toMatchObject({
      channel: 'qr',
      source: 'qr-expo',
    });
    expect(parseAttribution({}, 'DEMO LEADS')).toMatchObject({ channel: 'direct', source: null });
  });

  it('greets by channel', () => {
    expect(greetingFor(parseAttribution(null, 'DEMO LEADS utm_source=website'))).toBe(
      'Thanks for coming over from website.',
    );
    expect(greetingFor(parseAttribution({ source_type: 'ad' }, null))).toBe('Thanks for tapping our ad.');
  });

  it('spots a demo request after the start code, ignoring tags', () => {
    expect(asksForDemo('DEMO LEADS I want a demo of Ledgerly')).toBe(true);
    expect(asksForDemo('DEMO LEADS src=qr cmp=demo-booth')).toBe(false);
    expect(asksForDemo('DEMO LEADS')).toBe(false);
  });
});

describe('scoring', () => {
  it('scores budget, timeline, size, needs and role, with reasons', () => {
    expect(
      scoreLead(
        answers({
          budget: '3k-10k',
          timeline: '1-3m',
          size: '51-200',
          needs: ['gst-billing', 'inventory'],
          role: 'finance',
        }),
      ),
    ).toEqual({
      value: 81,
      grade: 'hot',
      reasons: [
        'budget 3k-10k (+25)',
        'timeline 1-3m (+20)',
        'team 51-200 (+20)',
        '2 needs (+8)',
        'role finance (+8)',
      ],
    });
    expect(scoreLead(EMPTY_ANSWERS)).toEqual({ value: 0, grade: 'cold', reasons: [] });
    expect(scoreLead(answers({ budget: 'unsure', timeline: '1-3m', size: '11-50', role: 'ops' })).grade).toBe(
      'warm',
    );
  });

  it('recommends a plan and routes enterprise deals to the enterprise rep', () => {
    expect(recommendedPlan(answers({ size: '1-10', needs: ['gst-billing'] })).id).toBe('starter');
    expect(recommendedPlan(answers({ size: '1-10', needs: ['gst-billing', 'inventory'] })).id).toBe('growth');
    expect(recommendedPlan(answers({ size: '11-50', needs: ['multi-gstin'] })).id).toBe('enterprise');
    expect(repFor(answers({ size: '201+' }))).toBe('vikram');
    expect(repFor(answers({ size: '11-50' }))).toBe('ananya');
  });

  it('tags for segments', () => {
    expect(
      tagsFor({
        ...initialLeadState(),
        answers: answers({ size: '201+', needs: ['recon'] }),
        score: { value: 80, grade: 'hot', reasons: [] },
        nurture: 'subscribed',
      }),
    ).toEqual([
      'demo-leads',
      'demo-leads:hot',
      'demo-leads:need-recon',
      'demo-leads:nurture',
      'demo-leads:size-201plus',
      'demo-leads:src-direct',
    ]);
  });
});

describe('sales calendar', () => {
  it('skips weekends and keeps an hour of notice', () => {
    expect(businessDays(NOW, 3).map((day) => day.title)).toEqual([
      'Fri, 23 Oct',
      'Mon, 26 Oct',
      'Tue, 27 Oct',
    ]);
    expect(isBookable('2026-10-23', '10:00', NOW)).toBe(true);
    expect(isBookable('2026-10-23', '10:00', new Date('2026-10-23T09:30:00+05:30'))).toBe(false);
    expect(isBookable('2026-10-24', '10:00', NOW)).toBe(false);
    expect(formatWhen(new Date('2026-10-26T06:00:00Z'))).toBe('Mon, 26 Oct at 11:30 AM');
  });

  it('holds one lead per rep per slot, idempotently', () => {
    const store = kv();
    const state = { ...initialLeadState(), answers: answers({ size: '11-50' }) };
    const request = { meetingId: meetingIdFrom('token-a'), dayId: '2026-10-26', time: '10:00', agenda: null };
    const first = placeMeeting(store, state, request, NOW);
    expect(first).toMatchObject({ ok: true, meeting: { repId: 'ananya', status: 'booked' } });
    expect(placeMeeting(store, state, request, NOW)).toMatchObject({ ok: true });
    expect(placeMeeting(store, state, { ...request, meetingId: meetingIdFrom('token-b') }, NOW)).toEqual({
      ok: false,
      reason: 'taken',
    });
    expect(placeMeeting(store, state, { ...request, time: '09:00' }, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('CRM and config', () => {
  it('signs deliveries the way LazyApp signs webhooks', () => {
    expect(signCrmBody('{"a":1}', 'secret')).toBe(
      `sha256=${createHmac('sha256', 'secret').update('{"a":1}').digest('hex')}`,
    );
    expect(signCrmBody('{"a":1}', 'secret')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signCrmBody('{"a":1}', 'secret')).not.toBe(signCrmBody('{"a":2}', 'secret'));
  });

  it('reads the CRM and timing settings from the environment', () => {
    expect(configFromEnv({})).toMatchObject({
      crm: { kind: 'store' },
      timing: 'demo',
      useEvents: false,
      repPhone: null,
    });
    expect(
      configFromEnv({
        LEADS_CRM_WEBHOOK_URL: 'https://hooks.example/leads',
        LEADS_CRM_WEBHOOK_SECRET: 'shh',
        LEADS_TIMING: 'production',
        LEADS_USE_EVENTS: 'true',
        DEMO_PHONE_NUMBER: '+91 98765 43210',
      }),
    ).toMatchObject({
      crm: { kind: 'webhook', url: 'https://hooks.example/leads', secret: 'shh', timeoutMs: 5000 },
      timing: 'production',
      useEvents: true,
      repPhone: '+919876543210',
    });
    expect(() => configFromEnv({ LEADS_CRM_WEBHOOK_URL: 'not a url' })).toThrow();
  });
});

describe('manifest', () => {
  it('follows Meta template rules: prefix, no edge or adjacent variables, an example per variable', () => {
    for (const spec of manifest.templates ?? []) {
      expect(spec.input.name).toMatch(/^demo_lead_generation_[a-z_]+$/);
      if (spec.kind !== 'standard') {
        continue;
      }
      const body = spec.input.body_text ?? '';
      expect(body).not.toMatch(/^\s*\{\{|\}\}[.!?]?\s*$/);
      expect(body).not.toMatch(/\}\}\s*\{\{/);
      expect(body.match(/\{\{\d+\}\}/g)?.length ?? 0).toBe(spec.input.body_examples?.length ?? 0);
    }
  });

  it('ships the guide PDF and a QR prefill that starts with the start code', () => {
    const pdf = readFileSync(new URL(`../public/${GUIDE_FILE}`, import.meta.url));
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(manifest.qrPrefill?.startsWith('DEMO LEADS')).toBe(true);
    expect(manifest.iceBreaker?.length).toBeLessThanOrEqual(80);
  });
});
