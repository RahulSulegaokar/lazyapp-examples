import type {
  FlowEndpointHandler,
  FlowExchangeContext,
  FlowExchangeResponse,
} from '@lazyapp-examples/demo-kit';
import { meetingIdFrom, placeMeeting } from './meeting.js';
import { getRep } from './product.js';
import { MEETING_MINUTES, formatTime, formatWhen, openDays, openSlotsOn } from './schedule.js';
import { needsLine, repFor } from './scoring.js';
import type { LeadState } from './state.js';

/**
 * Data endpoint for the demo-booking Flow. The router has already checked the flow token
 * belongs to this lead's live session; the rep and their calendar come from the lead's state.
 */

type FlowCtx = FlowExchangeContext<LeadState>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A booked meeting keeps its rep; a new one goes to the rep for the lead's plan. */
const repIdOf = (state: LeadState): string =>
  state.meeting?.status === 'booked' ? state.meeting.repId : repFor(state.answers);

function slotScreen(ctx: FlowCtx, dayId: string | null, error?: string): FlowExchangeResponse {
  const repId = repIdOf(ctx.state);
  const rep = getRep(repId);
  const now = ctx.now();
  const slots = dayId === null ? [] : openSlotsOn(ctx.kv, repId, dayId, now);
  const needs = needsLine(ctx.state.answers);
  return {
    screen: 'SLOT',
    data: {
      rep_line: `${MEETING_MINUTES} minutes with ${rep?.name ?? 'our team'}, ${rep?.title ?? 'Ledgerly'}`,
      context_line:
        ctx.state.rescheduling && ctx.state.meeting !== null
          ? `Moving your demo on ${formatWhen(new Date(ctx.state.meeting.at))}`
          : needs === ''
            ? 'A walkthrough with your own invoices'
            : `We will tailor it to: ${needs}`,
      days: openDays(ctx.kv, repId, now).map((day) => ({ id: day.id, title: day.title })),
      slots: slots.map((slot) => ({ id: slot.time, title: formatTime(slot.time) })),
      slots_visible: slots.length > 0,
      ...(error === undefined ? {} : { error_message: error }),
    },
  };
}

const meeting: FlowEndpointHandler<LeadState> = async (ctx, request) => {
  if (request.action !== 'data_exchange') {
    return slotScreen(ctx, null);
  }
  const day = str(request.data?.day);
  if (str(request.data?.trigger) !== 'confirm') {
    const open = openSlotsOn(ctx.kv, repIdOf(ctx.state), day, ctx.now());
    return slotScreen(ctx, day, open.length === 0 ? 'No times left that day. Pick another day.' : undefined);
  }
  const agenda = str(request.data?.agenda).trim().slice(0, 300);
  const result = placeMeeting(
    ctx.kv,
    ctx.state,
    {
      meetingId: meetingIdFrom(request.flow_token),
      dayId: day,
      time: str(request.data?.time),
      agenda: agenda === '' ? null : agenda,
    },
    ctx.now(),
  );
  if (!result.ok) {
    return slotScreen(
      ctx,
      day,
      result.reason === 'taken' ? 'That time was just taken. Pick another.' : 'Pick a day and a time.',
    );
  }
  ctx.setState(result.state);
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: { flow_token: request.flow_token, flow: 'meeting', meeting_id: result.meeting.id },
      },
    },
  };
};

export const flowEndpoints: Readonly<Record<string, FlowEndpointHandler<LeadState>>> = { meeting };
