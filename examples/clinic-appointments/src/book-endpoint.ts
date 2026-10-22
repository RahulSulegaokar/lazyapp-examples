import { createHash } from 'node:crypto';
import { formatInr } from '@lazyapp-examples/demo-kit';
import type {
  FlowExchangeContext,
  FlowExchangeRequest,
  FlowExchangeResponse,
} from '@lazyapp-examples/demo-kit';
import { doctorLine, findDoctor, HOLD_MS } from './clinic.js';
import type { Doctor } from './clinic.js';
import { dayLabel, SlotBook, timeLabel } from './schedule.js';
import type { ClinicState, Patient } from './state.js';

type FlowCtx = FlowExchangeContext<ClinicState>;

/** Deterministic, human-friendly booking id: six characters a front desk can read out. */
export function bookingIdFrom(seed: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const digest = createHash('sha256').update(seed).digest();
  return Array.from(digest.subarray(0, 6), (byte) => alphabet[byte % alphabet.length]).join('');
}

/** Fee for what the patient is booking: follow-ups with the same doctor are cheaper. */
export function feeFor(doctor: Doctor, intent: ClinicState['intent']): number {
  return intent === 'follow-up' ? doctor.followUpFee : doctor.fee;
}

/**
 * Data endpoint of the `book` Flow. Every screen is computed from live availability,
 * and the last step holds the slot, so the patient never confirms a slot someone else took.
 */
export async function bookEndpoint(
  ctx: FlowCtx,
  request: FlowExchangeRequest,
): Promise<FlowExchangeResponse> {
  const doctor = ctx.state.doctorId === null ? undefined : findDoctor(ctx.state.doctorId);
  if (doctor === undefined) {
    throw new Error('book flow opened without a doctor in the session');
  }
  const slots = new SlotBook(ctx.kv, ctx.now);
  const data = request.data ?? {};
  const trigger = request.action === 'data_exchange' ? text(data.trigger) : null;

  switch (trigger) {
    case 'date_selected':
      return appointmentScreen(ctx, doctor, slots, text(data.date));
    case 'slot_chosen': {
      const date = text(data.date);
      const time = text(data.time);
      if (date === null || time === null || !slots.isFree(doctor.id, date, time, ctx.user.address)) {
        return appointmentScreen(ctx, doctor, slots, date, 'That slot was just taken. Please pick another.');
      }
      // A reschedule already has the patient's details: hold the new slot and close the form.
      if (ctx.state.intent === 'reschedule' && ctx.state.booking !== null) {
        return holdAndFinish(
          ctx,
          doctor,
          slots,
          request.flow_token,
          date,
          time,
          ctx.state.booking.patient,
          null,
        );
      }
      return patientScreen(ctx, doctor, date, time);
    }
    case 'book':
      return book(ctx, doctor, slots, request.flow_token, data);
    default:
      // INIT, BACK, or an unknown trigger: start from the dates.
      return appointmentScreen(ctx, doctor, slots, null);
  }
}

function appointmentScreen(
  ctx: FlowCtx,
  doctor: Doctor,
  slots: SlotBook,
  date: string | null,
  error?: string,
): FlowExchangeResponse {
  const open = slots.openDates(doctor, ctx.user.address);
  const times = date === null ? [] : slots.freeTimes(doctor, date, ctx.user.address);
  const noDates = open.length === 0;
  return {
    screen: 'APPOINTMENT',
    data: {
      doctor_name: doctor.name,
      doctor_meta: `${doctorLine(doctor)} · Fee ${formatInr(feeFor(doctor, ctx.state.intent))}`,
      dates: noDates
        ? [{ id: 'none', title: 'No free slots this week', description: 'Try another doctor' }]
        : open.map(({ date: day, free }) => ({
            id: day,
            title: dayLabel(day),
            description: `${free} slot${free === 1 ? '' : 's'} free`,
          })),
      slots: times.map((time) => ({ id: time, title: timeLabel(time) })),
      slots_visible: times.length > 0,
      has_error: error !== undefined || noDates,
      error_message: error ?? (noDates ? `${doctor.name} is fully booked for the next 7 days.` : ''),
    },
  };
}

function patientScreen(
  ctx: FlowCtx,
  doctor: Doctor,
  date: string,
  time: string,
  error?: string,
): FlowExchangeResponse {
  return {
    screen: 'PATIENT',
    data: {
      summary: `${doctor.name} · ${dayLabel(date)} · ${timeLabel(time)} · ${formatInr(feeFor(doctor, ctx.state.intent))}`,
      date,
      time,
      has_error: error !== undefined,
      error_message: error ?? '',
    },
  };
}

function book(
  ctx: FlowCtx,
  doctor: Doctor,
  slots: SlotBook,
  flowToken: string,
  data: Readonly<Record<string, unknown>>,
): FlowExchangeResponse {
  const date = text(data.date);
  const time = text(data.time);
  if (date === null || time === null) {
    return appointmentScreen(ctx, doctor, slots, null, 'Please pick a date and time.');
  }
  const patient = parsePatient(data);
  if (patient === null) {
    return patientScreen(
      ctx,
      doctor,
      date,
      time,
      'Please enter the patient name and an age between 0 and 120.',
    );
  }
  return holdAndFinish(ctx, doctor, slots, flowToken, date, time, patient, text(data.reason));
}

function holdAndFinish(
  ctx: FlowCtx,
  doctor: Doctor,
  slots: SlotBook,
  flowToken: string,
  date: string,
  time: string,
  patient: Patient,
  reason: string | null,
): FlowExchangeResponse {
  // A reschedule keeps the booking id, so the slot moves with the payment attached to it.
  const bookingId =
    ctx.state.intent === 'reschedule' && ctx.state.booking !== null
      ? ctx.state.booking.id
      : bookingIdFrom(`${flowToken}:${date}:${time}`);
  const heldUntil = new Date(ctx.now().getTime() + HOLD_MS);
  if (!slots.hold(doctor.id, date, time, ctx.user.address, bookingId, heldUntil)) {
    return patientScreen(ctx, doctor, date, time, 'That slot was just taken. Go back and pick another.');
  }
  releaseStaleDraft(ctx, slots, date, time);
  ctx.setState((state) => ({
    ...state,
    draft: {
      bookingId,
      doctorId: doctor.id,
      date,
      time,
      heldUntil: heldUntil.toISOString(),
      patient,
      reason,
    },
  }));
  return {
    screen: 'SUCCESS',
    data: { extension_message_response: { params: { flow_token: flowToken, booking_id: bookingId } } },
  };
}

/** A patient who re-opens the flow and picks another slot should not keep the first one held. */
function releaseStaleDraft(ctx: FlowCtx, slots: SlotBook, date: string, time: string): void {
  const previous = ctx.state.draft;
  if (previous !== null && !(previous.date === date && previous.time === time)) {
    slots.release(previous.doctorId, previous.date, previous.time, previous.bookingId);
  }
}

export function parsePatient(data: Readonly<Record<string, unknown>>): Patient | null {
  const name = text(data.patient_name);
  const age = Number(text(data.age));
  if (name === null || !Number.isInteger(age) || age < 0 || age > 120) {
    return null;
  }
  const gender = text(data.gender);
  return {
    name: name.slice(0, 80),
    age,
    gender: gender === 'female' || gender === 'male' || gender === 'other' ? gender : null,
  };
}

function text(value: unknown): string | null {
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
