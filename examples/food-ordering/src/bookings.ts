import { createHash } from 'node:crypto';
import { DEMO_FOOTER, FlowUnavailableError } from '@lazyapp-examples/demo-kit';
import type { FlowEndpointHandler, FlowExchangeResponse, KeyValueStore } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import { BRAND, findOutlet, OUTLETS } from './kitchen.js';
import type { Outlet } from './kitchen.js';
import { FLOWS, TEMPLATES } from './manifest.js';
import {
  bookableTimes,
  bookingDates,
  dayLabel,
  instantLabel,
  istInstant,
  isBookingDate,
  timeLabel,
} from './schedule.js';
import type { FoodState } from './state.js';
import { nudge } from './views.js';
import type { FoodCtx } from './views.js';

/** Covers (seats) each dining room takes per time slot. */
export const COVERS_PER_SLOT = 24;
export const MAX_PARTY = 10;
const REMINDER_LEAD_MS = 2 * 3_600_000;
/** Follow-ups end with the demo session, so only offer reminders that fire within it. */
const REMINDER_HORIZON_MS = 20 * 3_600_000;

const OCCASIONS = [
  { id: 'birthday', title: 'Birthday' },
  { id: 'anniversary', title: 'Anniversary' },
  { id: 'business', title: 'Business meal' },
  { id: 'date', title: 'Date night' },
] as const;

