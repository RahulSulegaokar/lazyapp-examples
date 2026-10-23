import type { Harness, HarnessOptions, SimulatedUser } from '@lazyapp-examples/demo-kit/testing';
import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { CreatePaymentInput } from '@lazyapp-examples/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { Booking } from '../src/box-office.js';
import eventTickets from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';
import type { TicketsState } from '../src/state.js';

/** Friday 23 Oct 2026, 9:00 am IST. "Late Night Laughs" is tonight at 8:30 pm. */
const FRIDAY_9AM = new Date('2026-10-23T09:00:00+05:30');
const MINUTE = 60_000;

const harnesses: { close(): void }[] = [];
function setup(options: HarnessOptions = {}): Harness<TicketsState> {
  const h = createHarness(eventTickets, { displayName: 'Asha', now: FRIDAY_9AM, ...options });
  harnesses.push(h);
  h.api.on('POST', '/v1/payments/:id/refund', (call, params) => ({
    status: 200,
    body: {
      ...h.api.payments.get(params.id ?? ''),
      amount_refunded: (call.body as { amount: number }).amount,
    },
  }));
  return h;
}
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

const booking = (h: Harness<TicketsState>, id: string): Booking | undefined =>
  h.store.keyValue('example:event-tickets', () => h.now()).get<Booking>(`booking:${id}`);

/** Starts the demo, picks a tier and submits the attendee Flow. */
async function bookWithFlow(
  h: Harness<TicketsState>,
  tier: string,
  details: { quantity?: string; promo?: string; updates?: boolean } = {},
  user: SimulatedUser = h.user,
): Promise<string> {
  await user.send('DEMO EVENTS');
  await user.tap(`tier:${tier}`);
  await user.submitFlow({
    name: 'Asha Rao',
    email: 'asha@example.com',
    quantity: details.quantity ?? '2',
    promo: details.promo ?? '',
    updates: details.updates ?? false,
  });
  return h.state(user.phone)?.bookingId ?? '';
}

describe('event-tickets: discovery', () => {
  it('stays silent until the start code', async () => {
    const h = setup();
    expect(await h.user.send('tickets')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(await h.user.tap('ev:indie')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('opens with a media carousel of events, soonest first', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');

    const [carousel, buttons] = h.interactives();
    expect(carousel).toMatchObject({
      type: 'carousel',
      body: { text: expect.stringContaining('Hi, Asha!') },
    });
    const cards = carousel?.type === 'carousel' ? carousel.action.cards : [];
    expect(cards).toHaveLength(4);
    expect(cards[0]).toMatchObject({
      header: { type: 'image', image: { link: expect.stringContaining('photo-1585699324551') } },
      body: { text: 'Late Night Laughs\nToday · 8:30 pm · Hauz Khas Village, New Delhi\nFrom ₹499' },
      action: {
        buttons: [
          { type: 'quick_reply', quick_reply: { id: 'ev:laughs', title: 'Get tickets' } },
          { type: 'quick_reply', quick_reply: { id: 'info:laughs', title: 'Venue & details' } },
        ],
      },
    });
    expect(cards.map((card) => (card.type === 'cta_url' ? card.body?.text.split('\n')[0] : ''))).toEqual([
      'Late Night Laughs',
      'Monsoon Indie Nights',
      'Build with WhatsApp DevDay',
      'Hyderabad Street Food Carnival',
    ]);
    expect(buttons).toMatchObject({ type: 'button', footer: { text: 'MENU · EXIT · STOP' } });
  });

  it('shows an event with live availability and one button per tier', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    h.clear();

    await h.user.tap('ev:indie', 'Get tickets');

    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image' },
      body: {
        text: expect.stringMatching(
          /\*Monsoon Indie Nights\*\nLive music · Sun, 25 Oct · 7:00 pm \(doors 6:00 pm\)[\s\S]*\*Fan Pit\* · ₹1,499 · Standing area by the stage \(only 19 left\)[\s\S]*\*VIP\* · ₹3,499 · Lounge, bar and a seat \(sold out\)/,
        ),
      },
    });
    expect(h.lastChoices()).toEqual(['tier:indie:ga', 'tier:indie:pit', 'tier:indie:vip']);
    expect(h.lastInteractive()).toMatchObject({
      action: {
        buttons: [
          { reply: { title: 'GA ₹799' } },
          { reply: { title: 'Fan Pit ₹1,499' } },
          { reply: { title: 'VIP waitlist' } },
        ],
      },
    });

    h.clear();
    await h.user.tap('info:indie');
    expect(h.messages()[0]).toMatchObject({
      type: 'location',
      name: 'Bandstand Amphitheatre',
      latitude: 19.0473,
    });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Bandra station (Western line)') },
    });
  });

  it('puts people on a waitlist for sold-out tiers', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    await h.user.tap('tier:indie:vip');
    expect(h.lastChoices()).toEqual(['wl:join:indie:vip', 'ev:indie']);
    h.clear();

    await h.user.tap('wl:join:indie:vip', 'Join waitlist');

    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '📝' } });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("You're *#1* on the VIP waitlist") },
    });
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['waitlist:indie'] });

    const other = h.as('+919800000055');
    await other.send('DEMO EVENTS');
    await other.tap('wl:join:indie:vip');
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining("You're *#2*") } });

    await h.user.tap('tier:indie:vip');
    expect(h.lastChoices()).toEqual(['wl:leave:indie:vip', 'ev:indie']);
    await h.user.tap('wl:leave:indie:vip');
    await other.tap('tier:indie:vip');
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('You are *#1* on the waitlist') },
    });
  });
});

