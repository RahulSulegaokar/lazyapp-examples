import { DEMO_FOOTER, formatInr, FlowUnavailableError, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import { BOOKING_IDS, cancelReminders, startSlotPick } from './booking.js';
import { findBranch, findDoctor, FREE_CANCELLATION_MS, RESCHEDULE_CUTOFF_MS } from './clinic.js';
import type { Ctx } from './context.js';
import { FLOWS } from './manifest.js';
import { MENU_IDS, nudge, showMenu } from './menu.js';
import { SlotBook, slotStart, whenLabel } from './schedule.js';
import type { Booking } from './state.js';

export const MANAGE_IDS = {
  reschedule: 'appt:reschedule',
  cancel: 'appt:cancel',
  cancelYes: 'cancel:yes',
  cancelNo: 'cancel:no',
  attend: 'appt:attend',
  remindersOff: 'remind:off',
} as const;

const PREVISIT_LABELS: Readonly<Record<string, string>> = {
  today: 'since today',
  days: 'a few days',
  weeks: '1–4 weeks',
  months: 'more than a month',
};

/** The patient's booking, if it is still ahead of them. */
export function upcomingBooking(ctx: Ctx): Booking | null {
  const booking = ctx.state.booking;
  return booking?.status === 'confirmed' ? booking : null;
}

export async function showAppointment(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  const doctor = booking === null ? undefined : findDoctor(booking.doctorId);
  if (booking === null || doctor === undefined) {
    const pending = ctx.state.booking;
    if (pending !== null && (pending.status === 'held' || pending.status === 'awaiting_payment')) {
      await ctx.send.buttons({
        body: `Your slot on ${whenLabel(pending.date, pending.time)} is held but not confirmed yet. Pay now or choose to pay at the clinic.`,
        footer: DEMO_FOOTER,
        buttons: [
          { id: BOOKING_IDS.payOnline, title: `Pay ${formatInr(pending.fee)} now` },
          { id: BOOKING_IDS.payClinic, title: 'Pay at clinic' },
        ],
      });
      return;
    }
    await ctx.send.buttons({
      body: "You don't have an upcoming appointment.",
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.book, title: 'Book now' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'manage' }));
  await ctx.send.list({
    header: 'My appointment',
    body: [
      `*${doctor.name}* · ${whenLabel(booking.date, booking.time)}`,
      `📍 ${findBranch(doctor.branch)?.name ?? ''}`,
      `🧑 ${booking.patient.name} · Booking ID *${booking.id}*`,
      `💳 ${booking.paid ? `Paid ${formatInr(booking.fee)}` : `${formatInr(booking.fee)} at the front desk`}`,
      `📝 Pre-visit form: ${booking.previsitDone ? 'done' : 'not filled'}`,
      `🔔 Reminders: ${booking.remindersOn ? 'on' : 'off'}`,
      booking.files > 0
        ? `📎 ${booking.files} file${booking.files === 1 ? '' : 's'} attached`
        : '📎 Send old reports here as photos or PDFs',
    ].join('\n'),
    button: 'Manage',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Change',
        rows: [
          { id: MANAGE_IDS.reschedule, title: 'Reschedule', description: 'Free up to 2 hours before' },
          {
            id: MANAGE_IDS.cancel,
            title: 'Cancel',
            description: booking.paid ? 'Full refund up to 4 hours before' : 'Free',
          },
        ],
      },
      {
        title: 'Prepare',
        rows: [
          {
            id: BOOKING_IDS.previsit,
            title: 'Pre-visit form',
            description: 'Symptoms, allergies, medicines',
          },
          { id: BOOKING_IDS.directions, title: 'Directions', description: 'Pin of your branch' },
          booking.remindersOn
            ? { id: MANAGE_IDS.remindersOff, title: 'Turn reminders off', description: '24h and 1h before' }
            : { id: BOOKING_IDS.remind, title: 'Remind me', description: '24h and 1h before' },
        ],
      },
    ],
  });
}

export async function onReschedule(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  if (slotStart(booking.date, booking.time).getTime() - ctx.now().getTime() < RESCHEDULE_CUTOFF_MS) {
    await ctx.send.buttons({
      body: 'Online rescheduling closes 2 hours before the appointment. Please call the front desk, or keep your slot.',
      footer: DEMO_FOOTER,
      buttons: [{ id: RESERVED_IDS.menu, title: 'Main menu' }],
    });
    return;
  }
  return startSlotPick(ctx, booking.doctorId, 'reschedule');
}