export const bookingSchema = z.object({
  id: z.string(),
  guest: z.string(),
  outletId: z.string(),
  date: z.string(),
  time: z.string(),
  party: z.number().int().min(1).max(MAX_PARTY),
  name: z.string(),
  occasion: z.string().nullable(),
  requests: z.string().nullable(),
  status: z.enum(['confirmed', 'cancelled']),
  createdAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;

const dineInOutlets = (): Outlet[] => OUTLETS.filter((outlet) => outlet.dineIn);

// --- Storage and capacity -----------------------------------------------------------------

export class TableBook {
  constructor(private readonly kv: KeyValueStore) {}

  coversTaken(outletId: string, date: string, time: string): number {
    return this.kv.get<number>(`covers:${outletId}:${date}:${time}`) ?? 0;
  }

  /** Times on `date` with room for `party`, best first. */
  freeTimes(outletId: string, date: string, party: number, now: Date): string[] {
    return bookableTimes(date, now).filter(
      (time) => this.coversTaken(outletId, date, time) + party <= COVERS_PER_SLOT,
    );
  }

  /**
   * Reserves seats if they are still free. The store is synchronous and the
   * runtime handles one request at a time per process, so check-and-set is atomic.
   */
  reserve(booking: Booking, now: Date): boolean {
    if (!this.freeTimes(booking.outletId, booking.date, booking.party, now).includes(booking.time)) {
      return false;
    }
    const key = `covers:${booking.outletId}:${booking.date}:${booking.time}`;
    this.kv.set(key, this.coversTaken(booking.outletId, booking.date, booking.time) + booking.party);
    this.kv.set(`booking:${booking.guest}:${booking.id}`, booking);
    return true;
  }

  cancel(guest: string, id: string): Booking | undefined {
    const booking = this.get(guest, id);
    if (booking?.status !== 'confirmed') {
      return undefined;
    }
    const key = `covers:${booking.outletId}:${booking.date}:${booking.time}`;
    this.kv.set(
      key,
      Math.max(0, this.coversTaken(booking.outletId, booking.date, booking.time) - booking.party),
    );
    const cancelled: Booking = { ...booking, status: 'cancelled' };
    this.kv.set(`booking:${guest}:${id}`, cancelled);
    return cancelled;
  }

  get(guest: string, id: string): Booking | undefined {
    const parsed = bookingSchema.safeParse(this.kv.get(`booking:${guest}:${id}`));
    return parsed.success ? parsed.data : undefined;
  }

  upcoming(guest: string, now: Date): Booking[] {
    return this.kv
      .list<unknown>(`booking:${guest}:`)
      .flatMap(({ value }) => {
        const parsed = bookingSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .filter((booking) => booking.status === 'confirmed' && istInstant(booking.date, booking.time) > now)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }
}

export function bookingIdFrom(seed: string): string {
  return `T${(createHash('sha256').update(seed).digest().readUInt32BE(0) % 90_000) + 10_000}`;
}

export interface BookingInput {
  readonly outletId: string;
  readonly date: string;
  readonly party: number;
  readonly time: string;
  readonly name: string;
  readonly occasion: string | null;
  readonly requests: string | null;
}

/** Validates and reserves. Shared by the Flow endpoint and the button fallback. */
export function book(
  tables: TableBook,
  guest: string,
  input: BookingInput,
  seed: string,
  now: Date,
): { ok: true; booking: Booking } | { ok: false; error: string } {
  const outlet = findOutlet(input.outletId);
  if (outlet?.dineIn !== true) {
    return { ok: false, error: 'Pick Indiranagar or Koramangala: HSR is a delivery kitchen.' };
  }
  if (!isBookingDate(input.date, now)) {
    return { ok: false, error: 'Pick a date in the next 7 days.' };
  }
  if (!Number.isInteger(input.party) || input.party < 1 || input.party > MAX_PARTY) {
    return { ok: false, error: `We take bookings for 1 to ${MAX_PARTY} guests. Call us for bigger groups.` };
  }
  if (input.name.trim() === '') {
    return { ok: false, error: 'Add a name for the booking.' };
  }
  const booking: Booking = {
    id: bookingIdFrom(seed),
    guest,
    outletId: outlet.id,
    date: input.date,
    time: input.time,
    party: input.party,
    name: input.name.trim().slice(0, 60),
    occasion: OCCASIONS.find((entry) => entry.id === input.occasion)?.title ?? null,
    requests:
      input.requests === null || input.requests.trim() === '' ? null : input.requests.trim().slice(0, 200),
    status: 'confirmed',
    createdAt: now.toISOString(),
  };
  return tables.reserve(booking, now)
    ? { ok: true, booking }
    : { ok: false, error: `${timeLabel(input.time)} just filled up. Please pick another time.` };
}

// --- The Flow --------------------------------------------------------------------------------

export async function startBooking(ctx: FoodCtx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'booking', bookingDraft: null }));
  try {
    await ctx.flows.send({
      key: FLOWS.table,
      header: { image: BRAND.diningRoom },
      body: 'Book a table at Masala Mile Indiranagar or Koramangala. Live availability, instant confirmation.',
      cta: 'Book a table',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await ctx.send.list({
      header: 'Book a table',
      body: 'Which restaurant?',
      button: 'Choose restaurant',
      footer: DEMO_FOOTER,
      sections: [
        {
          title: 'Dine-in restaurants',
          rows: dineInOutlets().map((outlet) => ({
            id: `tb:outlet:${outlet.id}`,
            title: outlet.name,
            description: outlet.address,
          })),
        },
      ],
    });
  }
}

function bookScreen(now: Date, error: string | null): FlowExchangeResponse {
  return {
    screen: 'BOOK',
    data: {
      outlets: dineInOutlets().map((outlet) => ({
        id: outlet.id,
        title: outlet.name,
        description: outlet.address.split(',').slice(0, 2).join(','),
      })),
      dates: bookingDates(now),
      parties: Array.from({ length: MAX_PARTY }, (_unused, index) => ({
        id: String(index + 1),
        title: `${index + 1} guest${index === 0 ? '' : 's'}`,
      })),
      error: error ?? '',
      has_error: error !== null,
    },
  };
}

function slotsScreen(
  tables: TableBook,
  input: { outletId: string; date: string; party: number },
  now: Date,
  error: string | null,
): FlowExchangeResponse {
  const outlet = findOutlet(input.outletId);
  return {
    screen: 'SLOTS',
    data: {
      summary: `${outlet?.name ?? ''} · ${dayLabel(input.date, now)} · ${input.party} guest${input.party === 1 ? '' : 's'}`,
      times: tables.freeTimes(input.outletId, input.date, input.party, now).map((time) => ({
        id: time,
        title: timeLabel(time),
        description: Number(time.slice(0, 2)) < 17 ? 'Lunch' : 'Dinner',
      })),
      occasions: OCCASIONS.map((entry) => ({ id: entry.id, title: entry.title })),
      outlet: input.outletId,
      date: input.date,
      party: String(input.party),
      error: error ?? '',
      has_error: error !== null,
    },
  };
}

/** INIT → choose restaurant/date/guests; `availability` → free times; `confirm` → reserve and close. */
export const tableEndpoint: FlowEndpointHandler<FoodState> = async (fctx, request) => {
  const now = fctx.now();
  if (request.action !== 'data_exchange') {
    return bookScreen(now, null);
  }
  const data = request.data ?? {};
  const text = (key: string): string => (typeof data[key] === 'string' ? data[key] : '');
  const tables = new TableBook(fctx.kv);
  const query = { outletId: text('outlet'), date: text('date'), party: Number(text('party')) };
  const outlet = findOutlet(query.outletId);
  if (
    outlet?.dineIn !== true ||
    !isBookingDate(query.date, now) ||
    !(query.party >= 1 && query.party <= MAX_PARTY)
  ) {
    return bookScreen(now, 'Please pick a restaurant, a date in the next week and the number of guests.');
  }
  if (text('step') === 'availability') {
    return tables.freeTimes(query.outletId, query.date, query.party, now).length === 0
      ? bookScreen(now, `${outlet.name} is full on ${dayLabel(query.date, now)}. Try another day.`)
      : slotsScreen(tables, query, now, null);
  }
  const result = book(
    tables,
    fctx.user.address,
    {
      ...query,
      time: text('time'),
      name: text('name'),
      occasion: text('occasion') === '' ? null : text('occasion'),
      requests: text('requests') === '' ? null : text('requests'),
    },
    `${request.flow_token}:${text('time')}`,
    now,
  );
  if (!result.ok) {
    return slotsScreen(tables, query, now, result.error);
  }
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: { flow_token: request.flow_token, booking_id: result.booking.id },
      },
    },
  };
};

