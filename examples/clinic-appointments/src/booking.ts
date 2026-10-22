import { DEMO_FOOTER, formatInr, FlowUnavailableError, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { PaymentsInfo } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { CreatePaymentInput, PaymentOrder } from '@lazyapp-examples/sdk';
import { bookingIdFrom, feeFor } from './book-endpoint.js';
import {
  doctorLine,
  doctorsFor,
  findBranch,
  findDoctor,
  findSpecialty,
  HOLD_MS,
  SPECIALTIES,
} from './clinic.js';
import type { Doctor } from './clinic.js';
import type { Ctx } from './context.js';
import { assetUrl } from './context.js';
import { FLOWS, TEMPLATE_PAYLOADS, TEMPLATES } from './manifest.js';
import { nudge, showMenu } from './menu.js';
import { dayLabel, SlotBook, timeLabel, whenLabel } from './schedule.js';
import type { Booking, ClinicState, Draft, Patient } from './state.js';

export const BOOKING_IDS = {
  consentYes: 'consent:yes',
  consentRead: 'consent:read',
  consentNo: 'consent:no',
  payOnline: 'pay:online',
  payClinic: 'pay:clinic',
  changeSlot: 'slot:change',
  remind: 'remind:on',
  previsit: 'previsit',
  directions: 'appt:directions',
} as const;

const TIMES_PER_PAGE = 9;

const slotsOf = (ctx: Ctx) => new SlotBook(ctx.kv, ctx.now);

// --- Choosing a doctor ------------------------------------------------------------

export async function showSpecialties(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'specialty', intent: 'new' }));
  await ctx.send.list({
    header: 'Book an appointment',
    body: 'Which specialist would you like to see? Every doctor shows live availability for the next 7 days.',
    button: 'Choose specialty',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Specialties',
        rows: SPECIALTIES.map((specialty) => ({
          id: `spec:${specialty.id}`,
          title: specialty.title,
          description: specialty.description,
        })),
      },
    ],
  });
}

export async function onSpecialty(ctx: Ctx, specialtyId: string): Promise<void> {
  const specialty = findSpecialty(specialtyId);
  const doctors = doctorsFor(specialtyId);
  const [only] = doctors;
  if (specialty === undefined || only === undefined) {
    return showSpecialties(ctx);
  }
  ctx.setState((state) => ({ ...state, specialtyId, step: 'doctor' }));
  if (doctors.length === 1) {
    return showDoctor(ctx, only);
  }
  await ctx.send.list({
    header: specialty.title,
    body: `${doctors.length} doctors in ${specialty.title}. Fees are per consultation; follow-ups within 14 days are half price.`,
    button: 'Choose doctor',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: specialty.title,
        rows: doctors.map((doctor) => ({
          id: `doc:${doctor.id}`,
          title: doctor.name,
          description: `${doctor.qualifications.split(',')[0] ?? ''} · ${doctor.experienceYears} yrs · ${formatInr(doctor.fee)} · ${findBranch(doctor.branch)?.name.replace('Aarogya Clinics ', '') ?? ''}`,
        })),
      },
    ],
  });
}

/** A doctor's profile card: photo header, credentials, fee and roster. */
export async function showDoctor(ctx: Ctx, doctor: Doctor): Promise<void> {
  ctx.setState((state) => ({ ...state, doctorId: doctor.id, step: 'doctor' }));
  const open = slotsOf(ctx).openDates(doctor, ctx.user.address);
  const next = open[0];
  await ctx.send.buttons({
    header: { image: doctor.photo },
    body: [
      `*${doctor.name}*`,
      doctor.qualifications,
      `${doctorLine(doctor)} · ${doctor.experienceYears} years`,
      `Speaks ${doctor.languages}`,
      `Consultation ${formatInr(doctor.fee)} · follow-up ${formatInr(doctor.followUpFee)}`,
      next === undefined
        ? 'Fully booked for the next 7 days.'
        : `Next available: ${dayLabel(next.date)} (${next.free} slots)`,
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: `doc:slot:${doctor.id}`, title: 'Pick a slot' },
      { id: 'menu:book', title: 'Other doctors' },
    ],
  });
}