describe('event-tickets: the attendee flow', () => {
  it('sends a data-exchange flow and prices the order live', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    h.clear();
    await h.user.tap('tier:indie:pit', 'Fan Pit ₹1,499');

    expect(h.lastInteractive()).toMatchObject({
      type: 'flow',
      header: { text: 'Monsoon Indie Nights' },
      action: {
        parameters: {
          flow_id: 'meta-flow-event-tickets-attendee',
          flow_action: 'data_exchange',
          flow_cta: 'Add details',
        },
      },
    });

    const init = await h.flowExchange('attendee', { action: 'INIT' });
    expect(init).toMatchObject({
      status: 200,
      body: {
        screen: 'DETAILS',
        data: {
          event_title: 'Monsoon Indie Nights',
          tier_line: 'Fan Pit · ₹1,499 each · Sun, 25 Oct · 7:00 pm',
          name: 'Asha',
          quantities: expect.arrayContaining([{ id: '6', title: '6 tickets' }]),
        },
      },
    });

    const badEmail = await h.flowExchange('attendee', {
      action: 'data_exchange',
      data: { name: 'Asha Rao', email: 'asha@', quantity: '2', promo: '', updates: false },
    });
    expect(badEmail).toMatchObject({
      body: { screen: 'DETAILS', data: { error_message: 'That email address does not look right.' } },
    });

    const summary = await h.flowExchange('attendee', {
      action: 'data_exchange',
      data: { name: 'Asha Rao', email: 'asha@example.com', quantity: '2', promo: 'lazy20', updates: true },
    });
    expect(summary).toMatchObject({
      status: 200,
      body: {
        screen: 'SUMMARY',
        data: {
          summary:
            'Fan Pit × 2: ₹2,998\nBooking fee: ₹60 (+ ₹10.80 GST)\nDiscount (LAZY20): −₹500\nTotal: ₹2,568.80',
          promo_note: 'LAZY20: 20% off tickets, up to ₹500',
          quantity: '2',
          promo: 'LAZY20',
          updates: true,
        },
      },
    });

    const badPromo = await h.flowExchange('attendee', {
      action: 'data_exchange',
      data: { name: 'Asha Rao', email: 'asha@example.com', quantity: '1', promo: 'FREEBIE' },
    });
    expect(badPromo).toMatchObject({
      body: { data: { promo_note: "Code FREEBIE isn't valid, so no discount was applied." } },
    });

    const tooMany = await h.flowExchange('attendee', {
      action: 'data_exchange',
      data: { name: 'Asha Rao', email: 'asha@example.com', quantity: '9' },
    });
    expect(tooMany).toMatchObject({ body: { data: { error_message: 'Choose how many tickets you need.' } } });
  });

  it('rejects stale flow tokens with 427', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    await h.user.tap('tier:indie:ga');
    expect(
      await h.flowExchange('attendee', { action: 'INIT', flow_token: 'event-tickets.not-a-token' }),
    ).toMatchObject({ status: 427 });

    await h.user.send('EXIT');
    expect(await h.flowExchange('attendee', { action: 'INIT' })).toMatchObject({ status: 427 });
  });

  it('falls back to quantity buttons when the flow is not published', async () => {
    const h = setup({ flowsPublished: false });
    await h.user.send('DEMO EVENTS');
    await h.user.tap('tier:laughs:std');
    expect(h.lastChoices()).toEqual(['qty:1', 'qty:2', 'qty:4']);

    await h.user.tap('qty:2', '2 tickets');

    expect(booking(h, h.state()?.bookingId ?? '')).toMatchObject({
      quantity: 2,
      name: 'Asha',
      email: null,
      status: 'held',
    });
    expect(h.lastChoices()).toEqual([`pay:sim:LNL-24051`, 'bk:cancel:LNL-24051']);

    await h.user.tap('qty:2');
    expect(h.lastInteractive()).toMatchObject({ type: 'button' });
    expect(h.interactives().filter((message) => message.type === 'carousel').length).toBeGreaterThan(0);
  });
});

