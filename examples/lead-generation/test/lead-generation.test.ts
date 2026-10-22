import { createHmac } from 'node:crypto';
import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { Harness, HarnessOptions } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { LeadGenConfig } from '../src/config.js';
import type { CrmEvent, OutboxRecord } from '../src/crm.js';
import leadGeneration, { createLeadGenerationExample } from '../src/index.js';
import { COUPON_CODE, TEMPLATES } from '../src/manifest.js';
import type { LeadState } from '../src/state.js';

const MINUTE = 60_000;
type Body = Record<string, unknown>;

interface CrmCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly event: CrmEvent;
}

/** A CRM endpoint that records deliveries and answers with `status`. */
function fakeCrm(status = 200) {
  const calls: CrmCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
      event: JSON.parse(body) as CrmEvent,
    });
    return new Response(null, { status });
  };
  return { calls, fetch: fetchImpl };
}

const harnesses: { close(): void }[] = [];
function setup(options: HarnessOptions = {}, config: Partial<LeadGenConfig> = {}): Harness<LeadState> {
  const example =
    Object.keys(config).length === 0
      ? leadGeneration
      : createLeadGenerationExample({ ...DEFAULT_CONFIG, ...config });
  const harness = createHarness(example, { displayName: 'Asha', ...options });
  harnesses.push(harness);
  return harness;
}
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

const HOT_ANSWERS = {
  flow: 'qualify',
  needs: ['gst-billing', 'eway', 'recon'],
  size: '11-50',
  role: 'owner',
  company: 'Sharma Traders',
  budget: '10k+',
  timeline: 'now',
  email: 'asha@sharmatraders.in',
};

const sentNow = (h: Harness<LeadState>) => h.messages().filter((message) => message.send_at === undefined);
const scheduled = (h: Harness<LeadState>) =>
  h.callsTo('POST', '/v1/messages').filter((call) => (call.body as Body).send_at !== undefined);
/** CRM outbox records (the "Sheet"), in no particular order. */
const stored = (h: Harness<LeadState>) =>
  h.store
    .keyValue('example:lead-generation', () => h.now())
    .list<OutboxRecord>('crm:')
    .map((entry) => entry.value);
const crmEvent = (h: Harness<LeadState>, type: string) =>
  stored(h).find((record) => record.event.type === type);
const ok = (result: Awaited<ReturnType<Harness<LeadState>['flowExchange']>>): Body => {
  expect(result.status).toBe(200);
  return (result as { body: { data: Body } }).body.data;
};

/** Qualifies as a hot lead and books Friday 2 PM through the flow. Returns the meeting id. */
async function bookHotLead(h: Harness<LeadState>, time = '14:00'): Promise<string> {
  await h.user.tap('lead:book', 'Book a demo');
  await h.user.submitFlow(HOT_ANSWERS);
  const done = await h.flowExchange('meeting', {
    action: 'data_exchange',
    data: { trigger: 'confirm', day: '2026-10-23', time, agenda: 'Tally migration' },
  });
  const params = (done as { body: { data: { extension_message_response: { params: Body } } } }).body.data
    .extension_message_response.params;
  await h.user.submitFlow(params);
  return params.meeting_id as string;
}