// --- Consent, then the slot picker ------------------------------------------------------

/** Entry point for every slot pick: a new booking, a follow-up or a reschedule. */
export async function startSlotPick(
  ctx: Ctx,
  doctorId: string,
  intent: ClinicState['intent'],
): Promise<void> {
  const doctor = findDoctor(doctorId);
  if (doctor === undefined) {
    return showSpecialties(ctx);
  }
  ctx.setState((state) => ({ ...state, doctorId, intent, pickedDate: null, timesOffset: 0 }));
  if (!ctx.state.consent) {
    return askConsent(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'slot' }));
  if (await ctx.flows.isAvailable(FLOWS.book)) {
    try {
      await ctx.flows.send({
        key: FLOWS.book,
        header: intent === 'reschedule' ? 'Reschedule' : 'Book an appointment',
        body: `Pick a date and time with ${doctor.name}. Slots are live: what you see is free right now, and I hold yours for 15 minutes while you pay.`,
        cta: 'Choose a slot',
        footer: DEMO_FOOTER,
      });
      return;
    } catch (error) {
      if (!(error instanceof FlowUnavailableError)) {
        throw error;
      }
    }
  }
  await showDates(ctx, doctor, true);
}

/** DPDP Act 2023: ask before collecting health data, with the notice one tap away. */
async function askConsent(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'consent' }));
  await ctx.send.buttons({
    header: 'Before we book',
    body: "To book, we'll collect the patient's name, age and reason for visit, and share them only with your doctor and our front desk. We never use health data for marketing. You can withdraw consent any time by sending STOP.",
    footer: DEMO_FOOTER,
    buttons: [
      { id: BOOKING_IDS.consentYes, title: 'I agree' },
      { id: BOOKING_IDS.consentRead, title: 'Read the notice' },
      { id: BOOKING_IDS.consentNo, title: 'Not now' },
    ],
  });
}

export async function onConsent(ctx: Ctx, choice: string): Promise<void> {
  if (choice === BOOKING_IDS.consentRead) {
    await ctx.send.document(
      assetUrl(ctx, 'privacy-notice.pdf'),
      'Aarogya-Clinics-Privacy-Notice.pdf',
      'Our privacy notice (1 page).',
    );
    return askConsent(ctx);
  }
  if (choice === BOOKING_IDS.consentNo) {
    return showMenu(
      ctx,
      'No problem. Nothing was saved. You can still see branches, hours and emergency contacts.',
    );
  }
  ctx.setState((state) => ({ ...state, consent: true }));
  ctx.kv.set(`consent:${ctx.session.id}`, { at: ctx.now().toISOString(), purpose: 'appointments' });
  const doctorId = ctx.state.doctorId;
  if (doctorId === null) {
    return showSpecialties(ctx);
  }
  return startSlotPick(ctx, doctorId, ctx.state.intent);
}

// --- List fallback when the Flow is not published ------------------------------------

async function showDates(ctx: Ctx, doctor: Doctor, explainFallback: boolean): Promise<void> {
  const open = slotsOf(ctx).openDates(doctor, ctx.user.address);
  if (open.length === 0) {
    await ctx.send.buttons({
      body: `${doctor.name} is fully booked for the next 7 days. Want to see another doctor?`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: 'menu:book', title: 'Other doctors' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  await ctx.send.list({
    header: doctor.name,
    body: `${explainFallback ? '(The booking form is not published on this number, so here are the same live slots as lists.)\n\n' : ''}Which day suits you?`,
    button: 'Choose a day',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Next 7 days',
        rows: open.map(({ date, free }) => ({
          id: `date:${date}`,
          title: dayLabel(date),
          description: `${free} slot${free === 1 ? '' : 's'} free`,
        })),
      },
    ],
  });
}

export async function onDate(ctx: Ctx, date: string, offset = 0): Promise<void> {
  const doctor = currentDoctor(ctx);
  if (doctor === undefined) {
    return showSpecialties(ctx);
  }
  const times = slotsOf(ctx).freeTimes(doctor, date, ctx.user.address);
  if (times.length === 0) {
    await ctx.send.text(`${dayLabel(date)} just filled up.`);
    return showDates(ctx, doctor, false);
  }
  ctx.setState((state) => ({ ...state, step: 'slot', pickedDate: date, timesOffset: offset }));
  const page = times.slice(offset, offset + TIMES_PER_PAGE);
  const more = offset + TIMES_PER_PAGE < times.length;
  await ctx.send.list({
    header: `${doctor.name} · ${dayLabel(date)}`,
    body: `${times.length} slots free on ${dayLabel(date)}. Pick a time.`,
    button: 'Choose a time',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Times (IST)',
        rows: [
          ...page.map((time) => ({ id: `time:${time}`, title: timeLabel(time) })),
          ...(more
            ? [{ id: `times:more:${offset + TIMES_PER_PAGE}`, title: 'Later times…', description: '' }]
            : []),
        ],
      },
    ],
  });
}

