import { createHash } from 'node:crypto';
import { DEMO_FOOTER, FlowUnavailableError } from '@lazyapp-examples/demo-kit';
import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { TemplateSend } from '@lazyapp-examples/sdk';
import { pushCrmEvent, sendBusinessEvent, syncLeadTags } from './crm.js';
import { LEAD_IDS, MEETING_IDS } from './ids.js';
import { FLOWS, TEMPLATES } from './manifest.js';
import { COMPANY, getRep } from './product.js';
import type { Rep } from './product.js';
import {
  isBookable,
  MEETING_MINUTES,
  nextOpenSlots,
  releaseSlot,
  reserveSlot,
  slotInstant,
  formatWhen,
} from './schedule.js';
import { repFor } from './scoring.js';
import type { LeadState, Meeting } from './state.js';
import type { Ctx, Deps } from './types.js';
import { repCard } from './welcome.js';

const REMINDER_KEY = 'meeting-reminder';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** `M-7KQ2M9`, deterministic for a seed (the flow token), so retries book once. */
export function meetingIdFrom(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  return `M-${Array.from(digest.subarray(0, 6), (byte) => ALPHABET[byte % ALPHABET.length] ?? 'X').join('')}`;
}

export type PlaceMeetingResult =
  | { readonly ok: true; readonly meeting: Meeting; readonly state: LeadState }
  | { readonly ok: false; readonly reason: 'invalid' | 'taken' };

/**
 * Holds the rep's slot and records the meeting; moving an existing meeting releases its old
 * slot only once the new one is held. Idempotent per meeting id.
 */
export function placeMeeting(
  kv: KeyValueStore,
  state: LeadState,
  request: {
    readonly meetingId: string;
    readonly dayId: string;
    readonly time: string;
    readonly agenda: string | null;
  },
  now: Date,
): PlaceMeetingResult {
  if (!isBookable(request.dayId, request.time, now)) {
    return { ok: false, reason: 'invalid' };
  }
  const previous = state.meeting?.status === 'booked' ? state.meeting : null;
  const repId = previous?.repId ?? repFor(state.answers);
  const id = previous?.id ?? request.meetingId;
  const at = slotInstant(request.dayId, request.time);
  if (previous?.at === at.toISOString()) {
    return { ok: true, meeting: previous, state };
  }
  if (!reserveSlot(kv, repId, at, id)) {
    return { ok: false, reason: 'taken' };
  }
  if (previous !== null) {
    releaseSlot(kv, previous.repId, new Date(previous.at), previous.id);
  }
  const meeting: Meeting = {
    id,
    at: at.toISOString(),
    repId,
    status: 'booked',
    agenda: request.agenda,
    confirmed: false,
    confirmationUuid: null,
  };
  return { ok: true, meeting, state: { ...state, meeting } };
}

function repOf(ctx: Ctx): Rep {
  const rep = getRep(ctx.state.meeting?.repId ?? repFor(ctx.state.answers));
  if (rep === undefined) {
    throw new Error('No rep for this lead');
  }
  return rep;
}

/** Opens the booking Flow against the rep's calendar, or lists the next open slots. */
export async function startMeeting(ctx: Ctx, deps: Deps, rescheduling = false): Promise<void> {
  const rep = repOf(ctx);
  ctx.setState((state) => ({ ...state, step: 'meeting', rescheduling }));
  const body = rescheduling
    ? `Pick a new time for your demo with ${rep.name}.`
    : `Pick a time for a ${MEETING_MINUTES}-minute demo with *${rep.name}*, ${rep.title.toLowerCase()} for teams like yours.`;
  try {
    await ctx.flows.send({
      key: FLOWS.meeting,
      header: rescheduling ? 'Move your demo' : 'Book your demo',
      body,
      cta: 'Pick a time',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await offerSlots(
      ctx,
      deps,
      `${body}\n\n(The booking form is not available right now, so here are the next open times.)`,
    );
  }
}

async function offerSlots(ctx: Ctx, deps: Deps, body: string): Promise<void> {
  const rep = repOf(ctx);
  const slots = nextOpenSlots(ctx.kv, rep.id, ctx.now(), 10);
  if (slots.length === 0) {
    await ctx.send.contacts([repCard(rep, deps)]);
    await ctx.send.text(
      `${rep.firstName}'s calendar is full this week. Save the card above and message any time.`,
    );
    return;
  }
  await ctx.send.list({
    header: `Demo with ${rep.firstName}`,
    body,
    button: 'Pick a time',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Open times (IST)',
        rows: slots.map((slot) => ({
          id: `${MEETING_IDS.slot}${slot.day.id}T${slot.time}`,
          title: formatWhen(slot.at).replace(' at ', ' · '),
          description: `${MEETING_MINUTES} min · video call`,
        })),
      },
    ],
  });
}