describe('lead generation: entry and attribution', () => {
  it('stays silent for anyone who has not sent DEMO LEADS', async () => {
    const h = setup();

    expect(await h.user.send('I want a GST software demo')).toEqual({
      status: 'ignored',
      reason: 'not in a demo',
    });
    expect(await h.user.tap('lead:book')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('attributes a Click-to-WhatsApp ad from the referral and greets with its headline', async () => {
    const h = setup();
    await h.user.message(
      'text',
      {
        text: { body: 'DEMO LEADS' },
        referral: {
          source_url: 'https://fb.me/2xLedgerly',
          source_id: '120214567890',
          source_type: 'ad',
          headline: 'GST invoices in 2 minutes',
          body: 'Try Ledgerly free for 14 days',
          media_type: 'image',
          ctwa_clid:
            'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a',
        },
      },
      'DEMO LEADS',
    );

    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image' },
      body: { text: expect.stringContaining('Thanks for tapping our ad “GST invoices in 2 minutes”') },
    });
    expect(h.lastChoices()).toEqual(['lead:book', 'lead:pricing', 'lead:guide']);
    expect(h.state()?.attribution).toEqual({
      channel: 'ad',
      source: 'facebook',
      medium: 'ad',
      campaign: null,
      adId: '120214567890',
      headline: 'GST invoices in 2 minutes',
      ctwaClid: expect.stringMatching(/^ARAkLk/),
    });
    expect(crmEvent(h, 'lead.created')).toMatchObject({
      status: 'stored',
      event: {
        type: 'lead.created',
        lead: { id: expect.stringMatching(/^LD-[0-9A-F]{8}$/), phone: h.user.phone },
      },
    });
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-leads', 'demo-leads:src-ad'] });
  });

  it('reads source and campaign from a QR prefill', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS src=qr cmp=demo-booth');

    expect(h.state()?.attribution).toMatchObject({ channel: 'qr', source: 'qr', campaign: 'demo-booth' });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Thanks for scanning our QR code') },
    });
  });

  it('goes straight to qualification when the first message asks for a demo (ice breaker)', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS I want a demo of Ledgerly');

    expect(h.texts()[0]).toContain('Let us set up your Ledgerly demo');
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: {
        parameters: {
          flow_id: 'meta-flow-lead-generation-qualify',
          flow_action: 'navigate',
          flow_action_payload: { screen: 'NEEDS' },
        },
      },
    });
  });

  it('shows plans on "See pricing" and nudges back to buttons on free text', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:pricing', 'See pricing');
    expect(h.lastInteractive()).toMatchObject({
      header: { type: 'text', text: 'Ledgerly plans' },
      body: { text: expect.stringContaining('*Growth* · ₹1,999/month') },
    });
    h.clear();

    await h.user.send('can someone call me?');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('taps work best here') },
    });
    await h.user.tap('something:stale');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('That option has expired') },
    });
    h.clear();

    await h.user.react('🙏', 'wamid.msg_1');
    expect(h.messages()).toHaveLength(0);
  });

  it('ends after 24 hours of silence and goes quiet', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    h.advance(24 * 60 * MINUTE);
    h.clear();

    expect(await h.user.tap('lead:book')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(h.messages()).toHaveLength(0);
  });
});