describe('event-tickets: payment and tickets', () => {
  it('holds seats, requests an India payment, and issues QR tickets on capture', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    const id = await bookWithFlow(h, 'indie:pit', { promo: 'LAZY20' });

    expect(id).toBe('MIN-24051');
    const [request] = h.callsTo('POST', '/v1/payments');
    const body = request?.body as CreatePaymentInput;
    expect(body).toMatchObject({
      to: h.user.phone,
      reference_id: 'MIN-24051-1',
      goods_type: 'digital-goods',
      expires_in_minutes: 15,
      items: [
        { name: 'Monsoon Indie Nights · Fan Pit', amount: 149_900, quantity: 2, retailer_id: 'indie.pit' },
        { name: 'Booking fee', amount: 3_000, quantity: 2, retailer_id: 'booking-fee' },
      ],
      tax: { amount: 1_080, description: 'GST 18% on the booking fee' },
      discount: { amount: 50_000, program_name: 'LAZY20' },
      payment: { method: 'payment_gateway', configuration: 'demo-store' },
      metadata: { demo: 'event-tickets', booking: 'MIN-24051' },
    });
    expect(request?.idempotencyKey).toMatch(/:event-tickets:payment:MIN-24051:1$/);
    expect([...h.api.payments.values()][0]?.total_amount).toBe(256_880);
    expect(h.texts().at(-1)).toContain('2 seats held until *9:15 am*');
    const paymentId = [...h.api.payments.keys()][0] ?? '';
    expect(booking(h, id)).toMatchObject({ status: 'awaiting_payment', paymentId });
    h.clear();

    await h.payPayment();

    expect(h.callsTo('POST', `/v1/payments/${paymentId}/status`)[0]?.body).toEqual({
      status: 'completed',
      description: 'Tickets issued: booking MIN-24051',
    });
    expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['event:indie', 'tickets:buyer'] });
    const [image, pdf] = h.messages();
    const code = booking(h, id)?.code ?? '';
    expect(code).toMatch(/^[\w-]{16}$/);
    expect(image).toMatchObject({
      type: 'image',
      media_url: `https://demo.test/x/event-tickets/t/${code}.png`,
      caption: expect.stringContaining('🎟️ *Monsoon Indie Nights* · Admit 2'),
    });
    expect(pdf).toMatchObject({
      type: 'document',
      media_url: `https://demo.test/x/event-tickets/t/${code}.pdf`,
      filename: 'Ticket-MIN-24051.pdf',
    });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("You're in, Asha! 🎉 Paid ₹2,568.80.") },
    });
    expect(h.lastChoices()).toEqual([`cal:${id}`, `venue:${id}`, `rem:${id}`]);
    expect(booking(h, id)).toMatchObject({ status: 'issued' });

    // At-least-once delivery: the same webhook again changes nothing.
    h.clear();
    await h.replayLast();
    expect(h.messages()).toHaveLength(0);

    // WhatsApp fetches the files from the demo server.
    const png = await h.web(`/t/${code}.png`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await png.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const document = await h.web(`/t/${code}.pdf`);
    expect(document.headers.get('content-type')).toBe('application/pdf');
    expect(
      Buffer.from(await document.arrayBuffer())
        .subarray(0, 8)
        .toString('latin1'),
    ).toBe('%PDF-1.4');
    expect((await h.web('/t/AAAAAAAAAAAAAAAA.png')).status).toBe(404);
  });

  it('issues free tickets straight away', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    const id = await bookWithFlow(h, 'devday:community', { quantity: '1' });

    expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
    expect(booking(h, id)).toMatchObject({ status: 'issued', quote: { total: 0 } });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('Free registration confirmed.') },
    });
  });

  it('simulates checkout, clearly labelled, when the number has no payment setup', async () => {
    const h = setup();
    const id = await bookWithFlow(h, 'laughs:front', { quantity: '1' });

    expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringContaining(
          "Payments aren't set up on this demo number, so this checkout is simulated",
        ),
      },
    });
    h.clear();

    await h.user.tap(`pay:sim:${id}`, 'Simulate payment');
    expect(h.messages().map((message) => message.type)).toEqual(['image', 'document', 'interactive']);

    h.clear();
    await h.user.tap(`pay:sim:${id}`);
    expect(h.messages().map((message) => message.type)).toEqual(['image', 'interactive']);
  });

  it('falls back to the simulated checkout when LazyApp refuses the payment request', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    h.api.on('POST', '/v1/payments', () => ({
      status: 422,
      body: { message: 'Accept WhatsApp payment terms in WhatsApp Manager first.' },
    }));

    const id = await bookWithFlow(h, 'food:day', { quantity: '1' });

    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringContaining(
          "LazyApp couldn't create the payment request (Accept WhatsApp payment terms",
        ),
      },
    });
    expect(h.lastChoices()).toEqual([`pay:sim:${id}`, `bk:cancel:${id}`]);
  });

  it('keeps the seats on a failed payment and retries with a new reference', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    const id = await bookWithFlow(h, 'indie:ga', { quantity: '1' });
    const first = [...h.api.payments.values()][0];
    h.clear();

    await h.event('payment.failed', {
      payment: { ...first, payment_status: 'failed', last_error: 'UPI PIN incorrect' },
    });

    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining("didn't go through (UPI PIN incorrect). Nothing was charged.") },
    });
    expect(h.lastChoices()).toEqual([`pay:retry:${id}`, `bk:cancel:${id}`]);
    h.clear();

    await h.user.tap(`pay:retry:${id}`, 'Try again');
    expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({ reference_id: `${id}-2` });

    // The old request failing again is noise now; the new one pays.
    h.clear();
    await h.event('payment.failed', { payment: { ...first, payment_status: 'failed' } });
    expect(h.messages()).toHaveLength(0);
    const [firstId = '', secondId = ''] = [...h.api.payments.keys()];
    await h.payPayment(secondId);
    expect(booking(h, id)).toMatchObject({ status: 'issued', paymentId: secondId });

    // If the first request is paid too, the money goes straight back.
    h.clear();
    await h.payPayment(firstId);
    expect(h.callsTo('POST', `/v1/payments/${firstId}/refund`)).toHaveLength(1);
    expect(h.texts()[0]).toContain('You paid twice');
  });

  it('refunds a payment that lands after the hold lapsed and the seats sold', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    const late = await bookWithFlow(h, 'laughs:front', { quantity: '6' });
    h.advance(16 * MINUTE);

    const other = h.as('+919800000066', 'Ravi');
    const fast = await bookWithFlow(h, 'laughs:front', { quantity: '6' }, other);
    const [lateId = '', fastId = ''] = [...h.api.payments.keys()];
    await h.payPayment(fastId);
    expect(booking(h, fast)).toMatchObject({ status: 'issued' });
    h.clear();

    await h.payPayment(lateId);

    expect(h.callsTo('POST', `/v1/payments/${lateId}/refund`)[0]?.body).toEqual({ amount: 560_640 });
    expect(booking(h, late)).toMatchObject({ status: 'refunded' });
    expect(h.texts()[0]).toContain('arrived after the 15-minute hold');
  });

  it('tells the buyer when there are not enough seats left', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    await bookWithFlow(h, 'laughs:front', { quantity: '4' }, h.as('+919800000066'));
    h.clear();

    await bookWithFlow(h, 'laughs:front', { quantity: '4' });

    expect(h.texts()).toContain('Only 2 seats are left in that tier now.');
    expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
  });

  it('cancels the pending WhatsApp order when the buyer cancels', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    const id = await bookWithFlow(h, 'indie:ga', { quantity: '1' });
    const paymentId = [...h.api.payments.keys()][0] ?? '';
    h.clear();

    await h.user.tap(`bk:cancel:${id}`, 'Cancel booking');

    expect(h.callsTo('POST', `/v1/payments/${paymentId}/status`)[0]?.body).toEqual({
      status: 'canceled',
      description: 'Booking cancelled by the buyer',
    });
    expect(booking(h, id)).toMatchObject({ status: 'cancelled' });
  });

  it('cancels a held booking and releases the seats', async () => {
    const h = setup();
    const id = await bookWithFlow(h, 'laughs:front', { quantity: '6' });
    await h.user.tap(`bk:cancel:${id}`, 'Cancel');

    expect(booking(h, id)).toMatchObject({ status: 'cancelled' });
    await h.user.tap('ev:laughs');
    expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('(only 6 left)') } });
  });
});