/** `meeting:slot:<day>T<time>` from the fallback list. */
export async function onSlotPicked(ctx: Ctx, deps: Deps, value: string): Promise<void> {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  const result =
    match === null
      ? ({ ok: false, reason: 'invalid' } as const)
      : placeMeeting(
          ctx.kv,
          ctx.state,
          {
            meetingId: meetingIdFrom(ctx.idempotencyKey('meeting')),
            dayId: match[1] ?? '',
            time: match[2] ?? '',
            agenda: null,
          },
          ctx.now(),
        );
  if (!result.ok) {
    await offerSlots(
      ctx,
      deps,
      result.reason === 'taken'
        ? 'That time was just taken. Here is what is open:'
        : 'That time is no longer available. Here is what is open:',
    );
    return;
  }
  const rescheduled = ctx.state.rescheduling && ctx.state.meeting?.status === 'booked';
  ctx.setState(result.state);
  await confirmMeeting(ctx, deps, result.meeting, rescheduled);
}

/** The booking Flow closed; the endpoint already holds the slot. */
export async function onMeetingFlowCompleted(ctx: Ctx, deps: Deps, meetingId: unknown): Promise<void> {
  const meeting = ctx.state.meeting;
  if (meeting?.status !== 'booked' || meeting.id !== meetingId) {
    await ctx.send.text('I could not find that booking. Tap *Book a demo* to pick a time.');
    return;
  }
  if (!meeting.confirmed) {
    await confirmMeeting(ctx, deps, meeting, ctx.state.rescheduling);
  }
}

async function confirmMeeting(ctx: Ctx, deps: Deps, meeting: Meeting, rescheduled: boolean): Promise<void> {
  const rep = repOf(ctx);
  const when = formatWhen(new Date(meeting.at));
  const uuid = await sendConfirmation(ctx, deps, meeting, rep, when, rescheduled);
  if (!rescheduled) {
    await ctx.send.contacts([repCard(rep, deps)]);
  }
  ctx.setState((state) => ({
    ...state,
    step: 'menu',
    rescheduling: false,
    meeting: { ...meeting, confirmed: true, confirmationUuid: uuid },
  }));
  await scheduleReminder(ctx, deps, meeting, rep, when);
  await pushCrmEvent(ctx, deps, rescheduled ? 'meeting.rescheduled' : 'meeting.booked');
  await syncLeadTags(ctx);
}

async function sendConfirmation(
  ctx: Ctx,
  deps: Deps,
  meeting: Meeting,
  rep: Rep,
  when: string,
  rescheduled: boolean,
): Promise<string | null> {
  if (
    deps.config.useEvents &&
    (await sendBusinessEvent(
      ctx,
      rescheduled ? 'appointment.rescheduled' : 'appointment.confirmed',
      { company: COMPANY, when, rep: rep.name, meeting_id: meeting.id },
      `demo-leads-${meeting.id}-${meeting.at}`,
    ))
  ) {
    return null;
  }
  try {
    return (await ctx.send.template(confirmationTemplate(when, rep))).uuid;
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('meeting confirmation template unavailable; confirming in-session', {
      status: error.status,
    });
    await confirmInSession(ctx, meeting, rep, when);
    return null;
  }
}

export function confirmationTemplate(when: string, rep: Rep): TemplateSend {
  return {
    name: TEMPLATES.meetingBooked,
    language: 'en',
    components: [
      body([when, rep.name]),
      quickReply(0, MEETING_IDS.reschedule),
      quickReply(1, MEETING_IDS.cancel),
    ],
  };
}

