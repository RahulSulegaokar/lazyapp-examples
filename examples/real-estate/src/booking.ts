import { DEMO_FOOTER, FlowUnavailableError } from '@lazyapp-examples/demo-kit';
import { LazyAppError } from '@lazyapp-examples/sdk';
import type { TemplateSend } from '@lazyapp-examples/sdk';
import { sendBusinessEvent, syncLeadTags } from './crm.js';
import { FEEDBACK_PREFIX, HOME_IDS, MENU_IDS, SEARCH_IDS, VISIT_IDS } from './ids.js';
import { CITY_NAMES, getAgent, getListing } from './listings.js';
import type { Listing } from './listings.js';
import { FLOWS, TEMPLATES } from './manifest.js';
import { agentCard } from './menu.js';
import { formatWhen, nextOpenSlots } from './schedule.js';
import { showAlternatives } from './search.js';
import type { FeedbackRating, Visit } from './state.js';
import type { Ctx, Deps } from './types.js';
import { cancelVisit, findVisit, followUpPlan, placeVisit, updateVisit, visitIdFrom } from './visits.js';

const reminderKey = (visit: Visit) => `reminder:${visit.id}`;
const feedbackKey = (visit: Visit) => `feedback:${visit.id}`;

/** "Book a site visit": the booking Flow with live slots, or a list of the next open slots. */
export async function startBooking(
  ctx: Ctx,
  listing: Listing,
  rescheduleOf: Visit | null = null,
): Promise<void> {
  ctx.setState((state) => ({
    ...state,
    step: 'visit',
    focus: listing.id,
    pendingVisit: { listingId: listing.id, rescheduleOf: rescheduleOf?.id ?? null },
  }));
  const agent = getAgent(rescheduleOf?.agentId ?? '')?.firstName;
  const intro =
    rescheduleOf === null
      ? `Pick a day and time to see *${listing.name}*. Your relationship manager will meet you at the sales gallery.`
      : `Pick a new time for your visit to *${listing.name}* (now ${formatWhen(new Date(rescheduleOf.at))}). ${agent ?? 'Your agent'} gets the update automatically.`;
  try {
    await ctx.flows.send({
      key: FLOWS.visit,
      header: rescheduleOf === null ? 'Book a site visit' : 'Reschedule your visit',
      body: intro,
      cta: 'Choose a slot',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await offerSlots(
      ctx,
      listing,
      `${intro}\n\n(The booking form is not available right now, so here are the next open slots.)`,
    );
  }
}

async function offerSlots(ctx: Ctx, listing: Listing, body: string): Promise<void> {
  const slots = nextOpenSlots(ctx.kv, listing.id, ctx.now(), 10);
  if (slots.length === 0) {
    await ctx.send.buttons({
      body: `${listing.name} is fully booked for the next few days. Want to look at similar homes?`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: SEARCH_IDS.start, title: 'Find a home' },
        { id: MENU_IDS.advisor, title: 'Talk to an advisor' },
      ],
    });
    return;
  }
  await ctx.send.list({
    header: listing.name,
    body,
    button: 'Choose a slot',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Open slots',
        rows: slots.map((slot) => ({
          id: `${VISIT_IDS.slot}${listing.id}:${slot.day.id}T${slot.time}`,
          title: formatWhen(slot.at).replace(' at ', ' · '),
          description: listing.locality,
        })),
      },
    ],
  });
}