describe('lead generation: qualification, scoring and CRM', () => {
  it('scores a hot lead, alerts sales through the signed CRM webhook and opens the calendar', async () => {
    const crm = fakeCrm();
    const h = setup(
      {},
      {
        crm: {
          kind: 'webhook',
          url: 'https://crm.example/hooks/leads',
          secret: 'crm_secret',
          fetch: crm.fetch,
          timeoutMs: 1000,
        },
      },
    );
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:book', 'Book a demo');
    h.clear();

    await h.user.submitFlow(HOT_ANSWERS);

    expect(h.state()?.score).toEqual({
      value: 95,
      grade: 'hot',
      reasons: [
        'budget 10k+ (+30)',
        'timeline now (+30)',
        'team 11-50 (+15)',
        '3 needs (+12)',
        'role owner (+8)',
      ],
    });
    expect(h.texts()[0]).toContain(
      '*Growth* (₹1,999/month) fits what you need: GST invoicing, E-way bills, GSTR-2B reconciliation',
    );
    expect(h.texts()[0]).toContain('scored 95/100 (hot), tagged for segments, sales alerted in the CRM');
    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      action: { parameters: { flow_id: 'meta-flow-lead-generation-meeting', flow_action: 'data_exchange' } },
    });

    expect(crm.calls.map((call) => call.event.type)).toEqual(['lead.created', 'lead.qualified', 'lead.hot']);
    const hot = crm.calls[2]!;
    expect(hot.url).toBe('https://crm.example/hooks/leads');
    expect(hot.headers['x-lazyapp-demo-event']).toBe('lead.hot');
    expect(hot.headers['x-lazyapp-demo-signature']).toBe(
      `sha256=${createHmac('sha256', 'crm_secret').update(hot.body).digest('hex')}`,
    );
    expect(hot.event.lead).toMatchObject({
      company: 'Sharma Traders',
      email: 'asha@sharmatraders.in',
      grade: 'hot',
      needs: ['gst-billing', 'eway', 'recon'],
      attribution: { channel: 'direct' },
    });
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({
      tags: [
        'demo-leads:hot',
        'demo-leads:need-eway',
        'demo-leads:need-gst-billing',
        'demo-leads:need-recon',
        'demo-leads:size-11-50',
      ],
    });
  });

  it('does not create a second CRM event when LazyApp redelivers the same webhook', async () => {
    const crm = fakeCrm();
    const h = setup(
      {},
      {
        crm: {
          kind: 'webhook',
          url: 'https://crm.example/h',
          secret: null,
          fetch: crm.fetch,
          timeoutMs: 1000,
        },
      },
    );
    await h.user.send('DEMO LEADS');
    await h.replayLast();

    expect(crm.calls.map((call) => call.event.type)).toEqual(['lead.created']);
    expect(crm.calls[0]?.headers).not.toHaveProperty('x-lazyapp-demo-signature');
  });

  it('keeps the lead in the outbox when the CRM is down, and the chat carries on', async () => {
    const crm = fakeCrm(503);
    const h = setup(
      {},
      {
        crm: {
          kind: 'webhook',
          url: 'https://crm.example/h',
          secret: 's',
          fetch: crm.fetch,
          timeoutMs: 1000,
        },
      },
    );
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:book');
    await h.user.submitFlow(HOT_ANSWERS);

    expect(stored(h).map((record) => [record.event.type, record.status, record.lastError])).toEqual(
      expect.arrayContaining([
        ['lead.created', 'failed', 'HTTP 503'],
        ['lead.qualified', 'failed', 'HTTP 503'],
        ['lead.hot', 'failed', 'HTTP 503'],
      ]),
    );
    expect(h.texts().at(-1)).toContain('lead saved for sales');
    expect(h.lastInteractive()).toMatchObject({ type: 'flow' });
  });

  it('offers a demo to a warm lead and the guide first to a cold one', async () => {
    const warm = setup();
    await warm.user.send('DEMO LEADS');
    await warm.user.tap('lead:book');
    await warm.user.submitFlow({ ...HOT_ANSWERS, budget: '1k-3k', timeline: '1-3m', role: 'ops' });
    expect(warm.state()?.score?.grade).toBe('warm');
    expect(warm.lastChoices()).toEqual(['lead:book', 'lead:guide', 'lead:pricing']);

    const cold = setup();
    await cold.user.send('DEMO LEADS');
    await cold.user.tap('lead:book');
    await cold.user.submitFlow({
      ...HOT_ANSWERS,
      needs: ['gst-billing'],
      size: '1-10',
      budget: 'lt1k',
      timeline: 'exploring',
      role: 'other',
    });
    expect(cold.state()?.score).toMatchObject({ grade: 'cold', value: 14 });
    expect(cold.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('*Starter* (₹799/month)') },
    });
    expect(cold.lastChoices()).toEqual(['lead:guide', 'lead:book', 'lead:pricing']);
  });

  it('re-asks when the flow comes back incomplete and drops an invalid email', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:book');
    h.clear();

    await h.user.submitFlow({ ...HOT_ANSWERS, needs: [] });
    expect(h.texts()[0]).toContain('Some answers were missing');
    expect(h.lastInteractive()).toMatchObject({ type: 'flow' });

    await h.user.submitFlow({ ...HOT_ANSWERS, email: 'not-an-email', company: '  ' });
    expect(h.state()?.answers).toMatchObject({ email: null, company: null });
  });

  it('qualifies with four lists when the flow is not published, and says so', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:book');

    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      body: { text: expect.stringContaining('The form is not available right now') },
    });
    expect(h.lastChoices()).toHaveLength(6);

    await h.user.choose('q:need:multi-gstin', 'Multiple branches');
    expect(h.lastChoices()).toEqual(['q:size:1-10', 'q:size:11-50', 'q:size:51-200', 'q:size:201+']);
    await h.user.choose('q:size:201+');
    await h.user.choose('q:budget:10k+');
    expect(h.state()?.answers).toMatchObject({
      needs: ['multi-gstin'],
      size: '201+',
      budget: '10k+',
      timeline: null,
    });
    h.clear();

    await h.user.choose('q:timeline:now', 'This month');

    expect(h.state()?.score).toMatchObject({ value: 84, grade: 'hot' });
    expect(h.texts()[0]).toContain('*Enterprise* (Custom pricing)');
    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      header: { text: 'Demo with Vikram' },
      body: { text: expect.stringContaining('The booking form is not available right now') },
    });
    expect(h.lastChoices()[0]).toBe('meeting:slot:2026-10-23T10:00');
    h.clear();

    await h.user.choose('meeting:slot:2026-10-23T10:00');
    expect(h.state()?.meeting).toMatchObject({
      repId: 'vikram',
      at: '2026-10-23T04:30:00.000Z',
      confirmed: true,
    });
    expect(sentNow(h)[0]).toMatchObject({ type: 'template', template: { name: TEMPLATES.meetingBooked } });
  });

  it('restarts the fallback when an answer id is not one it knows', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO LEADS');
    h.clear();
    await h.user.choose('q:size:huge');

    expect(h.lastChoices()[0]).toBe('q:need:gst-billing');
  });
});