async function confirmInSession(ctx: Ctx, meeting: Meeting, rep: Rep, when: string): Promise<void> {
  await ctx.send.buttons({
    body: `✅ Your ${COMPANY} demo is booked for *${when}* with ${rep.name}. We will share the joining link here 15 minutes before the call.\n\nBooking id: ${meeting.id}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: MEETING_IDS.reschedule, title: 'Reschedule' },
      { id: MEETING_IDS.cancel, title: 'Cancel' },
    ],
  });
}

async function scheduleReminder(
  ctx: Ctx,
  deps: Deps,
  meeting: Meeting,
  rep: Rep,
  when: string,
): Promise<void> {
  const at = new Date(meeting.at).getTime();
  const sendAt = deps.config.timing === 'demo' ? ctx.now().getTime() + 2 * 60_000 : at - 15 * 60_000;
  try {
    if (sendAt - ctx.now().getTime() < 60_000) {
      await ctx.followUps.cancel(REMINDER_KEY);
      return;
    }
    await ctx.followUps.schedule({
      key: REMINDER_KEY,
      category: 'utility',
      sendAt: new Date(sendAt),
      template: {
        name: TEMPLATES.meetingReminder,
        language: 'en',
        components: [
          body([rep.name, when]),
          quickReply(0, MEETING_IDS.attending),
          quickReply(1, MEETING_IDS.reschedule),
        ],
      },
    });
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('could not schedule the meeting reminder', { status: error.status, code: error.code });
  }
}

function body(values: readonly string[]): Readonly<Record<string, unknown>> {
  return { type: 'body', parameters: values.map((text) => ({ type: 'text', text })) };
}

function quickReply(index: number, payload: string): Readonly<Record<string, unknown>> {
  return {
    type: 'button',
    sub_type: 'quick_reply',
    index: String(index),
    parameters: [{ type: 'payload', payload }],
  };
}

// --- Managing the meeting ------------------------------------------------------------

export async function showMeeting(ctx: Ctx): Promise<void> {
  const meeting = ctx.state.meeting;
  if (meeting?.status !== 'booked') {
    return;
  }
  await ctx.send.buttons({
    body: `Your demo: *${formatWhen(new Date(meeting.at))}* with ${repOf(ctx).name}.\nBooking id: ${meeting.id}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: MEETING_IDS.reschedule, title: 'Reschedule' },
      { id: MEETING_IDS.cancel, title: 'Cancel' },
      { id: LEAD_IDS.pricing, title: 'See pricing' },
    ],
  });
}

export async function askCancel(ctx: Ctx): Promise<void> {
  await ctx.send.buttons({
    body: 'Cancel your demo? You can always book another time.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: MEETING_IDS.cancelConfirmed, title: 'Yes, cancel' },
      { id: MEETING_IDS.reschedule, title: 'Move it instead' },
      { id: MEETING_IDS.keep, title: 'Keep it' },
    ],
  });
}

export async function cancelMeeting(ctx: Ctx, deps: Deps): Promise<void> {
  const meeting = ctx.state.meeting;
  if (meeting?.status !== 'booked') {
    return;
  }
  releaseSlot(ctx.kv, meeting.repId, new Date(meeting.at), meeting.id);
  ctx.setState((state) => ({ ...state, meeting: { ...meeting, status: 'cancelled' }, rescheduling: false }));
  await ctx.followUps.cancel(REMINDER_KEY);
  if (deps.config.useEvents) {
    await sendBusinessEvent(
      ctx,
      'appointment.cancelled',
      { company: COMPANY, when: formatWhen(new Date(meeting.at)), meeting_id: meeting.id },
      `demo-leads-${meeting.id}-cancelled`,
    );
  }
  await pushCrmEvent(ctx, deps, 'meeting.cancelled');
  await syncLeadTags(ctx);
  await ctx.send.buttons({
    body: `Your demo ${meeting.id} is cancelled and no reminder will be sent.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: LEAD_IDS.book, title: 'Book another time' },
      { id: LEAD_IDS.guide, title: 'Free GST guide' },
    ],
  });
}

export async function onAttending(ctx: Ctx): Promise<void> {
  await ctx.send.react('👍');
  await ctx.send.text(`Great, ${repOf(ctx).firstName} will see you then.`);
}

/** `message.failed` for the confirmation template: confirm with a free-form message instead. */
export async function onMessageFailed(ctx: Ctx, messageUuid: string | null): Promise<void> {
  const meeting = ctx.state.meeting;
  if (
    meeting?.status !== 'booked' ||
    meeting.confirmationUuid === null ||
    meeting.confirmationUuid !== messageUuid ||
    !ctx.session.windowOpen
  ) {
    return;
  }
  ctx.setState((state) => ({ ...state, meeting: { ...meeting, confirmationUuid: null } }));
  await confirmInSession(ctx, meeting, repOf(ctx), formatWhen(new Date(meeting.at)));
}
