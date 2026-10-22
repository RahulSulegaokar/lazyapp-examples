import { defineExample } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import { bookEndpoint } from './book-endpoint.js';
import {
  BOOKING_IDS,
  onBookFlowCompleted,
  onChangeSlot,
  onConsent,
  onDate,
  onPatientText,
  onPayAtClinic,
  onPaymentCaptured,
  onPaymentFailed,
  onPayOnline,
  onRemindMe,
  onSpecialty,
  onTime,
  showDoctor,
  showSpecialties,
  startSlotPick,
} from './booking.js';
import { findDoctor } from './clinic.js';
import type { Ctx } from './context.js';
import { EXAMPLE_ID } from './context.js';
import {
  askLocation,
  INFO_IDS,
  onFollowUp,
  onLocation,
  showAllBranches,
  showEmergency,
  showPrivacy,
  showReports,
} from './info.js';
import {
  MANAGE_IDS,
  onAttend,
  onCancel,
  onCancelConfirmed,
  onDirections,
  onMediaReceived,
  onPrevisit,
  onPrevisitSubmitted,
  onRemindersOff,
  onReschedule,
  showAppointment,
} from './manage.js';
import { FLOWS, manifest } from './manifest.js';
import { MENU_IDS, nudge, showMenu } from './menu.js';
import { SlotBook } from './schedule.js';
import { clinicStateSchema, initialClinicState } from './state.js';
import type { ClinicState } from './state.js';

/**
 * Aarogya Clinics: a multi-specialty clinic's front desk on WhatsApp.
 *
 * specialty → doctor card → consent → live-slot Flow (data_exchange) → hold → pay
 * (order_details) or pay at clinic → confirmation → reminders (templates) → pre-visit
 * Flow → reports as PDFs → follow-up. Reschedule and cancel (with refunds) at any point.
 */
export default defineExample<ClinicState>({
  id: EXAMPLE_ID,
  title: 'Clinic appointments',
  startCode: 'DEMO CLINIC',
  manifest,
  stateSchema: clinicStateSchema,
  initialState: initialClinicState,
  describe: () => ({
    summary:
      'Book a doctor with live slots, pay the fee in WhatsApp, get reminders, a pre-visit form and your prescription PDF.',
    metaFeatures: [
      'List messages',
      'Reply buttons with image and document headers',
      'WhatsApp Flows (data_exchange)',
      'Payments (India)',
      'Utility templates',
      'Documents',
      'Location request',
      'Location',
      'Contact cards',
      'Reactions',
    ],
    emoji: '🩺',
  }),

  async onStart(ctx, inbound) {
    ctx.setState((state) => ({ ...state, businessNumber: inbound.raw.to ?? null }));
    await showMenu(ctx);
  },

  async onMenu(ctx) {
    await showMenu(ctx, 'How can we help?');
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'button':
      case 'list':
        return onChoice(ctx, inbound.id);
      case 'text':
        return onText(ctx, inbound.text);
      case 'flow':
        return onFlow(ctx, inbound.response);
      case 'location':
        return onLocation(ctx, inbound.latitude, inbound.longitude);
      case 'media':
        return onMediaReceived(ctx, inbound);
      case 'reaction':
        return;
      default:
        return nudge(ctx);
    }
  },

  async onEvent(ctx, event) {
    if (isEventType(event, 'payment.captured')) {
      return onPaymentCaptured(ctx, event.data.payment);
    }
    if (isEventType(event, 'payment.failed')) {
      return onPaymentFailed(ctx, event.data.payment);
    }
    ctx.log.warn('a clinic message failed', { type: event.type, data: event.data });
  },

  async onEnd(ctx) {
    // Give held (unpaid) slots back so other patients can book them. Confirmed bookings stay.
    const slots = new SlotBook(ctx.kv, ctx.now);
    const { draft, booking } = ctx.state;
    if (draft !== null) {
      slots.release(draft.doctorId, draft.date, draft.time, draft.bookingId);
    }
    if (
      booking !== null &&
      (booking.status === 'held' || booking.status === 'awaiting_payment') &&
      !booking.paid
    ) {
      slots.release(booking.doctorId, booking.date, booking.time, booking.id);
    }
  },

  flowEndpoints: { [FLOWS.book]: bookEndpoint },
});