export async function onTime(ctx: Ctx, time: string): Promise<void> {
  const doctor = currentDoctor(ctx);
  const date = ctx.state.pickedDate;
  if (doctor === undefined || date === null) {
    return showSpecialties(ctx);
  }
  const bookingId =
    ctx.state.intent === 'reschedule' && ctx.state.booking !== null
      ? ctx.state.booking.id
      : bookingIdFrom(ctx.idempotencyKey('booking'));
  const heldUntil = new Date(ctx.now().getTime() + HOLD_MS);
  const slots = slotsOf(ctx);
  if (!slots.hold(doctor.id, date, time, ctx.user.address, bookingId, heldUntil)) {
    await ctx.send.text(`Sorry, ${timeLabel(time)} was just taken.`);
    return onDate(ctx, date);
  }
  const previous = ctx.state.draft;
  if (previous !== null && !(previous.date === date && previous.time === time)) {
    slots.release(previous.doctorId, previous.date, previous.time, previous.bookingId);
  }
  const draft: Draft = {
    bookingId,
    doctorId: doctor.id,
    date,
    time,
    heldUntil: heldUntil.toISOString(),
    patient: null,
    reason: null,
  };
  ctx.setState((state) => ({ ...state, draft }));
  if (ctx.state.intent === 'reschedule') {
    return applyReschedule(ctx, draft);
  }
  ctx.setState((state) => ({ ...state, step: 'patient-details' }));
  await ctx.send.text(
    `Holding *${whenLabel(date, time)}* with ${doctor.name} for 15 minutes.\n\nWho is the appointment for? Reply with the patient's *name and age*, e.g. _Asha Rao, 32_.`,
  );
}