describe('event-tickets: after booking', () => {
  async function ticketed(h: Harness<TicketsState>, tier = 'laughs:std'): Promise<string> {
    const id = await bookWithFlow(h, tier);
    await h.user.tap(`pay:sim:${id}`);
    h.clear();
    return id;
  }

  it('adds the event to a calendar and shows the venue', async () => {
    const h = setup();
    const id = await ticketed(h);

    await h.user.tap(`cal:${id}`, 'Add to calendar');
    expect(h.lastInteractive()).toMatchObject({
      type: 'cta_url',
      action: {
        parameters: {
          display_text: 'Add to calendar',
          url: expect.stringMatching(
            /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Late%20Night%20Laughs&dates=20261023T150000Z\/20261023T170000Z&location=Punchline%20Room/,
          ),
        },
      },
    });

    h.clear();
    await h.user.tap(`venue:${id}`);
    expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Punchline Room' });
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining(`Your booking: *${id}* · Admit 2`) },
    });
  });

  it('schedules the reminders the buyer asks for, inside the session, and cancels them on EXIT', async () => {
    const h = setup();
    const id = await ticketed(h);

    await h.user.tap(`rem:${id}`, 'Remind me');

    const scheduled = h.callsTo('POST', '/v1/messages').map((call) => call.body as Record<string, unknown>);
    expect(scheduled).toHaveLength(3);
    expect(scheduled[0]).toMatchObject({
      type: 'template',
      send_at: new Date('2026-10-23T19:30:00+05:30').toISOString(),
      template: {
        name: TEMPLATES.startingSoon,
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'location',
                location: { latitude: '28.5535', longitude: '77.1946', name: 'Punchline Room' },
              },
            ],
          },
          { type: 'body', parameters: [{ text: 'Late Night Laughs' }, { text: id }] },
          { type: 'button', parameters: [{ payload: `tk:show:${id}` }] },
        ],
      },
    });
    expect(scheduled[1]).toMatchObject({
      send_at: new Date('2026-10-23T23:00:00+05:30').toISOString(),
      template: {
        name: TEMPLATES.feedback,
        components: [
          { type: 'body' },
          { index: '0', parameters: [{ payload: `fb:5:${id}` }] },
          { index: '1', parameters: [{ payload: `fb:3:${id}` }] },
          { index: '2', parameters: [{ payload: `fb:1:${id}` }] },
        ],
      },
    });
    expect(h.callsTo('POST', /\/tags$/).at(-1)?.body).toEqual({ tags: ['event-updates:laughs'] });
    expect(h.lastInteractive()).toMatchObject({
      body: {
        text: expect.stringContaining(
          "⏰ I'll message you an hour before, with the map (Today, 7:30 pm), a rating request after the show",
        ),
      },
    });

    h.clear();
    await h.user.tap(`rem:${id}`);
    expect(h.texts()[0]).toContain('already set');

    h.clear();
    await h.user.send('EXIT');
    expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
  });

  it('opts into reminders from the flow checkbox, and is honest about events beyond the session', async () => {
    const h = setup();
    const id = await bookWithFlow(h, 'indie:ga', { quantity: '1', updates: true });
    h.clear();

    await h.user.tap(`pay:sim:${id}`);

    expect(
      h
        .callsTo('POST', '/v1/messages')
        .filter((call) => (call.body as { send_at?: string }).send_at !== undefined),
    ).toHaveLength(0);
    expect(h.lastInteractive()).toMatchObject({
      body: { text: expect.stringContaining('This demo only schedules messages inside its 24-hour session') },
    });
    expect(h.lastChoices()).toEqual([`cal:${id}`, `venue:${id}`, `ci:${id}`]);
  });

  it('previews an organiser update as the approved template', async () => {
    const h = setup();
    const id = await ticketed(h);

    await h.user.tap(`upd:${id}`, 'Live updates');

    expect(h.texts()[0]).toContain('POST /v1/broadcasts');
    expect(h.templates()[0]).toMatchObject({
      name: TEMPLATES.update,
      components: [
        {
          type: 'body',
          parameters: [{ text: 'Late Night Laughs' }, { text: id }, { text: '8:00 pm' }],
        },
      ],
    });
  });

  it('lists tickets and re-shows one from a reminder quick reply', async () => {
    const h = setup();
    const id = await ticketed(h);

    await h.user.send('show my ticket please');
    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      action: { sections: [{ rows: [{ id: `tk:show:${id}`, title: 'Late Night Laughs' }] }] },
    });

    h.clear();
    await h.user.tap(`tk:show:${id}`, 'Show my ticket');
    expect(h.messages()[0]).toMatchObject({ type: 'image' });
    expect(h.lastChoices()).toEqual([`venue:${id}`, `upd:${id}`, `ci:${id}`]);
  });
});