describe('lead generation: demo meeting', () => {
  it('books against the rep calendar: confirmation template, rep card, reminder, CRM, tags', async () => {
    const h = setup({}, { repPhone: '+919000000000' });
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:book');
    await h.user.submitFlow(HOT_ANSWERS);

    const init = ok(await h.flowExchange('meeting', { action: 'INIT' }));
    expect(init).toMatchObject({
      rep_line: '30 minutes with Ananya Iyer, Account executive',
      context_line: 'We will tailor it to: GST invoicing, E-way bills, GSTR-2B reconciliation',
      slots: [],
      slots_visible: false,
    });
    expect((init.days as { id: string }[]).map((day) => day.id)).toEqual([
      '2026-10-23',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]);
    const friday = ok(
      await h.flowExchange('meeting', {
        action: 'data_exchange',
        data: { trigger: 'day', day: '2026-10-23' },
      }),
    );
    expect(friday.slots).toEqual([
      { id: '10:00', title: '10:00 AM' },
      { id: '11:30', title: '11:30 AM' },
      { id: '14:00', title: '2:00 PM' },
      { id: '15:30', title: '3:30 PM' },
      { id: '17:00', title: '5:00 PM' },
    ]);
    const done = await h.flowExchange('meeting', {
      action: 'data_exchange',
      data: { trigger: 'confirm', day: '2026-10-23', time: '14:00', agenda: 'Tally migration' },
    });
    expect(done).toMatchObject({ body: { screen: 'SUCCESS' } });
    const meetingId = h.state()!.meeting!.id;
    expect(h.state()?.meeting).toMatchObject({ agenda: 'Tally migration', confirmed: false });
    h.clear();

    await h.user.submitFlow({ flow: 'meeting', meeting_id: meetingId });

    const [confirmation, card] = sentNow(h);
    expect(confirmation).toMatchObject({
      type: 'template',
      template: {
        name: TEMPLATES.meetingBooked,
        components: [
          { type: 'body', parameters: [{ text: 'Fri, 23 Oct at 2:00 PM' }, { text: 'Ananya Iyer' }] },
          { sub_type: 'quick_reply', index: '0', parameters: [{ payload: 'meeting:reschedule' }] },
          { sub_type: 'quick_reply', index: '1', parameters: [{ payload: 'meeting:cancel' }] },
        ],
      },
    });
    expect(card).toMatchObject({
      type: 'contacts',
      contacts: [{ name: { formatted_name: 'Ananya Iyer' }, phones: [{ phone: '+919000000000' }] }],
    });
    expect(
      scheduled(h).map((call) => [
        (call.body as { template: { name: string } }).template.name,
        (call.body as Body).send_at,
      ]),
    ).toEqual([[TEMPLATES.meetingReminder, new Date(h.now().getTime() + 2 * MINUTE).toISOString()]]);
    expect(crmEvent(h, 'meeting.booked')?.event).toMatchObject({
      lead: { meeting: { id: meetingId, rep: 'ananya', status: 'booked' } },
    });
    expect(h.callsTo('POST', /\/tags$/).at(-1)?.body).toEqual({ tags: ['demo-leads:meeting-booked'] });

    h.clear();
    await h.user.tap('lead:book', 'My demo');
    expect(h.lastChoices()).toEqual(['meeting:reschedule', 'meeting:cancel', 'lead:pricing']);
  });

  it('never double-books a rep: the second lead is told the time was just taken', async () => {
    const h = setup();
    const other = h.as('+919800000022', 'Ravi');
    await other.send('DEMO LEADS');
    await other.tap('lead:book');
    await other.submitFlow(HOT_ANSWERS);
    await h.flowExchange(
      'meeting',
      { action: 'data_exchange', data: { trigger: 'confirm', day: '2026-10-23', time: '14:00' } },
      other.phone,
    );

    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:book');
    await h.user.submitFlow(HOT_ANSWERS);
    const taken = ok(
      await h.flowExchange('meeting', {
        action: 'data_exchange',
        data: { trigger: 'confirm', day: '2026-10-23', time: '14:00' },
      }),
    );
    expect(taken.error_message).toBe('That time was just taken. Pick another.');
  });

  it('moves the meeting from the template quick reply and releases the old slot', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    const meetingId = await bookHotLead(h);
    h.clear();

    await h.user.tap('meeting:reschedule', 'Reschedule');
    expect(h.lastInteractive()).toMatchObject({ type: 'flow', header: { text: 'Move your demo' } });
    const init = ok(await h.flowExchange('meeting', { action: 'INIT' }));
    expect(init.context_line).toBe('Moving your demo on Fri, 23 Oct at 2:00 PM');

    await h.flowExchange('meeting', {
      action: 'data_exchange',
      data: { trigger: 'confirm', day: '2026-10-26', time: '11:30' },
    });
    await h.user.submitFlow({ flow: 'meeting', meeting_id: meetingId });

    expect(h.state()?.meeting).toMatchObject({
      id: meetingId,
      at: '2026-10-26T06:00:00.000Z',
      confirmed: true,
    });
    expect(sentNow(h).some((message) => message.type === 'contacts')).toBe(false);
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(crmEvent(h, 'meeting.rescheduled')).toBeDefined();
    expect(h.store.keyValue('example:lead-generation', () => h.now()).list('meet:')).toEqual([
      { key: 'meet:ananya:2026-10-26T06:00:00.000Z', value: meetingId },
    ]);
  });

  it('cancels after confirming, releases the rep and the reminder', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await bookHotLead(h);
    await h.user.tap('meeting:cancel', 'Cancel');
    expect(h.lastChoices()).toEqual(['meeting:cancel-yes', 'meeting:reschedule', 'meeting:keep']);
    h.clear();

    await h.user.tap('meeting:cancel-yes');

    expect(h.state()?.meeting?.status).toBe('cancelled');
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(h.store.keyValue('example:lead-generation', () => h.now()).list('meet:')).toEqual([]);
    expect(crmEvent(h, 'meeting.cancelled')).toBeDefined();
    expect(h.callsTo('DELETE', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-leads:meeting-booked'] });

    h.clear();
    await h.user.tap('meeting:cancel-yes');
    expect(h.lastInteractive()).toMatchObject({ body: { text: 'You have no demo booked right now.' } });
  });

  it('answers the reminder quick reply with a 👍', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await bookHotLead(h);
    h.clear();

    await h.user.tap('meeting:attending', 'I will join');

    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '👍' } });
    expect(h.texts()[0]).toBe('Great, Ananya will see you then.');
  });

  it('confirms in-session when the template is refused or later fails', async () => {
    const h = setup();
    h.api.on('POST', '/v1/messages', (call) => {
      const body = call.body as { type: string; send_at?: string };
      if (body.type === 'template' && body.send_at === undefined) {
        return { status: 422, body: { message: 'Template is not approved.', code: 'template_not_approved' } };
      }
      return body.send_at === undefined
        ? {
            status: 201,
            body: {
              uuid: h.api.nextId('msg'),
              status: 'sent',
              type: body.type,
              provider_message_id: 'wamid.x',
            },
          }
        : { status: 202, body: { id: h.api.nextId('sch'), status: 'scheduled' } };
    });
    await h.user.send('DEMO LEADS');
    h.clear();
    await bookHotLead(h);

    expect(h.interactives().at(-1)).toMatchObject({
      body: { text: expect.stringContaining('✅ Your Ledgerly demo is booked for *Fri, 23 Oct at 2:00 PM*') },
    });
  });

  it('falls back when Meta reports the confirmation template failed', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await bookHotLead(h);
    const uuid = h.state()?.meeting?.confirmationUuid;
    h.clear();

    await h.event('message.failed', {
      message: { uuid, to: h.user.phone, status: 'failed', metadata: { demo: 'lead-generation' } },
    });
    expect(h.lastChoices()).toEqual(['meeting:reschedule', 'meeting:cancel']);
    expect(h.state()?.meeting?.confirmationUuid).toBeNull();
  });

  it('confirms through POST /v1/events in events mode', async () => {
    const h = setup({}, { useEvents: true });
    await h.user.send('DEMO LEADS');
    h.clear();
    const meetingId = await bookHotLead(h);

    expect(h.callsTo('POST', '/v1/events')[0]?.body).toEqual({
      type: 'appointment.confirmed',
      recipient: { phone_number: h.user.phone },
      properties: {
        company: 'Ledgerly',
        when: 'Fri, 23 Oct at 2:00 PM',
        rep: 'Ananya Iyer',
        meeting_id: meetingId,
      },
      idempotency_key: `demo-leads-${meetingId}-2026-10-23T08:30:00.000Z`,
    });
    expect(sentNow(h).filter((message) => message.type === 'template')).toHaveLength(0);
  });

  it('schedules the production reminder 15 minutes before the call', async () => {
    const h = setup({}, { timing: 'production' });
    await h.user.send('DEMO LEADS');
    h.clear();
    await bookHotLead(h, '17:00');

    expect((scheduled(h)[0]?.body as Body).send_at).toBe('2026-10-23T11:15:00.000Z');
  });
});