/** "Asha Rao, 32" / "Asha Rao 32" / "Kabir 4". */
export function parsePatientText(text: string): Patient | null {
  const match = /^\s*([\p{L}][\p{L}.' -]{0,78}?)[\s,]+(\d{1,3})\s*(?:yrs?|years?)?\s*$/u.exec(text);
  const age = Number(match?.[2]);
  const name = match?.[1]?.trim();
  if (name === undefined || name === '' || !Number.isInteger(age) || age > 120) {
    return null;
  }
  return { name, age, gender: null };
}

export async function onPatientText(ctx: Ctx, text: string): Promise<void> {
  const patient = parsePatientText(text);
  const draft = ctx.state.draft;
  if (draft === null) {
    return nudge(ctx);
  }
  if (patient === null) {
    await ctx.send.text('I need a name and an age, like _Asha Rao, 32_. Or type MENU to start over.');
    return;
  }
  return createBooking(ctx, { ...draft, patient });
}

// --- From a held slot to a booking ------------------------------------------------------

/** The `book` Flow completed: its endpoint already held the slot and saved the draft. */
export async function onBookFlowCompleted(
  ctx: Ctx,
  response: Readonly<Record<string, unknown>>,
): Promise<void> {
  const draft = ctx.state.draft;
  if (draft === null || response.booking_id !== draft.bookingId) {
    await ctx.send.text('That booking form has expired. Let me open a fresh one.');
    const doctorId = ctx.state.doctorId;
    return doctorId === null ? showSpecialties(ctx) : startSlotPick(ctx, doctorId, ctx.state.intent);
  }
  if (ctx.state.intent === 'reschedule') {
    return applyReschedule(ctx, draft);
  }
  return createBooking(ctx, draft);
}

async function createBooking(ctx: Ctx, draft: Draft): Promise<void> {
  const doctor = findDoctor(draft.doctorId);
  if (doctor === undefined || draft.patient === null) {
    return showSpecialties(ctx);
  }
  const booking: Booking = {
    id: draft.bookingId,
    doctorId: doctor.id,
    date: draft.date,
    time: draft.time,
    kind: ctx.state.intent === 'follow-up' ? 'follow-up' : 'new',
    patient: draft.patient,
    reason: draft.reason,
    fee: feeFor(doctor, ctx.state.intent),
    status: 'held',
    heldUntil: draft.heldUntil,
    payMode: null,
    paymentId: null,
    paymentAttempts: 0,
    paid: false,
    remindersOn: false,
    previsitDone: false,
    files: 0,
  };
  ctx.setState((state) => ({ ...state, booking, draft: null, step: 'review' }));
  await ctx.send.react('🗓️');
  await showReview(ctx, booking, doctor);
}

async function showReview(ctx: Ctx, booking: Booking, doctor: Doctor): Promise<void> {
  const branch = findBranch(doctor.branch);
  await ctx.send.buttons({
    header: 'Slot held for 15 minutes ⏳',
    body: [
      `👩‍⚕️ *${doctor.name}*, ${findSpecialty(doctor.specialty)?.title ?? ''}`,
      `📍 ${branch?.name ?? ''}`,
      `🗓️ ${whenLabel(booking.date, booking.time)}`,
      `🧑 ${booking.patient.name}, ${booking.patient.age}`,
      `💳 ${booking.kind === 'follow-up' ? 'Follow-up' : 'Consultation'} fee *${formatInr(booking.fee)}*`,
      `Booking ID *${booking.id}*`,
      '',
      'Pay now to confirm instantly, or pay at the front desk.',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: BOOKING_IDS.payOnline, title: `Pay ${formatInr(booking.fee)} now` },
      { id: BOOKING_IDS.payClinic, title: 'Pay at clinic' },
      { id: BOOKING_IDS.changeSlot, title: 'Change slot' },
    ],
  });
}

export async function onChangeSlot(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  if (booking === null || (booking.status !== 'held' && booking.status !== 'awaiting_payment')) {
    return nudge(ctx);
  }
  slotsOf(ctx).release(booking.doctorId, booking.date, booking.time, booking.id);
  ctx.setState((state) => ({
    ...state,
    booking: null,
    intent: booking.kind === 'follow-up' ? 'follow-up' : 'new',
  }));
  return startSlotPick(ctx, booking.doctorId, ctx.state.intent);
}

/** Re-holds a lapsed hold if nobody took the slot meanwhile. */
function ensureHeld(ctx: Ctx, booking: Booking): boolean {
  const until = new Date(ctx.now().getTime() + HOLD_MS);
  return slotsOf(ctx).hold(booking.doctorId, booking.date, booking.time, ctx.user.address, booking.id, until);
}

// --- Payment --------------------------------------------------------------------------

export async function onPayOnline(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  const doctor = booking === null ? undefined : findDoctor(booking.doctorId);
  if (
    booking === null ||
    doctor === undefined ||
    (booking.status !== 'held' && booking.status !== 'awaiting_payment')
  ) {
    return nudge(ctx);
  }
  if (!ensureHeld(ctx, booking)) {
    return slotLost(ctx, booking);
  }
  const payments = ctx.user.phone === null ? null : await ctx.capabilities.payments();
  if (payments === null) {
    return confirmAtClinic(
      ctx,
      "Online payment isn't set up on this demo number yet (no WhatsApp Pay configuration or gateway account), so I've confirmed it as *pay at the clinic*. On a live number, this button sends a WhatsApp order with UPI, cards and netbanking.",
    );
  }
  const attempt = booking.paymentAttempts + 1;
  let order: PaymentOrder;
  try {
    order = await ctx.api.payments.create(paymentRequest(ctx, booking, doctor, payments, attempt), {
      idempotencyKey: ctx.idempotencyKey(`payment:${booking.id}:${attempt}`),
    });
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('payment request refused, falling back to pay at clinic', {
      code: error.code,
      status: error.status,
    });
    return confirmAtClinic(
      ctx,
      `WhatsApp could not create the payment just now (${error.message}). I've confirmed your slot as *pay at the clinic* instead.`,
    );
  }
  ctx.setState((state) => ({
    ...state,
    step: 'review',
    booking: {
      ...booking,
      status: 'awaiting_payment',
      payMode: 'online',
      paymentId: order.id,
      paymentAttempts: attempt,
      heldUntil: new Date(ctx.now().getTime() + HOLD_MS).toISOString(),
    },
  }));
  // LazyApp sent the order (Review and pay) itself; confirmation follows on payment.captured.
}

function paymentRequest(
  ctx: Ctx,
  booking: Booking,
  doctor: Doctor,
  payments: PaymentsInfo,
  attempt: number,
): CreatePaymentInput {
  return {
    to: ctx.user.phone ?? '',
    reference_id: attempt === 1 ? `AAR-${booking.id}` : `AAR-${booking.id}-${attempt}`,
    body: `Consultation with ${doctor.name} on ${whenLabel(booking.date, booking.time)} for ${booking.patient.name}. Pay within 15 minutes to confirm your slot.`,
    footer: 'Aarogya Clinics · LazyApp demo',
    goods_type: 'digital-goods',
    expires_in_minutes: 15,
    items: [
      {
        name: `${booking.kind === 'follow-up' ? 'Follow-up' : 'Consultation'} · ${doctor.name}`,
        amount: booking.fee,
        quantity: 1,
        retailer_id: `consult-${doctor.id}`,
      },
    ],
    payment:
      payments.method === 'payment_gateway'
        ? { method: 'payment_gateway', configuration: payments.configuration }
        : { method: payments.method, gateway_account: payments.gatewayAccount },
    metadata: { booking_id: booking.id, demo: 'clinic-appointments' },
  };
}

export async function onPayAtClinic(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  if (booking === null || (booking.status !== 'held' && booking.status !== 'awaiting_payment')) {
    return nudge(ctx);
  }
  if (!ensureHeld(ctx, booking)) {
    return slotLost(ctx, booking);
  }
  return confirmAtClinic(ctx, null);
}

async function confirmAtClinic(ctx: Ctx, note: string | null): Promise<void> {
  const booking = ctx.state.booking;
  if (booking === null) {
    return;
  }
  ctx.setState((state) => ({ ...state, booking: { ...booking, payMode: 'clinic' } }));
  if (note !== null) {
    await ctx.send.text(note);
  }
  await confirmBooking(ctx);
}

/** Locks the slot and tells the patient. Used by "pay at clinic" and by payment.captured. */
export async function confirmBooking(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  const doctor = booking === null ? undefined : findDoctor(booking.doctorId);
  if (booking === null || doctor === undefined) {
    return;
  }
  if (!slotsOf(ctx).confirm(booking.doctorId, booking.date, booking.time, ctx.user.address, booking.id)) {
    return slotLost(ctx, booking);
  }
  const confirmed: Booking = { ...booking, status: 'confirmed', heldUntil: null };
  ctx.setState((state) => ({ ...state, booking: confirmed, step: 'manage' }));
  ctx.kv.set(`booking:${confirmed.id}`, {
    doctorId: confirmed.doctorId,
    date: confirmed.date,
    time: confirmed.time,
    patient: confirmed.patient.name,
    paid: confirmed.paid,
    at: ctx.now().toISOString(),
  });

  if (!ctx.session.windowOpen) {
    await ctx.send.template({
      name: TEMPLATES.confirmation,
      language: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: confirmed.patient.name.split(' ')[0] ?? confirmed.patient.name },
            { type: 'text', text: doctor.name },
            { type: 'text', text: whenLabel(confirmed.date, confirmed.time) },
            { type: 'text', text: confirmed.id },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.manage }],
        },
      ],
    });
    return;
  }
  const branch = findBranch(doctor.branch);
  await ctx.send.buttons({
    header: 'Appointment confirmed ✅',
    body: [
      `*${doctor.name}* · ${whenLabel(confirmed.date, confirmed.time)}`,
      `📍 ${branch?.name ?? ''}, ${branch?.address ?? ''}`,
      `🧑 ${confirmed.patient.name} · Booking ID *${confirmed.id}*`,
      confirmed.paid
        ? `💳 Paid ${formatInr(confirmed.fee)} online`
        : `💳 ${formatInr(confirmed.fee)} payable at the front desk`,
      '',
      'Fill the pre-visit form now and your doctor reads it before you walk in. Want WhatsApp reminders a day and an hour before?',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: BOOKING_IDS.remind, title: 'Remind me' },
      { id: BOOKING_IDS.previsit, title: 'Pre-visit form' },
      { id: BOOKING_IDS.directions, title: 'Directions' },
    ],
  });
}

