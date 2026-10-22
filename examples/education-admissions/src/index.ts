import { defineExample } from '@lazyapp-examples/demo-kit';
import type { Inbound } from '@lazyapp-examples/demo-kit';
import { isEventType } from '@lazyapp-examples/sdk';
import { ALERT_IDS, onAlertsNo, onAlertsStop, onAlertsYes, showAlerts } from './alerts.js';
import {
  APPLY_IDS,
  onApply,
  onIntake,
  onPay,
  onPayLater,
  onPaymentCaptured,
  onPaymentFailed,
  onRemindDeadline,
  showApplication,
} from './application.js';
import type { Ctx } from './context.js';
import { EXAMPLE_ID, publishSnapshot } from './context.js';
import {
  COUNSEL_IDS,
  onChangeSession,
  onMode,
  onRemindCounselling,
  onSession,
  showCounselling,
} from './counselling.js';
import { DOC_IDS, onChecklistPdf, onClassify, onMedia, onUploadRequest, showDocuments } from './documents.js';
import { finderEndpoint } from './finder-endpoint.js';
import {
  GUARDIAN_IDS,
  onGuardianContact,
  onGuardianCounsellor,
  onGuardianNumber,
  showGuardianStatus,
  startAsGuardian,
  startInvite,
} from './guardian.js';
import { FLOWS, manifest } from './manifest.js';
import { MENU_IDS, nudge, showMenu } from './menu.js';
import {
  onBrochure,
  onFinderCompleted,
  onFinderStep,
  onScholarship,
  PROGRAM_IDS,
  showScholarships,
  showShortlist,
  startFinder,
} from './programs.js';
import { admissionsStateSchema, initialAdmissionsState } from './state.js';
import type { AdmissionsState } from './state.js';

const PARENT_CODE = /\bPARENT\s+([A-Z2-9]{6})\b/i;

/**
 * BrightPath Overseas Education: a study-abroad consultancy's admissions desk on WhatsApp.
 *
 * course finder Flow (data_exchange) → program carousel → brochure PDFs → counselling booking
 * → document checklist and uploads (tagged) → application fee (order_details) → deadline
 * reminders → parent view via a private link → opt-in intake alerts (marketing template).
 */
export default defineExample<AdmissionsState>({
  id: EXAMPLE_ID,
  title: 'Study abroad admissions',
  startCode: 'DEMO ADMISSIONS',
  manifest,
  stateSchema: admissionsStateSchema,
  initialState: initialAdmissionsState,
  describe: () => ({
    summary:
      'Course finder, program carousel, counselling booking, document uploads, application fee, deadline reminders and a parent view.',
    metaFeatures: [
      'WhatsApp Flows (data_exchange)',
      'Media carousel',
      'List messages',
      'Reply buttons with image header',
      'Documents',
      'Inbound media',
      'Contact cards (in and out)',
      'CTA URL buttons',
      'Payments (India)',
      'Utility and marketing templates',
      'Contact tags and consent',
      'Location',
    ],
    emoji: '🎓',
  }),

  async onStart(ctx, inbound) {
    ctx.setState((state) => ({ ...state, businessNumber: inbound.raw.to ?? null }));
    const code = inbound.kind === 'text' ? PARENT_CODE.exec(inbound.text)?.[1]?.toUpperCase() : undefined;
    if (code !== undefined && (await startAsGuardian(ctx, code))) {
      return;
    }
    await showMenu(ctx);
  },

  async onMenu(ctx) {
    if (ctx.state.role === 'guardian') {
      return showGuardianStatus(ctx);
    }
    await showMenu(ctx, 'What would you like to do?');
  },

  async onMessage(ctx, inbound) {
    if (ctx.state.role === 'guardian') {
      return onGuardianMessage(ctx, inbound);
    }
    await onStudentMessage(ctx, inbound);
    publishSnapshot(ctx);
  },

  async onEvent(ctx, event) {
    if (isEventType(event, 'payment.captured')) {
      await onPaymentCaptured(ctx, event.data.payment);
    } else if (isEventType(event, 'payment.failed')) {
      await onPaymentFailed(ctx, event.data.payment);
    } else {
      ctx.log.warn('an admissions message failed', { type: event.type, data: event.data });
    }
    publishSnapshot(ctx);
  },

  async onEnd(ctx) {
    // Free the counselling slot only if it was never confirmed; a booked session stays booked.
    const pick = ctx.state.counselling;
    if (pick !== null && !pick.confirmed) {
      ctx.kv.delete(`counsel:${pick.counsellorId}:${pick.date}:${pick.time}`);
    }
  },

  flowEndpoints: { [FLOWS.finder]: finderEndpoint },
});