/** A slot picked from the fallback list: `visit:slot:<listingId>:<day>T<time>`. */
export async function onSlotPicked(ctx: Ctx, deps: Deps, value: string): Promise<void> {
  const match = /^([a-z0-9-]+):(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  const listing = match === null ? undefined : getListing(match[1] ?? '');
  if (match === null || listing === undefined) {
    await ctx.send.text(
      'That slot is from an older message. Tap *Book a site visit* on a home to see fresh slots.',
    );
    return;
  }
  const pending = ctx.state.pendingVisit;
  const result = placeVisit(
    ctx.kv,
    ctx.state,
    {
      visitId: visitIdFrom(ctx.idempotencyKey('visit')),
      listingId: listing.id,
      dayId: match[2] ?? '',
      time: match[3] ?? '',
      name: ctx.user.displayName ?? 'Guest',
      party: 'solo',
      rescheduleOf: pending?.listingId === listing.id ? pending.rescheduleOf : null,
    },
    ctx.now(),
  );
  if (!result.ok) {
    await offerSlots(
      ctx,
      listing,
      result.reason === 'taken'
        ? 'That slot was just taken. Here is what is still open:'
        : 'That slot has passed. Here is what is open now:',
    );
    return;
  }
  ctx.setState(result.state);
  await confirmVisit(ctx, deps, result.visit, pending?.rescheduleOf ?? null);
}

/** The booking Flow closed: the endpoint already reserved the slot; confirm it in the chat. */
export async function onVisitFlowCompleted(ctx: Ctx, deps: Deps, visitId: unknown): Promise<void> {
  const visit = typeof visitId === 'string' ? findVisit(ctx.state, visitId) : undefined;
  if (visit?.status !== 'booked') {
    await ctx.send.text(
      'I could not find that booking. Tap *My site visits* in the menu to check your visits.',
    );
    return;
  }
  if (visit.confirmed) {
    return;
  }
  await confirmVisit(ctx, deps, visit, ctx.state.pendingVisit?.rescheduleOf ?? null);
}

/**
 * Confirmation (template with the project pin), the agent's contact card on a first booking,
 * the reminder and feedback follow-ups, and the CRM tags. At most three messages.
 */
async function confirmVisit(
  ctx: Ctx,
  deps: Deps,
  visit: Visit,
  rescheduledFrom: string | null,
): Promise<void> {
  const listing = getListing(visit.listingId);
  const agent = getAgent(visit.agentId);
  if (listing === undefined || agent === undefined) {
    return;
  }
  const when = formatWhen(new Date(visit.at));
  const firstBooking = rescheduledFrom === null;
  const confirmationUuid = await sendConfirmation(ctx, deps, visit, listing, agent.name, when, firstBooking);
  if (firstBooking) {
    await ctx.send.contacts([agentCard(agent, deps)]);
  }
  ctx.setState((state) => ({
    ...updateVisit(state, visit.id, { confirmed: true, confirmationUuid }),
    step: 'menu',
    pendingVisit: null,
  }));
  await scheduleFollowUps(ctx, deps, visit, listing, agent.name, when);
  await syncLeadTags(ctx);
}

/** Returns the uuid of the template send, or null when it went another way. */
async function sendConfirmation(
  ctx: Ctx,
  deps: Deps,
  visit: Visit,
  listing: Listing,
  agentName: string,
  when: string,
  firstBooking: boolean,
): Promise<string | null> {
  const project = `${listing.name}, ${listing.locality}`;
  if (
    deps.config.useEvents &&
    (await sendBusinessEvent(
      ctx,
      firstBooking ? 'appointment.confirmed' : 'appointment.rescheduled',
      { project, when, agent: agentName, visit_id: visit.id },
      `demo-homes-${visit.id}-${visit.at}`,
    ))
  ) {
    return null;
  }
  try {
    const sent = await ctx.send.template(confirmationTemplate(visit, listing, project, when, agentName));
    return sent.uuid;
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('visit confirmation template unavailable; confirming in-session', { status: error.status });
    await confirmInSession(ctx, visit, listing, agentName, when);
    return null;
  }
}

export function confirmationTemplate(
  visit: Visit,
  listing: Listing,
  project: string,
  when: string,
  agentName: string,
): TemplateSend {
  return {
    name: TEMPLATES.visitConfirmed,
    language: 'en',
    features: {
      location: {
        latitude: String(listing.latitude),
        longitude: String(listing.longitude),
        name: `${listing.name} sales gallery`,
        address: listing.address,
      },
    },
    components: [
      bodyParameters([project, when, agentName]),
      quickReply(0, `${VISIT_IDS.reschedule}${visit.id}`),
      quickReply(1, `${VISIT_IDS.cancel}${visit.id}`),
    ],
  };
}

/** Same confirmation as free-form messages, for when the template is not approved yet. */
async function confirmInSession(
  ctx: Ctx,
  visit: Visit,
  listing: Listing,
  agentName: string,
  when: string,
): Promise<void> {
  await ctx.send.location({
    latitude: listing.latitude,
    longitude: listing.longitude,
    name: `${listing.name} sales gallery`,
    address: listing.address,
  });
  await ctx.send.buttons({
    body:
      `✅ Your site visit to *${listing.name}* is confirmed for *${when}*. ${agentName} will meet you at the ` +
      `sales gallery; please carry a photo ID for the gate.\n\nBooking id: ${visit.id}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.reschedule}${visit.id}`, title: 'Reschedule' },
      { id: `${VISIT_IDS.cancel}${visit.id}`, title: 'Cancel visit' },
    ],
  });
}