export async function onCancel(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'cancel-confirm' }));
  await ctx.send.buttons({
    body: `Cancel your appointment on ${whenLabel(booking.date, booking.time)}?${booking.paid ? `\n\n${refundable(ctx, booking) ? `Your ${formatInr(booking.fee)} will be refunded in full.` : 'It is less than 4 hours away, so the fee is not refundable.'}` : ''}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: MANAGE_IDS.cancelYes, title: 'Yes, cancel' },
      { id: MANAGE_IDS.cancelNo, title: 'Keep it' },
    ],
  });
}

function refundable(ctx: Ctx, booking: Booking): boolean {
  return slotStart(booking.date, booking.time).getTime() - ctx.now().getTime() >= FREE_CANCELLATION_MS;
}

export async function onCancelConfirmed(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  let refundNote = '';
  if (booking.paid && booking.paymentId !== null && refundable(ctx, booking)) {
    try {
      await ctx.api.payments.refund(
        booking.paymentId,
        { amount: booking.fee },
        { idempotencyKey: ctx.idempotencyKey(`refund:${booking.id}`) },
      );
      refundNote = ` A refund of ${formatInr(booking.fee)} is on its way to your original payment method (UPI refunds usually land within a day).`;
    } catch (error) {
      if (!(error instanceof LazyAppError)) {
        throw error;
      }
      ctx.log.error('refund failed', { error, bookingId: booking.id });
      refundNote = ' We could not start the refund automatically; the front desk will process it today.';
    }
  }
  new SlotBook(ctx.kv, ctx.now).release(booking.doctorId, booking.date, booking.time, booking.id);
  await cancelReminders(ctx);
  ctx.setState((state) => ({ ...state, booking: { ...booking, status: 'cancelled', remindersOn: false } }));
  ctx.kv.delete(`booking:${booking.id}`);
  await ctx.send.react('👍');
  await showMenu(
    ctx,
    `Cancelled. ${whenLabel(booking.date, booking.time)} is free for someone else now.${refundNote}`,
  );
}

export async function onRemindersOff(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  await cancelReminders(ctx);
  ctx.setState((state) => ({ ...state, booking: { ...booking, remindersOn: false } }));
  await showMenu(ctx, 'Reminders are off. Your appointment is unchanged.');
}

/** "I'll be there" on a reminder template. */
export async function onAttend(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  ctx.kv.set(`attending:${booking.id}`, { at: ctx.now().toISOString() });
  await ctx.send.react('✅');
  await ctx.send.text(
    `Thanks for confirming. See you on ${whenLabel(booking.date, booking.time)}! Type MENU for directions.`,
  );
}

export async function onDirections(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  const doctor = booking === null ? undefined : findDoctor(booking.doctorId);
  const branch = doctor === undefined ? undefined : findBranch(doctor.branch);
  if (branch === undefined) {
    return showAppointment(ctx);
  }
  await ctx.send.location({
    latitude: branch.latitude,
    longitude: branch.longitude,
    name: branch.name,
    address: branch.address,
  });
}

// --- Pre-visit form -------------------------------------------------------------------

export async function onPrevisit(ctx: Ctx): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  if (await ctx.flows.isAvailable(FLOWS.previsit)) {
    try {
      await ctx.flows.send({
        key: FLOWS.previsit,
        header: 'Pre-visit form',
        body: `For ${booking.patient.name}'s visit on ${whenLabel(booking.date, booking.time)}. Your doctor reads it before you walk in.`,
        cta: 'Fill the form',
        footer: DEMO_FOOTER,
        screen: 'INTAKE',
      });
      return;
    } catch (error) {
      if (!(error instanceof FlowUnavailableError)) {
        throw error;
      }
    }
  }
  ctx.setState((state) => ({ ...state, step: 'previsit-text' }));
  await ctx.send.text(
    "(The pre-visit form is not published on this number, so let's do it by chat.)\n\nIn one message, tell us the main problem, since when, any allergies and the medicines you take regularly.",
  );
}

export async function onPrevisitSubmitted(
  ctx: Ctx,
  answers: {
    concern: string;
    duration: string | null;
    conditions: string[];
    allergies: string | null;
    medications: string | null;
  },
): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    return showAppointment(ctx);
  }
  ctx.kv.set(`previsit:${booking.id}`, { ...answers, at: ctx.now().toISOString() });
  ctx.setState((state) => ({ ...state, step: 'manage', booking: { ...booking, previsitDone: true } }));
  const doctor = findDoctor(booking.doctorId);
  await ctx.send.react('📝');
  await ctx.send.buttons({
    body: [
      `Thanks! ${doctor?.name ?? 'Your doctor'} will see this before your visit:`,
      `• ${answers.concern}${answers.duration === null ? '' : ` (${PREVISIT_LABELS[answers.duration] ?? answers.duration})`}`,
      answers.conditions.length > 0 ? `• Conditions: ${answers.conditions.join(', ')}` : null,
      answers.allergies === null ? null : `• Allergies: ${answers.allergies}`,
      answers.medications === null ? null : `• Medicines: ${answers.medications}`,
      '',
      'Have old reports? Send them here as photos or PDFs and I will attach them to your file.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      { id: MENU_IDS.appointment, title: 'My appointment' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

// --- Files the patient sends ------------------------------------------------------------

export async function onMediaReceived(
  ctx: Ctx,
  media: { mediaId: string | null; mediaType: string; filename: string | null; mimeType: string | null },
): Promise<void> {
  const booking = upcomingBooking(ctx);
  if (booking === null) {
    await ctx.send.buttons({
      body: 'Thanks. I can attach reports and prescriptions to an upcoming appointment. Book one first and send them again.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.book, title: 'Book now' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  if (media.mediaType !== 'image' && media.mediaType !== 'document') {
    await ctx.send.text('Please send reports as a photo or a PDF.');
    return;
  }
  const files = booking.files + 1;
  ctx.kv.set(`file:${booking.id}:${files}`, { ...media, at: ctx.now().toISOString() });
  ctx.setState((state) => ({ ...state, booking: { ...booking, files } }));
  await ctx.send.react('📎');
  await ctx.send.text(
    `Attached ${media.filename ?? (media.mediaType === 'image' ? 'your photo' : 'your document')} to booking ${booking.id} (${files} file${files === 1 ? '' : 's'}). ${findDoctor(booking.doctorId)?.name ?? 'Your doctor'} will see it before the visit.`,
  );
}

export async function backToManageOrMenu(ctx: Ctx): Promise<void> {
  return upcomingBooking(ctx) === null ? nudge(ctx) : showAppointment(ctx);
}