/** The Flow closed with SUCCESS: the table is already reserved; confirm it in the chat. */
export async function onTableFlow(ctx: FoodCtx, response: Readonly<Record<string, unknown>>): Promise<void> {
  const id = typeof response.booking_id === 'string' ? response.booking_id : '';
  const booking = new TableBook(ctx.kv).get(ctx.user.address, id);
  if (booking === undefined) {
    return nudge(ctx, "I couldn't find that booking. Please try booking again.");
  }
  await confirmBooking(ctx, booking);
}

async function confirmBooking(ctx: FoodCtx, booking: Booking): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'home', bookingDraft: null }));
  const outlet = findOutlet(booking.outletId);
  if (outlet !== undefined) {
    await ctx.send.location({
      latitude: outlet.latitude,
      longitude: outlet.longitude,
      name: `Masala Mile ${outlet.name}`,
      address: outlet.address,
    });
  }
  const at = istInstant(booking.date, booking.time).getTime();
  const reminderAt = at - REMINDER_LEAD_MS;
  const canRemind =
    reminderAt > ctx.now().getTime() + 5 * 60_000 && reminderAt < ctx.now().getTime() + REMINDER_HORIZON_MS;
  await ctx.send.buttons({
    body: [
      `✅ *Table booked* · ${booking.id}`,
      '',
      `${booking.party} guest${booking.party === 1 ? '' : 's'} · ${dayLabel(booking.date, ctx.now())} · ${timeLabel(booking.time)}`,
      `Masala Mile ${outlet?.name ?? ''} (pinned above)`,
      ...(booking.occasion === null ? [] : [`🎉 ${booking.occasion}: we'll have something sweet ready.`]),
      ...(booking.requests === null ? [] : [`📝 ${booking.requests}`]),
      '',
      'We hold tables for 15 minutes.',
    ].join('\n'),
    footer: DEMO_FOOTER,
    buttons: [
      ...(canRemind ? [{ id: `booking:remind:${booking.id}`, title: 'Remind me 2h before' }] : []),
      { id: `booking:cancel:${booking.id}`, title: 'Cancel booking' },
      { id: 'order:start', title: 'Order food' },
    ],
  });
}

export async function onBookingChoice(ctx: FoodCtx, action: string, id: string): Promise<void> {
  const tables = new TableBook(ctx.kv);
  const booking = tables.get(ctx.user.address, id);
  if (booking === undefined) {
    return myBookings(ctx);
  }
  const outlet = findOutlet(booking.outletId);
  switch (action) {
    case 'remind':
      return scheduleReminder(ctx, booking);
    case 'cancel': {
      const cancelled = tables.cancel(ctx.user.address, id);
      await ctx.followUps.cancel(`table-reminder:${id}`);
      return nudge(
        ctx,
        cancelled === undefined
          ? `Booking ${id} was already cancelled.`
          : `Booking ${id} is cancelled. We hope to see you another time!`,
      );
    }
    case 'directions':
      if (outlet !== undefined) {
        await ctx.send.location({
          latitude: outlet.latitude,
          longitude: outlet.longitude,
          name: `Masala Mile ${outlet.name}`,
          address: outlet.address,
        });
      }
      return bookingDetail(ctx, booking);
    default:
      return bookingDetail(ctx, booking);
  }
}