describe('lead generation: nurture and consent', () => {
  it('sends the guide PDF and asks before any marketing', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    h.clear();
    await h.user.tap('lead:guide', 'Free GST guide');

    expect(h.messages()[0]).toMatchObject({
      type: 'document',
      media_url: 'https://demo.test/public/lead-generation/ledgerly-gst-invoicing-guide.pdf',
      filename: 'Ledgerly-GST-invoicing-guide.pdf',
    });
    expect(h.lastChoices()).toEqual(['nurture:optin', 'nurture:no', 'lead:book']);
    expect(scheduled(h)).toHaveLength(0);
  });

  it('records consent on "Yes, send tips" and schedules a tip and a coupon offer', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:guide');
    h.clear();

    await h.user.tap('nurture:optin', 'Yes, send tips');

    expect(h.callsTo('POST', '/v1/contacts/contact-919800000001/consent')[0]?.body).toMatchObject({
      granted: true,
      channel: 'whatsapp',
      purpose: 'marketing',
      consent_text: expect.stringContaining('Tapped "Yes, send tips"'),
    });
    const [tip, offer] = scheduled(h).map((call) => call.body as Body);
    expect(tip).toMatchObject({
      send_at: new Date(h.now().getTime() + 3 * MINUTE).toISOString(),
      template: {
        name: TEMPLATES.nurtureTip,
        components: [{ type: 'body', parameters: [{ text: 'Asha' }, { text: 'your business' }] }, {}, {}],
      },
    });
    expect(offer).toMatchObject({
      send_at: new Date(h.now().getTime() + 10 * MINUTE).toISOString(),
      template: {
        name: TEMPLATES.comebackOffer,
        features: { coupon_code: COUPON_CODE },
        components: [
          { type: 'body' },
          { index: '1', parameters: [{ payload: 'lead:book' }] },
          { index: '2', parameters: [{ payload: 'nurture:stop' }] },
        ],
      },
    });
    expect(h.session()?.meta.marketingOptIn).toBe(true);
    expect(crmEvent(h, 'nurture.opted_in')?.event).toMatchObject({ lead: { marketing_opt_in: true } });
    expect(h.lastChoices()).toEqual(['lead:book', 'nurture:stop']);
  });

  it('"Stop tips" cancels the drip and records the opt-out, but keeps the chat open', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:guide');
    await h.user.tap('nurture:optin');
    h.clear();

    await h.user.tap('nurture:stop', 'Stop tips');

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
    expect(h.callsTo('POST', /\/consent$/)[0]?.body).toMatchObject({ granted: false });
    expect(h.state()?.nurture).toBe('stopped');
    expect(crmEvent(h, 'nurture.opted_out')).toBeDefined();
    expect(h.session()).toBeDefined();

    h.clear();
    await h.user.tap('lead:guide');
    expect(h.lastChoices()).toEqual(['lead:book']);
  });

  it('"No thanks" schedules nothing', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:guide');
    h.clear();
    await h.user.tap('nurture:no', 'No thanks');

    expect(scheduled(h)).toHaveLength(0);
    expect(h.state()?.nurture).toBe('declined');
  });

  it('honours the WhatsApp "Stop promotions" opt-out (contact.opted_out)', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:guide');
    await h.user.tap('nurture:optin');
    h.clear();

    await h.event('contact.opted_out', {
      contact: { uuid: 'contact-919800000001', phone_number: h.user.phone },
      purpose: 'marketing',
      source: 'whatsapp',
    });

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
    expect(h.messages()).toHaveLength(0);
    expect(h.state()?.nurture).toBe('stopped');
  });

  it('ends the demo silently when LazyApp suppresses the contact for every purpose', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    h.clear();

    await h.event('contact.opted_out', {
      contact: { uuid: 'contact-919800000001', phone_number: h.user.phone },
      purpose: 'all',
      keyword: 'STOP',
    });

    expect(h.messages()).toHaveLength(0);
    expect(crmEvent(h, 'lead.opted_out')).toBeDefined();
    expect(h.session()).toBeUndefined();
  });

  it('STOP ends everything: drip cancelled, opt-out sent to the CRM and tagged', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await h.user.tap('lead:guide');
    await h.user.tap('nurture:optin');
    h.clear();

    await h.user.send('STOP');

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['demo-leads:opted-out'] });
    expect(crmEvent(h, 'lead.opted_out')).toBeDefined();
    expect(h.callsTo('POST', /\/consent$/)[0]?.body).toMatchObject({ granted: false, purpose: 'all' });
    expect(h.session()).toBeUndefined();
  });

  it('EXIT mid-booking cancels the reminder and invalidates the open flow', async () => {
    const h = setup();
    await h.user.send('DEMO LEADS');
    await bookHotLead(h);
    await h.user.tap('meeting:reschedule');
    h.clear();

    await h.user.send('EXIT');

    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    expect(h.texts()[0]).toContain('Thanks for trying Ledgerly lead machine');
    expect(await h.flowExchange('meeting', { action: 'INIT' })).toMatchObject({ status: 427 });
  });
});