async function onStudentMessage(ctx: Ctx, inbound: Inbound): Promise<void> {
  switch (inbound.kind) {
    case 'button':
    case 'list':
      return onChoice(ctx, inbound.id);
    case 'flow':
      return Array.isArray(inbound.response.shortlist) ? onFinderCompleted(ctx) : nudge(ctx);
    case 'media':
      return onMedia(ctx, inbound);
    case 'contacts':
      return ctx.state.step === 'guardian-invite' ? onGuardianContact(ctx, inbound.contacts) : nudge(ctx);
    case 'text':
      return onText(ctx, inbound.text);
    case 'reaction':
      return;
    default:
      return nudge(ctx);
  }
}

async function onChoice(ctx: Ctx, id: string): Promise<void> {
  switch (id) {
    case MENU_IDS.finder:
      return startFinder(ctx);
    case MENU_IDS.shortlist:
      return showShortlist(ctx);
    case MENU_IDS.scholarships:
      return showScholarships(ctx);
    case MENU_IDS.counselling:
      return showCounselling(ctx);
    case MENU_IDS.documents:
      return showDocuments(ctx);
    case MENU_IDS.application:
      return showApplication(ctx);
    case MENU_IDS.parent:
      return startInvite(ctx);
    case MENU_IDS.alerts:
      return showAlerts(ctx);
    case COUNSEL_IDS.change:
      return onChangeSession(ctx);
    case COUNSEL_IDS.remind:
      return onRemindCounselling(ctx);
    case DOC_IDS.checklistPdf:
      return onChecklistPdf(ctx);
    case DOC_IDS.skip:
      return showMenu(ctx, 'No rush. Send documents any time; I file each one as it arrives.');
    case APPLY_IDS.pay:
      return onPay(ctx);
    case APPLY_IDS.payLater:
      return onPayLater(ctx);
    case APPLY_IDS.remind:
      return onRemindDeadline(ctx);
    case ALERT_IDS.yes:
      return onAlertsYes(ctx);
    case ALERT_IDS.no:
      return onAlertsNo(ctx);
    case ALERT_IDS.stop:
      return onAlertsStop(ctx);
  }
  const prefixes: [string, (ctx: Ctx, rest: string) => Promise<void>][] = [
    ['finder:country:', (c, rest) => onFinderStep(c, 'country', rest)],
    ['finder:level:', (c, rest) => onFinderStep(c, 'level', rest)],
    ['finder:budget:', (c, rest) => onFinderStep(c, 'budget', rest)],
    ['finder:ielts:', (c, rest) => onFinderStep(c, 'ielts', rest)],
    [PROGRAM_IDS.brochurePrefix, onBrochure],
    [PROGRAM_IDS.applyPrefix, onApply],
    [APPLY_IDS.intakePrefix, onIntake],
    [COUNSEL_IDS.slotPrefix, onSession],
    [COUNSEL_IDS.modePrefix, onMode],
    [DOC_IDS.uploadPrefix, onUploadRequest],
    [DOC_IDS.classifyPrefix, onClassify],
    ['sch:', onScholarship],
  ];
  for (const [prefix, handler] of prefixes) {
    if (id.startsWith(prefix)) {
      return handler(ctx, id.slice(prefix.length));
    }
  }
  return nudge(ctx);
}

async function onText(ctx: Ctx, text: string): Promise<void> {
  if (ctx.state.step === 'guardian-invite') {
    return onGuardianNumber(ctx, text);
  }
  if (ctx.state.step === 'awaiting-document') {
    await ctx.send.text(
      'Please send the document as a photo or a PDF (tap 📎). Type MENU to do something else.',
    );
    return;
  }
  if (/\b(scholarships?|funding)\b/i.test(text)) {
    return showScholarships(ctx);
  }
  if (/\b(counsel+(ing|or)?|call|talk)\b/i.test(text)) {
    return showCounselling(ctx);
  }
  if (/\b(course|program+e?s?|universit(y|ies)|college|masters?|mba)\b/i.test(text)) {
    return startFinder(ctx);
  }
  return nudge(ctx);
}

async function onGuardianMessage(ctx: Ctx, inbound: Inbound): Promise<void> {
  if (inbound.kind === 'button' && inbound.id === GUARDIAN_IDS.counsellor) {
    return onGuardianCounsellor(ctx);
  }
  if (inbound.kind === 'media') {
    await ctx.send.text(
      `Thanks! Documents are uploaded by ${ctx.state.linkedStudent?.name ?? 'the student'} from their own chat, so their file stays in one place.`,
    );
    return;
  }
  return showGuardianStatus(ctx);
}