/** The guest asked for it: a utility template two hours before, cancelled with the booking or the demo. */
async function scheduleReminder(ctx: FoodCtx, booking: Booking): Promise<void> {
  const at = istInstant(booking.date, booking.time);
  const outlet = findOutlet(booking.outletId);
  await ctx.followUps.schedule({
    key: `table-reminder:${booking.id}`,
    category: 'utility',
    sendAt: new Date(at.getTime() - REMINDER_LEAD_MS),
    template: {
      name: TEMPLATES.tableReminder,
      language: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: booking.name },
            { type: 'text', text: String(booking.party) },
            { type: 'text', text: outlet?.name ?? '' },
            {
              type: 'text',
              text: `${dayLabel(booking.date, ctx.now()).toLowerCase()} at ${timeLabel(booking.time)}`,
            },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: `booking:directions:${booking.id}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: `booking:cancel:${booking.id}` }],
        },
      ],
    },
  });
  await ctx.send.text(
    `Done: I'll remind you ${instantLabel(new Date(at.getTime() - REMINDER_LEAD_MS), ctx.now()).toLowerCase()}. Cancelling the booking (or typing EXIT) cancels the reminder.`,
  );
}

async function bookingDetail(ctx: FoodCtx, booking: Booking): Promise<void> {
  const outlet = findOutlet(booking.outletId);
  await ctx.send.buttons({
    body: `*Booking ${booking.id}*${booking.status === 'cancelled' ? ' (cancelled)' : ''}\n${booking.party} guests · ${dayLabel(booking.date, ctx.now())} · ${timeLabel(booking.time)}\nMasala Mile ${outlet?.name ?? ''}`,
    footer: DEMO_FOOTER,
    buttons:
      booking.status === 'cancelled'
        ? [{ id: 'table:start', title: 'Book again' }]
        : [
            { id: `booking:directions:${booking.id}`, title: 'Directions' },
            { id: `booking:cancel:${booking.id}`, title: 'Cancel booking' },
          ],
  });
}

export async function myBookings(ctx: FoodCtx): Promise<void> {
  const upcoming = new TableBook(ctx.kv).upcoming(ctx.user.address, ctx.now()).slice(0, 10);
  if (upcoming.length === 0) {
    return nudge(ctx, 'You have no upcoming bookings.');
  }
  await ctx.send.list({
    body: 'Your upcoming bookings:',
    button: 'See bookings',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Upcoming',
        rows: upcoming.map((booking) => ({
          id: `booking:view:${booking.id}`,
          title: dayLabel(booking.date, ctx.now()).replace(/^(Today|Tomorrow), /, '$1 '),
          description: `${timeLabel(booking.time)} · ${booking.party} guests · ${findOutlet(booking.outletId)?.name ?? ''}`,
        })),
      },
    ],
  });
}

// --- Button fallback ------------------------------------------------------------------------

export async function onFallbackChoice(ctx: FoodCtx, action: string, value: string): Promise<void> {
  const draft = ctx.state.bookingDraft;
  const now = ctx.now();
  switch (action) {
    case 'outlet': {
      if (findOutlet(value)?.dineIn !== true) {
        return startBooking(ctx);
      }
      ctx.setState((state) => ({ ...state, bookingDraft: { outletId: value, date: null, party: null } }));
      await ctx.send.list({
        body: 'Which day?',
        button: 'Choose day',
        footer: DEMO_FOOTER,
        sections: [
          {
            title: 'Next 7 days',
            rows: bookingDates(now).map((date) => ({ id: `tb:date:${date.id}`, title: date.title })),
          },
        ],
      });
      return;
    }
    case 'date': {
      if (draft === null || !isBookingDate(value, now)) {
        return startBooking(ctx);
      }
      ctx.setState((state) => ({ ...state, bookingDraft: { ...draft, date: value } }));
      await ctx.send.list({
        body: 'How many guests?',
        button: 'Choose',
        footer: DEMO_FOOTER,
        sections: [
          {
            title: 'Guests',
            rows: Array.from({ length: MAX_PARTY }, (_unused, index) => ({
              id: `tb:party:${index + 1}`,
              title: `${index + 1} guest${index === 0 ? '' : 's'}`,
            })),
          },
        ],
      });
      return;
    }
    case 'party': {
      const party = Number(value);
      if (draft?.date === null || draft === null || !(party >= 1 && party <= MAX_PARTY)) {
        return startBooking(ctx);
      }
      ctx.setState((state) => ({ ...state, bookingDraft: { ...draft, party } }));
      const times = new TableBook(ctx.kv).freeTimes(draft.outletId, draft.date, party, now);
      if (times.length === 0) {
        return nudge(ctx, `We're full on ${dayLabel(draft.date, now)}. Please try another day.`);
      }
      await ctx.send.list({
        body: `Free tables on ${dayLabel(draft.date, now)} for ${party}:`,
        button: 'Choose time',
        footer: DEMO_FOOTER,
        sections: [
          { title: 'Times', rows: times.map((time) => ({ id: `tb:time:${time}`, title: timeLabel(time) })) },
        ],
      });
      return;
    }
    case 'time': {
      if (draft?.date === null || draft?.party === null || draft === null) {
        return startBooking(ctx);
      }
      const result = book(
        new TableBook(ctx.kv),
        ctx.user.address,
        {
          outletId: draft.outletId,
          date: draft.date,
          party: draft.party,
          time: value,
          name: ctx.user.displayName ?? 'Guest',
          occasion: null,
          requests: null,
        },
        ctx.idempotencyKey('booking'),
        now,
      );
      if (!result.ok) {
        return nudge(ctx, result.error);
      }
      await confirmBooking(ctx, result.booking);
      return;
    }
    default:
      return startBooking(ctx);
  }
}