/** The hold lapsed and someone else booked the slot: refund if paid, then offer new slots. */
async function slotLost(ctx: Ctx, booking: Booking): Promise<void> {
  if (booking.paid && booking.paymentId !== null) {
    try {
      await ctx.api.payments.refund(
        booking.paymentId,
        { amount: booking.fee },
        { idempotencyKey: ctx.idempotencyKey(`refund:${booking.id}`) },
      );
    } catch (error) {
      ctx.log.error('refund after a lost slot failed', { error, bookingId: booking.id });
    }
  }
  ctx.setState((state) => ({
    ...state,
    booking: null,
    intent: booking.kind === 'follow-up' ? 'follow-up' : 'new',
  }));
  await ctx.send.text(
    `Sorry, the hold on ${whenLabel(booking.date, booking.time)} lapsed and another patient booked it.${booking.paid ? ` Your ${formatInr(booking.fee)} is being refunded to the original payment method.` : ''} Here are the slots still open:`,
  );
  return startSlotPick(ctx, booking.doctorId, ctx.state.intent);
}

export async function onPaymentCaptured(ctx: Ctx, payment: PaymentOrder): Promise<void> {
  const booking = ctx.state.booking;
  if (booking === null || payment.metadata?.booking_id !== booking.id || booking.paid) {
    ctx.log.info('payment.captured for no pending booking', { paymentId: payment.id });
    return;
  }
  ctx.setState((state) => ({ ...state, booking: { ...booking, paid: true, paymentId: payment.id } }));
  try {
    await ctx.api.payments.updateStatus(
      payment.id,
      {
        status: 'processing',
        description: `Appointment confirmed for ${whenLabel(booking.date, booking.time)}`,
      },
      { idempotencyKey: ctx.idempotencyKey(`order-status:${booking.id}:processing`) },
    );
  } catch (error) {
    ctx.log.warn('order status update failed', { error });
  }
  await confirmBooking(ctx);
}