async function scheduleFollowUps(
  ctx: Ctx,
  deps: Deps,
  visit: Visit,
  listing: Listing,
  agentName: string,
  when: string,
): Promise<void> {
  const plan = followUpPlan(new Date(visit.at), ctx.now(), deps.config.reminders);
  try {
    if (plan.reminderAt === null) {
      await ctx.followUps.cancel(reminderKey(visit));
    } else {
      await ctx.followUps.schedule({
        key: reminderKey(visit),
        category: 'utility',
        sendAt: plan.reminderAt,
        template: {
          name: TEMPLATES.visitReminder,
          language: 'en',
          components: [
            bodyParameters([`${listing.name}, ${listing.locality}`, when, agentName]),
            quickReply(0, `${VISIT_IDS.directions}${visit.id}`),
            quickReply(1, `${VISIT_IDS.reschedule}${visit.id}`),
          ],
        },
      });
    }
    await ctx.followUps.schedule({
      key: feedbackKey(visit),
      category: 'utility',
      sendAt: plan.feedbackAt,
      template: {
        name: TEMPLATES.visitFeedback,
        language: 'en',
        components: [
          bodyParameters([listing.name, agentName]),
          quickReply(0, `${FEEDBACK_PREFIX}loved:${visit.id}`),
          quickReply(1, `${FEEDBACK_PREFIX}okay:${visit.id}`),
          quickReply(2, `${FEEDBACK_PREFIX}no:${visit.id}`),
        ],
      },
    });
  } catch (error) {
    if (!(error instanceof LazyAppError)) {
      throw error;
    }
    ctx.log.warn('could not schedule visit follow-ups', { status: error.status, code: error.code });
  }
}

function bodyParameters(values: readonly string[]): Readonly<Record<string, unknown>> {
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

// --- Managing visits -----------------------------------------------------------------

export async function showVisits(ctx: Ctx): Promise<void> {
  const booked = ctx.state.visits
    .filter((visit) => visit.status === 'booked')
    .sort((a, b) => a.at.localeCompare(b.at));
  if (booked.length === 0) {
    await ctx.send.buttons({
      body: 'You have no site visits booked. Find a home you like and tap *Book a site visit*.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: SEARCH_IDS.start, title: 'Find a home' },
        { id: MENU_IDS.shortlist, title: 'My shortlist' },
      ],
    });
    return;
  }
  await ctx.send.list({
    header: 'My site visits',
    body: 'Pick a visit to get directions, move it or cancel it.',
    button: 'See visits',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Booked',
        rows: booked.slice(0, 10).map((visit) => ({
          id: `${VISIT_IDS.open}${visit.id}`,
          title: getListing(visit.listingId)?.name ?? visit.id,
          description: `${formatWhen(new Date(visit.at))} · ${visit.id}`,
        })),
      },
    ],
  });
}

export async function openVisit(ctx: Ctx, visit: Visit): Promise<void> {
  const listing = getListing(visit.listingId);
  await ctx.send.buttons({
    body:
      `*${listing?.name ?? 'Site visit'}*\n${formatWhen(new Date(visit.at))}\n` +
      `With ${getAgent(visit.agentId)?.name ?? 'your agent'} · ${visit.party === 'family' ? 'with family' : 'just you'}\n` +
      `Booking id: ${visit.id}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.directions}${visit.id}`, title: 'Get directions' },
      { id: `${VISIT_IDS.reschedule}${visit.id}`, title: 'Reschedule' },
      { id: `${VISIT_IDS.cancel}${visit.id}`, title: 'Cancel visit' },
    ],
  });
}

export async function directions(ctx: Ctx, visit: Visit): Promise<void> {
  const listing = getListing(visit.listingId);
  if (listing === undefined) {
    return;
  }
  await ctx.send.location({
    latitude: listing.latitude,
    longitude: listing.longitude,
    name: `${listing.name} sales gallery`,
    address: listing.address,
  });
  await ctx.send.buttons({
    body: `Tap the pin for directions. ${getAgent(visit.agentId)?.firstName ?? 'Your agent'} will meet you at the sales gallery at ${formatWhen(new Date(visit.at))}.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.reschedule}${visit.id}`, title: 'Reschedule' },
      { id: MENU_IDS.visits, title: 'My site visits' },
    ],
  });
}

