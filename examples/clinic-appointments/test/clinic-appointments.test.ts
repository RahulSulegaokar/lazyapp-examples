import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { Harness } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import clinic from '../src/index.js';
import { parsePatientText } from '../src/booking.js';
import { TEMPLATES } from '../src/manifest.js';
import { rosterSlots, timeLabel, whenLabel } from '../src/schedule.js';
import { DOCTORS } from '../src/clinic.js';
import type { ClinicState } from '../src/state.js';

/** Friday 23 Oct 2026, 09:00 IST (the harness default). */
const HOUR = 60 * 60 * 1000;
const harnesses: { close(): void }[] = [];
const setup = (options?: Parameters<typeof createHarness>[1]) => {
  const harness = createHarness(clinic, { displayName: 'Asha Rao', ...options });
  harnesses.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

type H = Harness<ClinicState>;

const flowData = (result: Awaited<ReturnType<H['flowExchange']>>) => {
  if (result.status !== 200) {
    throw new Error(`flow exchange failed: ${result.status}`);
  }
  return result.body as { screen: string; data: Record<string, unknown> };
};

/** Start → General Medicine → Dr. Kavita Rao → consent → book flow sent. */
async function openBookFlow(h: H, phone?: string): Promise<void> {
  const user = phone === undefined ? h.user : h.as(phone);
  await user.send('DEMO CLINIC');
  await user.choose('menu:book');
  await user.choose('spec:gp');
  await user.choose('doc:kavita-rao');
  await user.tap('doc:slot:kavita-rao');
  await user.tap('consent:yes');
}

/** Holds Sat 24 Oct 10:30 with Dr. Rao through the Flow endpoint and submits the flow. */
async function bookSaturday(h: H, time = '10:30'): Promise<string> {
  await openBookFlow(h);
  const result = flowData(
    await h.flowExchange('book', {
      action: 'data_exchange',
      screen: 'PATIENT',
      data: {
        trigger: 'book',
        date: '2026-10-24',
        time,
        patient_name: 'Asha Rao',
        age: '32',
        gender: 'female',
        reason: 'Fever for 3 days',
      },
    }),
  );
  const params = (result.data.extension_message_response as { params: { booking_id: string } }).params;
  await h.user.submitFlow({ booking_id: params.booking_id });
  return params.booking_id;
}

describe('clinic appointments', () => {
  it('stays silent for people who did not send the start code', async () => {
    const h = setup();
    expect(await h.user.send('hello doctor')).toEqual({ status: 'ignored', reason: 'not in a demo' });
    expect(await h.user.send('book appointment')).toMatchObject({ status: 'ignored' });
    expect(h.calls).toHaveLength(0);
  });

  it('greets by name with the front-desk menu', async () => {
    const h = setup();
    await h.user.send('demo clinic');

    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      header: { text: 'Aarogya Clinics' },
      body: { text: expect.stringContaining('Namaste Asha') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual([
      'menu:book',
      'menu:appointment',
      'menu:reports',
      'menu:branches',
      'menu:emergency',
      'menu:privacy',
    ]);
    expect(h.state()?.businessNumber).toBe('+910000000000');
  });

  describe('choosing a doctor', () => {
    it('lists specialties, then doctors, then a profile card with a photo header', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      await h.user.choose('menu:book');
      expect(h.lastChoices()).toHaveLength(7);

      await h.user.choose('spec:gp');
      expect(h.lastChoices()).toEqual(['doc:kavita-rao', 'doc:sanjay-hegde']);

      await h.user.choose('doc:kavita-rao');
      expect(h.lastInteractive()).toMatchObject({
        type: 'button',
        header: { type: 'image', image: { link: expect.stringContaining('images.unsplash.com') } },
        body: { text: expect.stringMatching(/Dr\. Kavita Rao[\s\S]*₹600[\s\S]*Next available: Fri, 23 Oct/) },
      });
      expect(h.lastChoices()).toEqual(['doc:slot:kavita-rao', 'menu:book']);
    });

    it('goes straight to the doctor when a specialty has one', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      await h.user.choose('spec:cardio');
      expect(h.lastChoices()).toEqual(['doc:slot:rajesh-iyer', 'menu:book']);
    });

    it('asks for consent before collecting health data, and sends the notice on request', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      await h.user.choose('doc:kavita-rao');
      await h.user.tap('doc:slot:kavita-rao');
      expect(h.lastChoices()).toEqual(['consent:yes', 'consent:read', 'consent:no']);
      h.clear();

      await h.user.tap('consent:read');
      expect(h.messages()[0]).toMatchObject({
        type: 'document',
        media_url: 'https://demo.test/public/clinic-appointments/privacy-notice.pdf',
        filename: 'Aarogya-Clinics-Privacy-Notice.pdf',
      });
      expect(h.lastChoices()).toEqual(['consent:yes', 'consent:read', 'consent:no']);

      await h.user.tap('consent:no');
      expect(h.state()).toMatchObject({ consent: false, step: 'menu' });
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('Nothing was saved') },
      });
    });
  });

  describe('the live-slot Flow', () => {
    it('sends a data_exchange flow once consent is given', async () => {
      const h = setup();
      await openBookFlow(h);

      expect(h.lastInteractive()).toMatchObject({
        type: 'flow',
        action: {
          parameters: {
            flow_id: 'meta-flow-clinic-appointments-book',
            flow_action: 'data_exchange',
            flow_token: expect.stringMatching(/^clinic-appointments\./),
          },
        },
      });
      expect(h.state()).toMatchObject({ consent: true, step: 'slot', doctorId: 'kavita-rao', intent: 'new' });
    });

    it('answers INIT with open dates and data_exchange with live times', async () => {
      const h = setup();
      await openBookFlow(h);

      const init = flowData(await h.flowExchange('book', { action: 'INIT' }));
      expect(init.screen).toBe('APPOINTMENT');
      expect(init.data).toMatchObject({
        doctor_name: 'Dr. Kavita Rao',
        doctor_meta: 'General Medicine · Koramangala · Fee ₹600',
        slots_visible: false,
        has_error: false,
      });
      // Fri 23 → Thu 29, minus Sunday.
      expect((init.data.dates as { id: string }[]).map((date) => date.id)).toEqual([
        '2026-10-23',
        '2026-10-24',
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
      ]);

      const today = flowData(
        await h.flowExchange('book', {
          action: 'data_exchange',
          screen: 'APPOINTMENT',
          data: { trigger: 'date_selected', date: '2026-10-23' },
        }),
      );
      const times = (today.data.slots as { id: string }[]).map((slot) => slot.id);
      // Nothing earlier than an hour from now (09:00 → first slot 10:00).
      expect(times[0]).toBe('10:00');
      expect(times).not.toContain('09:30');
      expect(today.data.slots_visible).toBe(true);
    });

    it('moves to patient details for a free slot and rejects a taken one', async () => {
      const h = setup();
      await openBookFlow(h);
      const next = flowData(
        await h.flowExchange('book', {
          action: 'data_exchange',
          screen: 'APPOINTMENT',
          data: { trigger: 'slot_chosen', date: '2026-10-24', time: '10:30' },
        }),
      );
      expect(next).toMatchObject({
        screen: 'PATIENT',
        data: {
          summary: 'Dr. Kavita Rao · Sat, 24 Oct · 10:30 AM · ₹600',
          date: '2026-10-24',
          time: '10:30',
        },
      });

      // Someone else holds 10:30 on Saturday.
      await bookSaturday(h);
      await openBookFlow(h, '+919800000002');
      const taken = flowData(
        await h.flowExchange(
          'book',
          {
            action: 'data_exchange',
            screen: 'APPOINTMENT',
            data: { trigger: 'slot_chosen', date: '2026-10-24', time: '10:30' },
          },
          '+919800000002',
        ),
      );
      expect(taken).toMatchObject({
        screen: 'APPOINTMENT',
        data: { has_error: true, error_message: expect.stringContaining('just taken') },
      });
      expect((taken.data.slots as { id: string }[]).map((slot) => slot.id)).not.toContain('10:30');
    });

    it('validates patient details and holds the slot on the last step', async () => {
      const h = setup();
      await openBookFlow(h);
      const invalid = flowData(
        await h.flowExchange('book', {
          action: 'data_exchange',
          screen: 'PATIENT',
          data: { trigger: 'book', date: '2026-10-24', time: '10:30', patient_name: 'Asha', age: '300' },
        }),
      );
      expect(invalid).toMatchObject({ screen: 'PATIENT', data: { has_error: true } });

      const bookingId = await bookSaturday(h);
      expect(bookingId).toMatch(/^[A-Z2-9]{6}$/);
      expect(h.state()).toMatchObject({
        step: 'review',
        draft: null,
        booking: {
          id: bookingId,
          status: 'held',
          patient: { name: 'Asha Rao', age: 32, gender: 'female' },
          reason: 'Fever for 3 days',
          fee: 60000,
        },
      });
      expect(h.lastInteractive()).toMatchObject({
        header: { text: 'Slot held for 15 minutes ⏳' },
        body: { text: expect.stringContaining(`Booking ID *${bookingId}*`) },
      });
      expect(h.lastChoices()).toEqual(['pay:online', 'pay:clinic', 'slot:change']);
    });

    it('refuses unknown or expired flow tokens with 427', async () => {
      const h = setup();
      await openBookFlow(h);
      expect(
        await h.flowExchange('book', { action: 'INIT', flow_token: 'clinic-appointments.forged' }),
      ).toMatchObject({
        status: 427,
      });
      h.advance(25 * HOUR);
      expect(await h.flowExchange('book', { action: 'INIT' })).toMatchObject({ status: 427 });
    });

    it('re-opens a fresh form when an old flow is submitted', async () => {
      const h = setup();
      await openBookFlow(h);
      h.clear();
      await h.user.submitFlow({ booking_id: 'STALE1' });
      expect(h.texts()[0]).toContain('expired');
      expect(h.lastInteractive()).toMatchObject({ type: 'flow' });
    });
  });

  describe('payment', () => {
    it('sends a WhatsApp order and confirms on payment.captured', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      const bookingId = await bookSaturday(h);
      h.clear();

      await h.user.tap('pay:online');

      const [payment] = h.callsTo('POST', '/v1/payments');
      expect(payment?.body).toMatchObject({
        to: h.user.phone,
        reference_id: `AAR-${bookingId}`,
        goods_type: 'digital-goods',
        expires_in_minutes: 15,
        items: [
          {
            name: 'Consultation · Dr. Kavita Rao',
            amount: 60000,
            quantity: 1,
            retailer_id: 'consult-kavita-rao',
          },
        ],
        payment: { method: 'payment_gateway', configuration: 'aarogya-razorpay' },
        metadata: { booking_id: bookingId },
      });
      expect(payment?.idempotencyKey).toContain(`payment:${bookingId}:1`);
      expect(h.state()?.booking).toMatchObject({ status: 'awaiting_payment', payMode: 'online' });
      h.clear();

      await h.payPayment();

      expect(h.callsTo('POST', /^\/v1\/payments\/pay_\d+\/status$/)[0]?.body).toMatchObject({
        status: 'processing',
      });
      expect(h.lastInteractive()).toMatchObject({
        header: { text: 'Appointment confirmed ✅' },
        body: { text: expect.stringContaining('Paid ₹600 online') },
      });
      expect(h.lastChoices()).toEqual(['remind:on', 'previsit', 'appt:directions']);
      expect(h.state()?.booking).toMatchObject({ status: 'confirmed', paid: true });

      // Redelivery of the same webhook changes nothing.
      h.clear();
      await h.replayLast();
      expect(h.messages()).toHaveLength(0);
    });

    it('offers a retry with a fresh reference when the payment fails', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      const bookingId = await bookSaturday(h);
      await h.user.tap('pay:online');
      const order = [...h.api.payments.values()].at(-1)!;
      h.clear();

      await h.event('payment.failed', {
        payment: { ...order, payment_status: 'failed', last_error: 'UPI PIN incorrect' },
      });
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining("didn't go through (UPI PIN incorrect)") },
      });
      expect(h.lastChoices()).toEqual(['pay:online', 'pay:clinic']);

      await h.user.tap('pay:online');
      expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
        reference_id: `AAR-${bookingId}-2`,
      });
    });

    it('ignores payment events for other bookings', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      await bookSaturday(h);
      await h.user.tap('pay:online');
      const order = [...h.api.payments.values()].at(-1)!;
      h.clear();
      await h.event('payment.captured', { payment: { ...order, metadata: { booking_id: 'OTHER1' } } });
      expect(h.messages()).toHaveLength(0);
      expect(h.state()?.booking?.status).toBe('awaiting_payment');
    });

    it('uses a payment link when only a gateway account is configured', async () => {
      const h = setup({ config: { capabilities: { paymentGatewayAccount: 'gw_cashfree' } } });
      await bookSaturday(h);
      await h.user.tap('pay:online');
      expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
        payment: { method: 'payment_link', gateway_account: 'gw_cashfree' },
      });
    });

    it('falls back to pay at the clinic, and says so, when payments are not set up', async () => {
      const h = setup();
      await bookSaturday(h);
      h.clear();

      await h.user.tap('pay:online');

      expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
      expect(h.texts()[0]).toContain("Online payment isn't set up on this demo number");
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('₹600 payable at the front desk') },
      });
      expect(h.state()?.booking).toMatchObject({ status: 'confirmed', payMode: 'clinic', paid: false });
    });

    it('falls back when LazyApp refuses the payment request', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      h.api.on('POST', '/v1/payments', () => ({
        status: 422,
        body: {
          message: 'Accept the WhatsApp payment terms first.',
          code: 'provider_134011',
          retryable: false,
        },
      }));
      await bookSaturday(h);
      h.clear();

      await h.user.tap('pay:online');

      expect(h.texts()[0]).toContain('Accept the WhatsApp payment terms first.');
      expect(h.state()?.booking).toMatchObject({ status: 'confirmed', payMode: 'clinic' });
    });

    it('confirms with pay at clinic directly', async () => {
      const h = setup();
      await bookSaturday(h);
      await h.user.tap('pay:clinic');
      expect(h.state()?.booking?.status).toBe('confirmed');
      expect(h.store.keyValue('example:clinic-appointments', () => h.now()).list('slot:')).toEqual([
        expect.objectContaining({ value: expect.objectContaining({ status: 'booked' }) }),
      ]);
    });

    it('refunds and re-offers slots when a lapsed hold was taken before the payment landed', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      await bookSaturday(h);
      await h.user.tap('pay:online');
      const order = [...h.api.payments.values()].at(-1)!;

      h.advance(20 * 60 * 1000);
      const other = h.as('+919800000002');
      await other.send('DEMO CLINIC');
      await other.choose('doc:kavita-rao');
      await other.tap('doc:slot:kavita-rao');
      await other.tap('consent:yes');
      await h.flowExchange(
        'book',
        {
          action: 'data_exchange',
          screen: 'PATIENT',
          data: { trigger: 'book', date: '2026-10-24', time: '10:30', patient_name: 'Kabir', age: '40' },
        },
        other.phone,
      );
      await other.submitFlow({ booking_id: h.state(other.phone)!.draft!.bookingId });
      await other.tap('pay:clinic');
      h.clear();

      await h.payPayment(order.id);

      expect(h.callsTo('POST', `/v1/payments/${order.id}/refund`)[0]?.body).toEqual({ amount: 60000 });
      expect(h.texts()[0]).toContain('lapsed and another patient booked it');
      expect(h.texts()[0]).toContain('₹600 is being refunded');
      expect(h.state()?.booking).toBeNull();
    });

    it('confirms with an approved template when the payment lands after the 24h window', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay', config: { sessionIdleMs: 72 * HOUR } });
      const bookingId = await bookSaturday(h);
      await h.user.tap('pay:online');
      h.advance(25 * HOUR);
      h.clear();

      await h.payPayment();

      expect(h.templates()).toEqual([
        expect.objectContaining({
          name: TEMPLATES.confirmation,
          components: expect.arrayContaining([
            expect.objectContaining({
              type: 'body',
              parameters: [
                { type: 'text', text: 'Asha' },
                { type: 'text', text: 'Dr. Kavita Rao' },
                { type: 'text', text: 'Sat, 24 Oct · 10:30 AM' },
                { type: 'text', text: bookingId },
              ],
            }),
          ]),
        }),
      ]);
      expect(h.interactives()).toHaveLength(0);
    });
  });

  describe('after booking', () => {
    async function confirmed(h: H): Promise<string> {
      const id = await bookSaturday(h);
      await h.user.tap('pay:clinic');
      return id;
    }

    it('schedules 24h and 1h reminder templates on request, and EXIT cancels them', async () => {
      const h = setup();
      await confirmed(h);
      h.clear();

      await h.user.tap('remind:on');

      const scheduled = h
        .callsTo('POST', '/v1/messages')
        .filter((call) => (call.body as { send_at?: string }).send_at);
      expect(scheduled.map((call) => (call.body as { send_at: string }).send_at)).toEqual([
        new Date('2026-10-23T10:30:00+05:30').toISOString(),
        new Date('2026-10-24T09:30:00+05:30').toISOString(),
      ]);
      expect(scheduled[0]?.body).toMatchObject({
        type: 'template',
        template: {
          name: TEMPLATES.reminder,
          components: [
            {
              type: 'body',
              parameters: [
                { text: 'Dr. Kavita Rao' },
                { text: 'Sat, 24 Oct' },
                { text: '10:30 AM' },
                { text: 'Koramangala' },
              ],
            },
            { sub_type: 'quick_reply', parameters: [{ payload: 'appt:attend' }] },
            { sub_type: 'quick_reply', parameters: [{ payload: 'appt:reschedule' }] },
          ],
        },
      });
      expect(Object.keys(h.session()!.meta.followUps)).toEqual(['reminder-24h', 'reminder-1h']);
      expect(h.state()?.booking?.remindersOn).toBe(true);
      h.clear();

      await h.user.send('EXIT');
      expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
      expect(h.api.scheduled.size).toBe(0);
    });

    it('handles the reminder quick replies', async () => {
      const h = setup();
      await confirmed(h);
      await h.user.tap('remind:on');
      h.clear();

      await h.user.tap('appt:attend', "I'll be there");
      expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '✅' } });
      expect(h.texts()[0]).toContain('See you on Sat, 24 Oct');

      await h.user.tap('remind:off');
      expect(h.state()?.booking?.remindersOn).toBe(false);
      expect(h.api.scheduled.size).toBe(0);
    });

    it('shows the booking with management options', async () => {
      const h = setup();
      const id = await confirmed(h);
      await h.user.choose('menu:appointment');
      expect(h.lastInteractive()).toMatchObject({
        type: 'list',
        body: { text: expect.stringContaining(`Booking ID *${id}*`) },
      });
      expect(h.lastChoices()).toEqual([
        'appt:reschedule',
        'appt:cancel',
        'previsit',
        'appt:directions',
        'remind:on',
      ]);

      await h.user.choose('appt:directions');
      expect(h.lastMessage()).toMatchObject({ type: 'location', name: 'Aarogya Clinics Koramangala' });
    });

    it('reschedules through the flow without asking for patient details again', async () => {
      const h = setup();
      const id = await confirmed(h);
      await h.user.tap('remind:on');
      await h.user.choose('appt:reschedule');
      expect(h.state()).toMatchObject({ intent: 'reschedule' });

      const done = flowData(
        await h.flowExchange('book', {
          action: 'data_exchange',
          screen: 'APPOINTMENT',
          data: { trigger: 'slot_chosen', date: '2026-10-26', time: '17:00' },
        }),
      );
      expect(done.screen).toBe('SUCCESS');
      h.clear();
      await h.user.submitFlow({ booking_id: id });

      expect(h.state()?.booking).toMatchObject({
        id,
        date: '2026-10-26',
        time: '17:00',
        status: 'confirmed',
      });
      expect(h.lastInteractive()).toMatchObject({
        header: { text: 'Rescheduled ✅' },
        body: { text: expect.stringContaining('Mon, 26 Oct · 5:00 PM') },
      });
      // Reminders moved: the old ones were cancelled and new ones scheduled.
      expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
      const kv = h.store.keyValue('example:clinic-appointments', () => h.now());
      expect(kv.get('slot:kavita-rao:2026-10-24:10:30')).toBeUndefined();
      expect(kv.get('slot:kavita-rao:2026-10-26:17:00')).toMatchObject({ bookingId: id, status: 'booked' });
    });

    it('refuses to reschedule within 2 hours of the visit', async () => {
      const h = setup();
      await confirmed(h);
      h.advance(12 * HOUR);
      await h.user.send('MENU');
      h.advance(12 * HOUR); // Sat 09:00, visit at 10:30.
      await h.user.choose('appt:reschedule');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('closes 2 hours before') },
      });
    });

    it('cancels with a full refund when paid online and far enough ahead', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      await bookSaturday(h);
      await h.user.tap('pay:online');
      await h.payPayment();
      await h.user.tap('remind:on');
      await h.user.choose('appt:cancel');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('refunded in full') },
      });
      h.clear();

      await h.user.tap('cancel:yes');

      expect(h.callsTo('POST', /\/refund$/)[0]?.body).toEqual({ amount: 60000 });
      expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(2);
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('refund of ₹600') },
      });
      expect(h.state()?.booking?.status).toBe('cancelled');
    });

    it('keeps the fee within 4 hours, and "Keep it" changes nothing', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      await bookSaturday(h);
      await h.user.tap('pay:online');
      await h.payPayment();
      h.advance(22 * HOUR); // Sat 07:00, visit at 10:30.
      await h.user.choose('appt:cancel');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('not refundable') },
      });
      await h.user.tap('cancel:no');
      expect(h.state()?.booking?.status).toBe('confirmed');
      h.clear();
      await h.user.choose('appt:cancel');
      await h.user.tap('cancel:yes');
      expect(h.callsTo('POST', /\/refund$/)).toHaveLength(0);
    });

    it('collects the pre-visit form through a navigate flow', async () => {
      const h = setup();
      const id = await confirmed(h);
      await h.user.tap('previsit');
      expect(h.lastInteractive()).toMatchObject({
        type: 'flow',
        action: { parameters: { flow_action: 'navigate', flow_action_payload: { screen: 'INTAKE' } } },
      });
      h.clear();

      await h.user.submitFlow({
        concern: 'Sore throat and fever',
        duration: 'days',
        conditions: ['asthma'],
        allergies: 'Penicillin',
        medications: '',
      });

      expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '📝' } });
      expect(h.lastInteractive()).toMatchObject({
        body: {
          text: expect.stringMatching(/Sore throat and fever \(a few days\)[\s\S]*asthma[\s\S]*Penicillin/),
        },
      });
      expect(h.state()?.booking?.previsitDone).toBe(true);
      expect(
        h.store.keyValue('example:clinic-appointments', () => h.now()).get(`previsit:${id}`),
      ).toMatchObject({
        concern: 'Sore throat and fever',
      });
    });

    it('attaches photos and PDFs the patient sends to the booking', async () => {
      const h = setup();
      const id = await confirmed(h);
      h.clear();
      await h.user.sendMedia('document', { filename: 'old-ecg.pdf', mime_type: 'application/pdf' });
      expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '📎' } });
      expect(h.texts()[0]).toContain(`Attached old-ecg.pdf to booking ${id} (1 file)`);

      await h.user.sendMedia('audio');
      expect(h.texts().at(-1)).toContain('photo or a PDF');
      expect(h.state()?.booking?.files).toBe(1);
    });

    it('sends the prescription and report PDFs after the visit, then books a cheaper follow-up', async () => {
      const h = setup({ paymentConfiguration: 'aarogya-razorpay' });
      await bookSaturday(h);
      await h.user.tap('pay:online');
      await h.payPayment();
      h.clear();

      await h.user.choose('menu:reports');

      expect(h.callsTo('POST', /\/status$/)[0]?.body).toMatchObject({ status: 'completed' });
      expect(h.messages()[0]).toMatchObject({
        type: 'document',
        media_url: 'https://demo.test/public/clinic-appointments/prescription-sample.pdf',
        filename: 'Prescription-Dr-Kavita-Rao-20261024.pdf',
      });
      expect(h.lastInteractive()).toMatchObject({
        header: {
          type: 'document',
          document: {
            link: expect.stringContaining('lab-report-sample.pdf'),
            filename: 'CBC-Report-20261024.pdf',
          },
        },
      });
      expect(h.state()).toMatchObject({
        booking: { status: 'completed' },
        lastVisit: { doctorId: 'kavita-rao' },
      });

      await h.user.tap('followup:book');
      expect(h.state()?.intent).toBe('follow-up');
      const init = flowData(await h.flowExchange('book', { action: 'INIT' }));
      expect(init.data.doctor_meta).toContain('Fee ₹300');
    });

    it('explains reports before there is a visit', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      await h.user.choose('menu:reports');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('right after your visit') },
      });
      expect(h.lastChoices()).toEqual(['menu:book', 'demo:menu']);
    });
  });

  describe('when the flows are not published', () => {
    it('books through lists and a typed name, and says why', async () => {
      const h = setup({ flowsPublished: false });
      await h.user.send('DEMO CLINIC');
      await h.user.choose('doc:kavita-rao');
      await h.user.tap('doc:slot:kavita-rao');
      await h.user.tap('consent:yes');

      expect(h.lastInteractive()).toMatchObject({
        type: 'list',
        body: { text: expect.stringContaining('not published on this number') },
      });
      expect(h.lastChoices()[0]).toBe('date:2026-10-23');

      await h.user.choose('date:2026-10-24');
      const choices = h.lastChoices();
      expect(choices).toHaveLength(10);
      expect(choices.at(-1)).toBe('times:more:9');

      await h.user.choose('times:more:9');
      expect(h.lastChoices()[0]).toBe('time:11:45');

      await h.user.choose('time:11:45');
      expect(h.texts().at(-1)).toContain('Holding *Sat, 24 Oct · 11:45 AM*');

      await h.user.send('just me');
      expect(h.texts().at(-1)).toContain('I need a name and an age');

      await h.user.send('Asha Rao, 32');
      expect(h.state()?.booking).toMatchObject({ time: '11:45', patient: { name: 'Asha Rao', age: 32 } });
      expect(h.lastChoices()).toEqual(['pay:online', 'pay:clinic', 'slot:change']);
    });

    it('releases the first hold when the patient changes the slot', async () => {
      const h = setup({ flowsPublished: false });
      await h.user.send('DEMO CLINIC');
      await h.user.choose('doc:kavita-rao');
      await h.user.tap('doc:slot:kavita-rao');
      await h.user.tap('consent:yes');
      await h.user.choose('date:2026-10-24');
      await h.user.choose('time:10:30');
      await h.user.send('Asha Rao 32');
      await h.user.tap('slot:change');
      const kv = h.store.keyValue('example:clinic-appointments', () => h.now());
      expect(kv.list('slot:')).toHaveLength(0);
      expect(h.lastChoices()[0]).toBe('date:2026-10-23');
    });

    it('takes the pre-visit answers as one chat message', async () => {
      const h = setup({ flowsPublished: false });
      await h.user.send('DEMO CLINIC');
      await h.user.choose('doc:kavita-rao');
      await h.user.tap('doc:slot:kavita-rao');
      await h.user.tap('consent:yes');
      await h.user.choose('date:2026-10-24');
      await h.user.choose('time:10:30');
      await h.user.send('Asha Rao, 32');
      await h.user.tap('pay:clinic');
      await h.user.tap('previsit');
      expect(h.texts().at(-1)).toContain('not published');

      await h.user.send('Fever since Monday, allergic to sulfa, take metformin');
      expect(h.state()?.booking?.previsitDone).toBe(true);
    });
  });

  describe('clinic information', () => {
    it('finds the nearest branch from a shared location', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      await h.user.choose('menu:branches');
      expect(h.lastInteractive()).toMatchObject({ type: 'location_request_message' });
      h.clear();

      await h.user.shareLocation({ latitude: 12.978, longitude: 77.64 });

      expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'Aarogya Clinics Indiranagar' });
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringMatching(/closest, about \d+ m away/) },
      });

      await h.user.tap('branches:all');
      expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('HSR Layout') } });
    });

    it('sends emergency guidance and contact cards', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      h.clear();
      await h.user.choose('menu:emergency');

      expect(h.texts()[0]).toContain('call 108 now');
      expect(h.lastMessage()).toMatchObject({
        type: 'contacts',
        contacts: [
          { name: { formatted_name: 'Aarogya Clinics 24x7 Desk' }, phones: [{ phone: '+910000000000' }] },
          { name: { formatted_name: 'Ambulance (India)' }, phones: [{ phone: '108' }] },
        ],
      });
    });

    it('sends the privacy notice PDF', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      await h.user.choose('menu:privacy');
      expect(h.lastMessage()).toMatchObject({
        type: 'document',
        filename: 'Aarogya-Clinics-Privacy-Notice.pdf',
      });
    });
  });

  describe('edges', () => {
    it('nudges on unexpected input, understands keywords, and handles stale buttons', async () => {
      const h = setup();
      await h.user.send('DEMO CLINIC');
      h.clear();

      await h.user.send('what is the weather');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining("didn't catch that") },
      });

      await h.user.send('I want to book a doctor');
      expect(h.lastChoices()).toHaveLength(7);

      await h.user.tap('pay:online');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining("didn't catch that") },
      });

      await h.user.sendMedia('image');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('Book one first') },
      });

      await h.user.message('ephemeral', {});
      expect(h.lastInteractive()).toMatchObject({ type: 'list' });
    });

    it('releases a held slot on EXIT so others can book it', async () => {
      const h = setup();
      await bookSaturday(h);
      await h.user.send('EXIT');
      const kv = h.store.keyValue('example:clinic-appointments', () => h.now());
      expect(kv.list('slot:')).toHaveLength(0);
      expect(await h.user.send('hello')).toMatchObject({ status: 'ignored' });
    });

    it('ends quietly after 24 hours idle and frees the hold', async () => {
      const h = setup();
      await bookSaturday(h);
      h.advance(25 * HOUR);
      h.clear();
      expect(await h.user.send('pay now')).toMatchObject({ status: 'ignored' });
      expect(h.messages()).toHaveLength(0);
      expect(h.store.keyValue('example:clinic-appointments', () => h.now()).list('slot:')).toHaveLength(0);
    });

    it('keeps two patients apart', async () => {
      const h = setup();
      await bookSaturday(h);
      await h.as('+919800000002').send('DEMO CLINIC');
      expect(h.state('+919800000002')).toMatchObject({ booking: null, consent: false });
    });
  });

  describe('helpers', () => {
    it('parses typed patient details', () => {
      expect(parsePatientText('Asha Rao, 32')).toEqual({ name: 'Asha Rao', age: 32, gender: null });
      expect(parsePatientText('Kabir 4 yrs')).toEqual({ name: 'Kabir', age: 4, gender: null });
      expect(parsePatientText('32')).toBeNull();
      expect(parsePatientText('Asha, 300')).toBeNull();
    });

    it('builds rosters and labels in IST', () => {
      const rao = DOCTORS.find((doctor) => doctor.id === 'kavita-rao')!;
      expect(rosterSlots(rao, '2026-10-25')).toEqual([]); // Sunday
      expect(rosterSlots(rao, '2026-10-24')).toHaveLength(16 + 12);
      expect(timeLabel('17:00')).toBe('5:00 PM');
      expect(timeLabel('00:15')).toBe('12:15 AM');
      expect(whenLabel('2026-10-24', '10:30')).toBe('Sat, 24 Oct · 10:30 AM');
    });
  });
});