describe('event-tickets: check-in at the door', () => {
  it('checks a guest in with the staff PIN, once, and welcomes them in the chat', async () => {
    const h = setup();
    const id = await bookWithFlow(h, 'laughs:std');
    await h.user.tap(`pay:sim:${id}`);
    const code = booking(h, id)?.code ?? '';
    h.clear();

    await h.user.tap(`ci:${id}`, 'Try check-in');
    expect(h.lastInteractive()).toMatchObject({
      action: { parameters: { url: `https://demo.test/x/event-tickets/checkin/${code}` } },
      body: { text: expect.stringContaining('PIN *2468*') },
    });

    const page = await h.web(`/checkin/${code}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Valid ticket');

    const form = (pin: string) => ({
      method: 'POST' as const,
      body: new URLSearchParams({ pin }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const wrong = await h.web(`/checkin/${code}`, form('0000'));
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).toContain('Wrong staff PIN');
    expect(booking(h, id)?.checkedInAt).toBeNull();

    h.advance(11 * 60 * MINUTE); // 8:00 pm, doors open
    h.clear();
    const done = await h.web(`/checkin/${code}`, form('2468'));
    expect(await done.text()).toContain('Welcome message sent on WhatsApp.');
    expect(h.lastInteractive()).toMatchObject({
      type: 'button',
      header: { type: 'image' },
      body: {
        text: expect.stringContaining(
          'Welcome to *Late Night Laughs*, Asha! ✅ Checked in (admit 2) at 8:00 pm.',
        ),
      },
    });
    expect(h.lastChoices()).toEqual(['sch:laughs', `fb:start:${id}`]);

    h.clear();
    const again = await h.web(`/checkin/${code}`, form('2468'));
    expect(await again.text()).toContain('Already checked in');
    expect(h.messages()).toHaveLength(0);

    expect((await h.web('/checkin/AAAAAAAAAAAAAAAA')).status).toBe(404);
  });

  it('checks in guests whose chat has ended without messaging them', async () => {
    const h = setup();
    const id = await bookWithFlow(h, 'laughs:std');
    await h.user.tap(`pay:sim:${id}`);
    const code = booking(h, id)?.code ?? '';
    await h.user.send('EXIT');
    h.clear();

    const done = await h.web(`/checkin/${code}`, {
      method: 'POST',
      body: 'pin=2468',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(await done.text()).toContain('not in a live demo chat');
    expect(h.messages()).toHaveLength(0);
  });

  it('collects a rating after the show and links the gallery', async () => {
    const h = setup();
    const id = await bookWithFlow(h, 'laughs:std');
    await h.user.tap(`pay:sim:${id}`);
    await h.user.tap(`fb:start:${id}`, 'Rate the event');
    expect(h.lastChoices()).toEqual([`fb:5:${id}`, `fb:3:${id}`, `fb:1:${id}`]);
    h.clear();

    await h.user.tap(`fb:5:${id}`, 'Loved it');

    expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '😍' } });
    expect(h.lastInteractive()).toMatchObject({
      type: 'cta_url',
      action: { parameters: { url: 'https://demo.test/x/event-tickets/gallery/laughs' } },
    });
    expect(booking(h, id)?.rating).toBe(5);
    expect((await h.web('/gallery/laughs')).status).toBe(200);
    expect((await h.web('/scan')).status).toBe(200);
  });

  it('shows the schedule', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    h.clear();
    await h.user.tap('sch:indie', 'Schedule');
    expect(h.texts()[0]).toContain('6:00 pm · Gates open');
  });
});

describe('event-tickets: everything else', () => {
  it('answers free text, stale buttons and unsupported messages with the events', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    h.clear();

    await h.user.send('what is on this weekend?');
    expect(h.interactives()[0]).toMatchObject({
      type: 'carousel',
      body: { text: expect.stringContaining('Tap *Get tickets*') },
    });

    h.clear();
    await h.user.tap('shop:old');
    expect(h.interactives()[0]).toMatchObject({ body: { text: expect.stringContaining('older message') } });

    h.clear();
    await h.user.shareLocation({ latitude: 1, longitude: 2 });
    expect(h.interactives()[0]).toMatchObject({ type: 'carousel' });
  });

  it('ignores payment events for other people’s bookings', async () => {
    const h = setup({ paymentConfiguration: 'demo-store' });
    await bookWithFlow(h, 'indie:ga', { quantity: '1' }, h.as('+919800000066'));
    await h.user.send('DEMO EVENTS');
    const theirs = [...h.api.payments.values()][0];
    h.clear();

    await h.event('payment.captured', { payment: { ...theirs, to: '919800000001' } });

    expect(h.messages()).toHaveLength(0);
  });

  it('logs failed sends without replying', async () => {
    const h = setup();
    await h.user.send('DEMO EVENTS');
    h.clear();
    await h.event('message.failed', { message: { to: h.user.phone, metadata: { demo: 'event-tickets' } } });
    expect(h.messages()).toHaveLength(0);
  });
});