export async function onPaymentFailed(ctx: Ctx, payment: PaymentOrder): Promise<void> {
  const booking = ctx.state.booking;
  if (
    booking === null ||
    payment.metadata?.booking_id !== booking.id ||
    booking.status !== 'awaiting_payment'
  ) {
    return;
  }
  await ctx.send.buttons({
    body: `Your payment of ${formatInr(booking.fee)} didn't go through${payment.last_error === null || payment.last_error === undefined ? '' : ` (${payment.last_error})`}. No money was taken. Your slot is still held for a few minutes.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: BOOKING_IDS.payOnline, title: 'Try again' },
      { id: BOOKING_IDS.payClinic, title: 'Pay at clinic' },
    ],
  });
}

// --- Reschedule -----------------------------------------------------------------------

async function applyReschedule(ctx: Ctx, draft: Draft): Promise<void> {
  const booking = ctx.state.booking;
  const doctor = findDoctor(draft.doctorId);
  if (booking === null || doctor === undefined) {
    return nudge(ctx);
  }
  const slots = slotsOf(ctx);
  // Book the new slot first, then free the old one: the patient is never left with neither.
  if (!slots.confirm(draft.doctorId, draft.date, draft.time, ctx.user.address, booking.id)) {
    await ctx.send.text(`Sorry, ${whenLabel(draft.date, draft.time)} was just taken.`);
    return startSlotPick(ctx, draft.doctorId, 'reschedule');
  }
  const sameSlot =
    draft.doctorId === booking.doctorId && draft.date === booking.date && draft.time === booking.time;
  if (!sameSlot) {
    slots.release(booking.doctorId, booking.date, booking.time, booking.id);
  }
  const moved: Booking = { ...booking, date: draft.date, time: draft.time };
  ctx.setState((state) => ({ ...state, booking: moved, draft: null, intent: 'new', step: 'manage' }));
  if (moved.remindersOn) {
    await scheduleReminders(ctx, moved);
  }
  await ctx.send.buttons({
    header: 'Rescheduled ✅',
    body: `Moved to *${whenLabel(moved.date, moved.time)}* with ${doctor.name}. Booking ID ${moved.id} stays the same${moved.paid ? ' and your payment carries over' : ''}.${moved.remindersOn ? ' Your reminders moved too.' : ''}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: BOOKING_IDS.previsit, title: 'Pre-visit form' },
      { id: BOOKING_IDS.directions, title: 'Directions' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

// --- Reminders ------------------------------------------------------------------------

const REMINDER_OFFSETS = [
  { key: 'reminder-24h', beforeMs: 24 * 60 * 60 * 1000 },
  { key: 'reminder-1h', beforeMs: 60 * 60 * 1000 },
] as const;

/** Schedules the 24h and 1h reminders that are still in the future. Returns how many. */
export async function scheduleReminders(ctx: Ctx, booking: Booking): Promise<number> {
  const doctor = findDoctor(booking.doctorId);
  if (doctor === undefined) {
    return 0;
  }
  const startsAt = new Date(`${booking.date}T${booking.time}:00+05:30`).getTime();
  let scheduled = 0;
  for (const { key, beforeMs } of REMINDER_OFFSETS) {
    const sendAt = new Date(startsAt - beforeMs);
    if (sendAt.getTime() <= ctx.now().getTime() + 5 * 60 * 1000) {
      await ctx.followUps.cancel(key);
      continue;
    }
    await ctx.followUps.schedule({
      key,
      category: 'utility',
      sendAt,
      template: {
        name: TEMPLATES.reminder,
        language: 'en',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: doctor.name },
              { type: 'text', text: dayLabel(booking.date) },
              { type: 'text', text: timeLabel(booking.time) },
              { type: 'text', text: findBranch(doctor.branch)?.name.replace('Aarogya Clinics ', '') ?? '' },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.attend }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: TEMPLATE_PAYLOADS.reschedule }],
          },
        ],
      },
    });
    scheduled += 1;
  }
  return scheduled;
}

export async function cancelReminders(ctx: Ctx): Promise<void> {
  for (const { key } of REMINDER_OFFSETS) {
    await ctx.followUps.cancel(key);
  }
}

export async function onRemindMe(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  if (booking?.status !== 'confirmed') {
    return nudge(ctx);
  }
  const count = await scheduleReminders(ctx, booking);
  ctx.setState((state) => ({ ...state, booking: { ...booking, remindersOn: count > 0 } }));
  await ctx.send.buttons({
    body:
      count === 0
        ? 'Your appointment is less than an hour away, so there is nothing left to remind you about. See you soon!'
        : `Done. You'll get ${count === 2 ? 'a reminder 24 hours and another 1 hour' : 'a reminder 1 hour'} before your visit, as an approved WhatsApp template. Tap *I'll be there* or *Reschedule* right from it.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: BOOKING_IDS.previsit, title: 'Pre-visit form' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

function currentDoctor(ctx: Ctx): Doctor | undefined {
  return ctx.state.doctorId === null ? undefined : findDoctor(ctx.state.doctorId);
}

export { currentDoctor, showDates };