async function onChoice(ctx: Ctx, id: string): Promise<void> {
  const [scope = '', action = '', arg = ''] = id.split(':');
  switch (id) {
    case MENU_IDS.book:
      return showSpecialties(ctx);
    case MENU_IDS.appointment:
      return showAppointment(ctx);
    case MENU_IDS.reports:
      return showReports(ctx);
    case MENU_IDS.branches:
      return askLocation(ctx);
    case MENU_IDS.emergency:
      return showEmergency(ctx);
    case MENU_IDS.privacy:
      return showPrivacy(ctx);
    case BOOKING_IDS.consentYes:
    case BOOKING_IDS.consentRead:
    case BOOKING_IDS.consentNo:
      return onConsent(ctx, id);
    case BOOKING_IDS.payOnline:
      return onPayOnline(ctx);
    case BOOKING_IDS.payClinic:
      return onPayAtClinic(ctx);
    case BOOKING_IDS.changeSlot:
      return onChangeSlot(ctx);
    case BOOKING_IDS.remind:
      return onRemindMe(ctx);
    case BOOKING_IDS.previsit:
      return onPrevisit(ctx);
    case BOOKING_IDS.directions:
      return onDirections(ctx);
    case MANAGE_IDS.reschedule:
      return onReschedule(ctx);
    case MANAGE_IDS.cancel:
      return onCancel(ctx);
    case MANAGE_IDS.cancelYes:
      return onCancelConfirmed(ctx);
    case MANAGE_IDS.cancelNo:
      return showAppointment(ctx);
    case MANAGE_IDS.attend:
      return onAttend(ctx);
    case MANAGE_IDS.remindersOff:
      return onRemindersOff(ctx);
    case INFO_IDS.allBranches:
      return showAllBranches(ctx);
    case INFO_IDS.followUp:
      return onFollowUp(ctx);
  }
  if (scope === 'spec') {
    return onSpecialty(ctx, action);
  }
  if (scope === 'doc' && action === 'slot') {
    return startSlotPick(ctx, arg, 'new');
  }
  if (scope === 'doc') {
    const doctor = findDoctor(action);
    return doctor === undefined ? showSpecialties(ctx) : showDoctor(ctx, doctor);
  }
  if (scope === 'date') {
    return onDate(ctx, id.slice('date:'.length));
  }
  if (scope === 'time') {
    return onTime(ctx, id.slice('time:'.length));
  }
  if (scope === 'times' && action === 'more' && ctx.state.pickedDate !== null) {
    return onDate(ctx, ctx.state.pickedDate, Number(arg));
  }
  return nudge(ctx);
}

async function onText(ctx: Ctx, text: string): Promise<void> {
  if (ctx.state.step === 'patient-details') {
    return onPatientText(ctx, text);
  }
  if (ctx.state.step === 'previsit-text' && text.trim().length >= 3) {
    return onPrevisitSubmitted(ctx, {
      concern: text.trim().slice(0, 500),
      duration: null,
      conditions: [],
      allergies: null,
      medications: null,
    });
  }
  if (/\b(book|appointment|doctor)\b/i.test(text)) {
    return showSpecialties(ctx);
  }
  if (/\b(emergency|ambulance|urgent)\b/i.test(text)) {
    return showEmergency(ctx);
  }
  return nudge(ctx);
}

async function onFlow(ctx: Ctx, response: Readonly<Record<string, unknown>>): Promise<void> {
  if ('booking_id' in response) {
    return onBookFlowCompleted(ctx, response);
  }
  if (typeof response.concern === 'string') {
    return onPrevisitSubmitted(ctx, {
      concern: response.concern.slice(0, 500),
      duration: stringOrNull(response.duration),
      conditions: Array.isArray(response.conditions)
        ? response.conditions.filter((entry): entry is string => typeof entry === 'string')
        : [],
      allergies: stringOrNull(response.allergies),
      medications: stringOrNull(response.medications),
    });
  }
  return nudge(ctx);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