export async function reschedule(ctx: Ctx, visit: Visit): Promise<void> {
  const listing = getListing(visit.listingId);
  if (listing === undefined) {
    return;
  }
  await startBooking(ctx, listing, visit);
}

export async function askCancel(ctx: Ctx, visit: Visit): Promise<void> {
  await ctx.send.buttons({
    body: `Cancel your visit to *${getListing(visit.listingId)?.name ?? 'the project'}* on ${formatWhen(new Date(visit.at))}?`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${VISIT_IDS.cancelConfirmed}${visit.id}`, title: 'Yes, cancel it' },
      { id: `${VISIT_IDS.reschedule}${visit.id}`, title: 'Move it instead' },
      { id: `${VISIT_IDS.open}${visit.id}`, title: 'Keep it' },
    ],
  });
}

export async function cancel(ctx: Ctx, deps: Deps, visit: Visit): Promise<void> {
  const listing = getListing(visit.listingId);
  ctx.setState(cancelVisit(ctx.kv, ctx.state, visit.id));
  await ctx.followUps.cancel(reminderKey(visit));
  await ctx.followUps.cancel(feedbackKey(visit));
  if (deps.config.useEvents) {
    await sendBusinessEvent(
      ctx,
      'appointment.cancelled',
      { project: listing?.name ?? '', when: formatWhen(new Date(visit.at)), visit_id: visit.id },
      `demo-homes-${visit.id}-cancelled`,
    );
  }
  await ctx.send.buttons({
    body: `Your visit ${visit.id} is cancelled and the slot is released. No reminders will be sent.`,
    footer: DEMO_FOOTER,
    buttons: [
      ...(listing === undefined
        ? []
        : [{ id: `${VISIT_IDS.book}${listing.id}`, title: 'Book another time' }]),
      { id: SEARCH_IDS.start, title: 'Find a home' },
    ],
  });
  await syncLeadTags(ctx);
}

// --- After the visit ---------------------------------------------------------------------

export async function onFeedback(ctx: Ctx, visit: Visit, rating: FeedbackRating): Promise<void> {
  const listing = getListing(visit.listingId);
  const agent = getAgent(visit.agentId);
  if (listing === undefined || agent === undefined) {
    return;
  }
  ctx.setState((state) => ({ ...updateVisit(state, visit.id, { feedback: rating }), step: 'feedback' }));
  await syncLeadTags(ctx);
  if (rating === 'loved') {
    await ctx.send.react('🎉');
    await ctx.send.buttons({
      body:
        `Wonderful! ${listing.name} is now marked as a hot lead for ${agent.firstName}, who will share the price sheet ` +
        "and this month's offers.\n\n_Demo: in production the hot-lead alert reaches the agent's CRM._",
      footer: DEMO_FOOTER,
      buttons: [
        { id: `${HOME_IDS.emi}${listing.id}`, title: 'Check my EMI' },
        { id: MENU_IDS.advisor, title: 'Talk to an advisor' },
      ],
    });
    return;
  }
  await showAlternatives(
    ctx,
    listing,
    rating === 'okay'
      ? `Thanks! Here are other homes in ${CITY_NAMES[listing.city]} to compare with ${listing.name}.`
      : `Sorry it was not the one. Here are other options to ${listing.purpose} nearby.`,
  );
}

/**
 * `message.failed` for our confirmation template (e.g. Meta has not approved it yet): the
 * buyer is still in the chat, so confirm with free-form messages instead.
 */
export async function onMessageFailed(ctx: Ctx, messageUuid: string | null): Promise<void> {
  const visit = ctx.state.visits.find(
    (entry) =>
      entry.status === 'booked' && entry.confirmationUuid !== null && entry.confirmationUuid === messageUuid,
  );
  const listing = visit === undefined ? undefined : getListing(visit.listingId);
  const agent = visit === undefined ? undefined : getAgent(visit.agentId);
  if (visit === undefined || listing === undefined || agent === undefined || !ctx.session.windowOpen) {
    return;
  }
  ctx.setState((state) => updateVisit(state, visit.id, { confirmationUuid: null }));
  await confirmInSession(ctx, visit, listing, agent.name, formatWhen(new Date(visit.at)));
}
