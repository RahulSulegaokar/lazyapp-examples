import { DEMO_FOOTER, formatInr, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { Booking } from './box-office.js';
import { boxOffice, showEvents, showVenue } from './browse.js';
import type { EventInfo } from './catalog.js';
import { findEvent, findTier, formatDay, formatTime } from './catalog.js';
import { readConfig, TEMPLATES } from './manifest.js';
import type { Ctx } from './state.js';

const config = readConfig(process.env);

/** Where WhatsApp fetches the ticket files from, and where the QR code points. */
export const ticketUrls = (publicBaseUrl: string, code: string) => {
  const base = `${publicBaseUrl}/x/event-tickets`;
  return {
    png: `${base}/t/${code}.png`,
    pdf: `${base}/t/${code}.pdf`,
    checkIn: `${base}/checkin/${code}`,
  };
};

function lookup(ctx: Ctx, bookingId: string): { booking: Booking; event: EventInfo } | null {
  const booking = boxOffice(ctx).get(bookingId);
  const event = booking === undefined ? undefined : findEvent(booking.eventId);
  return booking?.address === ctx.user.address && booking.status === 'issued' && event !== undefined
    ? { booking, event }
    : null;
}

const when = (booking: Booking, now: Date): string => {
  const start = new Date(booking.startsAt);
  return `${formatDay(start, now)}, ${formatTime(start)}`;
};

/** The ticket: QR image, PDF, then what to do next. Three messages, once per booking. */
export async function deliverTickets(ctx: Ctx, booking: Booking): Promise<void> {
  const event = findEvent(booking.eventId);
  const tier = event === undefined ? undefined : findTier(event, booking.tierId);
  if (event === undefined || tier === undefined) {
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'ticketed', bookingId: booking.id }));
  if (ctx.user.contactUuid !== null) {
    try {
      // The segment organisers broadcast live updates to.
      await ctx.api.contacts.addTags(ctx.user.contactUuid, [`event:${event.id}`, 'tickets:buyer']);
    } catch (error) {
      ctx.log.warn('could not tag the ticket holder', { error });
    }
  }
  const urls = ticketUrls(ctx.config.publicBaseUrl, booking.code);
  await ctx.send.image(
    urls.png,
    `🎟️ *${event.title}* · Admit ${booking.quantity}\n${when(booking, ctx.now())} · ${event.venue.name}, ${event.venue.area}\n` +
      `${booking.name} · ${tier.name} · Booking ${booking.id}\n\nShow this QR code at the entrance.`,
  );
  await ctx.send.document(urls.pdf, `Ticket-${booking.id}.pdf`, 'Your ticket as a PDF, to print or forward.');
  const remindersOn = booking.updates ? await scheduleReminders(ctx, booking, event) : null;
  await ctx.send.buttons({
    body:
      `You're in, ${booking.name.split(' ')[0] ?? booking.name}! 🎉 ${booking.quote.total === 0 ? 'Free registration confirmed.' : `Paid ${formatInr(booking.quote.total)}.`}` +
      (remindersOn === null ? '' : `\n\n${remindersOn}`),
    footer: DEMO_FOOTER,
    buttons: [
      { id: `cal:${booking.id}`, title: 'Add to calendar' },
      { id: `venue:${booking.id}`, title: 'Venue & directions' },
      remindersOn === null
        ? { id: `rem:${booking.id}`, title: 'Remind me' }
        : { id: `ci:${booking.id}`, title: 'Try check-in' },
    ],
  });
}

export async function myTickets(ctx: Ctx): Promise<void> {
  const tickets = boxOffice(ctx).ticketsFor(ctx.user.address).slice(0, 10);
  if (tickets.length === 0) {
    return showEvents(ctx, "You don't have tickets yet. Here is what is on:");
  }
  await ctx.send.list({
    header: 'My tickets',
    body: 'Tap a booking to see the ticket, the venue and check-in.',
    button: 'My tickets',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Bookings',
        rows: tickets.map((booking) => ({
          id: `tk:show:${booking.id}`,
          title: findEvent(booking.eventId)?.title ?? booking.id,
          description: `${when(booking, ctx.now())} · Admit ${booking.quantity} · ${booking.checkedInAt === null ? booking.id : 'checked in'}`,
        })),
      },
    ],
  });
}

export async function showTicket(ctx: Ctx, bookingId: string): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null) {
    return myTickets(ctx);
  }
  const { booking, event } = found;
  await ctx.send.image(
    ticketUrls(ctx.config.publicBaseUrl, booking.code).png,
    `🎟️ *${event.title}* · Admit ${booking.quantity}\n${when(booking, ctx.now())} · ${event.venue.name}\nBooking ${booking.id}` +
      (booking.checkedInAt === null ? '' : `\n✅ Checked in at ${formatTime(new Date(booking.checkedInAt))}`),
  );
  await ctx.send.buttons({
    body: 'What do you need?',
    footer: DEMO_FOOTER,
    buttons: [
      { id: `venue:${booking.id}`, title: 'Venue & directions' },
      { id: `upd:${booking.id}`, title: 'Live updates' },
      { id: `ci:${booking.id}`, title: 'Try check-in' },
    ],
  });
}

/** A Google Calendar link: the add-to-calendar flow that works on every Android phone. */
export async function addToCalendar(ctx: Ctx, bookingId: string): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null) {
    return myTickets(ctx);
  }
  const { booking, event } = found;
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(event.title)}` +
    `&dates=${stamp(booking.startsAt)}/${stamp(booking.endsAt)}` +
    `&location=${encodeURIComponent(`${event.venue.name}, ${event.venue.area}, ${event.venue.city}`)}` +
    `&details=${encodeURIComponent(`Booking ${booking.id}, admit ${booking.quantity}. Your QR ticket is in the WhatsApp chat.`)}`;
  await ctx.send.cta({
    body: `Add *${event.title}* (${when(booking, ctx.now())}) to your calendar, so nothing else lands on that evening.`,
    displayText: 'Add to calendar',
    url,
    footer: DEMO_FOOTER,
  });
}

export async function venue(ctx: Ctx, bookingId: string): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null) {
    return myTickets(ctx);
  }
  await showVenue(ctx, found.event, `Your booking: *${found.booking.id}* · Admit ${found.booking.quantity}`);
}

/** "Remind me": schedule the approved utility templates the buyer asked for. */
export async function remindMe(ctx: Ctx, bookingId: string): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null) {
    return myTickets(ctx);
  }
  if (ctx.state.reminded.includes(found.booking.id)) {
    await ctx.send.text('Your reminders are already set. Type *EXIT* to cancel them.');
    return;
  }
  const summary = await scheduleReminders(ctx, found.booking, found.event);
  await ctx.send.buttons({
    body: summary,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `ci:${found.booking.id}`, title: 'Try check-in' },
      { id: `upd:${found.booking.id}`, title: 'Live updates' },
      { id: RESERVED_IDS.menu, title: 'All events' },
    ],
  });
}

/**
 * Schedules the day-before and hour-before reminders and the post-event rating, each only if it
 * falls inside this demo session (sessions end after 24 quiet hours and cancel their follow-ups).
 * Returns a sentence saying what was set up.
 */
async function scheduleReminders(ctx: Ctx, booking: Booking, event: EventInfo): Promise<string> {
  const now = ctx.now().getTime();
  const start = new Date(booking.startsAt);
  const horizon = now + 23 * 60 * 60_000;
  const fits = (at: Date) => at.getTime() > now + 5 * 60_000 && at.getTime() < horizon;
  const show = {
    type: 'button',
    sub_type: 'quick_reply',
    index: '0',
    parameters: [{ type: 'payload', payload: `tk:show:${booking.id}` }],
  };
  const firstName = booking.name.split(' ')[0] ?? booking.name;
  const planned: {
    key: string;
    at: Date;
    label: string;
    template: { name: string; components: Record<string, unknown>[] };
  }[] = [
    {
      key: `day-before-${booking.id}`,
      at: new Date(start.getTime() - 24 * 60 * 60_000),
      label: 'the day before',
      template: {
        name: TEMPLATES.reminder,
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: firstName },
              { type: 'text', text: event.title },
              {
                type: 'text',
                text: formatTime(new Date(start.getTime() - event.doorsBeforeMinutes * 60_000)),
              },
              { type: 'text', text: `${event.venue.name}, ${event.venue.area}` },
            ],
          },
          show,
        ],
      },
    },
    {
      key: `hour-before-${booking.id}`,
      at: new Date(start.getTime() - 60 * 60_000),
      label: 'an hour before, with the map',
      template: {
        name: TEMPLATES.startingSoon,
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'location',
                location: {
                  latitude: String(event.venue.latitude),
                  longitude: String(event.venue.longitude),
                  name: event.venue.name,
                  address: `${event.venue.area}, ${event.venue.city}`,
                },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: event.title },
              { type: 'text', text: booking.id },
            ],
          },
          show,
        ],
      },
    },
    {
      key: `feedback-${booking.id}`,
      at: new Date(new Date(booking.endsAt).getTime() + 30 * 60_000),
      label: 'a rating request after the show',
      template: {
        name: TEMPLATES.feedback,
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: event.title },
              { type: 'text', text: firstName },
            ],
          },
          ...[5, 3, 1].map((score, index) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(index),
            parameters: [{ type: 'payload', payload: `fb:${score}:${booking.id}` }],
          })),
        ],
      },
    },
  ];
  const scheduled: string[] = [];
  for (const item of planned.filter((entry) => fits(entry.at))) {
    await ctx.followUps.schedule({
      key: item.key,
      category: 'utility',
      sendAt: item.at,
      template: { name: item.template.name, language: 'en', components: item.template.components },
    });
    scheduled.push(`${item.label} (${formatDay(item.at, ctx.now())}, ${formatTime(item.at)})`);
  }
  ctx.setState((state) => ({ ...state, reminded: [...state.reminded.slice(-19), booking.id] }));
  if (ctx.user.contactUuid !== null) {
    try {
      await ctx.api.contacts.addTags(ctx.user.contactUuid, [`event-updates:${event.id}`]);
    } catch (error) {
      ctx.log.warn('could not tag the contact for updates', { error });
    }
  }
  return scheduled.length === 0
    ? `⏰ Reminders are on. This demo only schedules messages inside its 24-hour session, and ${event.title} is further out, so a live system would send them closer to the day.`
    : `⏰ I'll message you ${scheduled.join(', ')}. Type *EXIT* to cancel them.`;
}

/** What an organiser's broadcast looks like (sent to this person only; see the README). */
export async function previewUpdate(ctx: Ctx, bookingId: string): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null) {
    return myTickets(ctx);
  }
  const { booking, event } = found;
  const doors = new Date(new Date(booking.startsAt).getTime() - event.doorsBeforeMinutes * 60_000);
  await ctx.send.text(
    `Organisers send updates to every ticket holder at once: a LazyApp broadcast (\`POST /v1/broadcasts\`) to contacts tagged *event:${event.id}*. Here's one, sent only to you:`,
  );
  await ctx.send.template({
    name: TEMPLATES.update,
    language: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: event.title },
          { type: 'text', text: booking.id },
          { type: 'text', text: formatTime(doors) },
        ],
      },
    ],
  });
}

/** Lets the tester play door staff: the check-in page the QR code opens. */
export async function checkInLink(ctx: Ctx, bookingId: string): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null) {
    return myTickets(ctx);
  }
  await ctx.send.cta({
    body:
      `At the gate, staff scan your QR code with any phone camera and it opens the check-in screen. Play the staff: ` +
      `open it, enter PIN *${config.staffPin}* and tap *Check in*. Your welcome message arrives here.`,
    displayText: 'Open staff screen',
    url: ticketUrls(ctx.config.publicBaseUrl, found.booking.code).checkIn,
    footer: DEMO_FOOTER,
  });
}

/** Sent by the check-in page, through `web.notify`, the moment the QR code is scanned. */
export async function welcome(ctx: Ctx, booking: Booking): Promise<void> {
  const event = findEvent(booking.eventId);
  if (event === undefined) {
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'ticketed', bookingId: booking.id }));
  await ctx.send.buttons({
    header: { image: event.image },
    body:
      `Welcome to *${event.title}*, ${booking.name.split(' ')[0] ?? booking.name}! ✅ Checked in` +
      `${booking.quantity > 1 ? ` (admit ${booking.quantity})` : ''} at ${formatTime(new Date(booking.checkedInAt ?? ctx.now().toISOString()))}.\n\n` +
      event.welcome,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `sch:${event.id}`, title: 'Schedule' },
      { id: `fb:start:${booking.id}`, title: 'Rate the event' },
    ],
  });
}

export async function schedule(ctx: Ctx, eventId: string): Promise<void> {
  const event = findEvent(eventId);
  if (event === undefined) {
    return showEvents(ctx, 'Here is what is on:');
  }
  await ctx.send.text(`*${event.title}*\n\n${event.schedule.join('\n')}`);
}

export async function askRating(ctx: Ctx, bookingId: string): Promise<void> {
  await ctx.send.buttons({
    body: 'How was it? One tap, straight to the organisers.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: `fb:5:${bookingId}`, title: 'Loved it' },
      { id: `fb:3:${bookingId}`, title: 'It was OK' },
      { id: `fb:1:${bookingId}`, title: 'Not great' },
    ],
  });
}

export async function rate(ctx: Ctx, bookingId: string, score: number): Promise<void> {
  const found = lookup(ctx, bookingId);
  if (found === null || ![1, 3, 5].includes(score)) {
    return myTickets(ctx);
  }
  boxOffice(ctx).rate(found.booking, score);
  await ctx.send.react(score >= 5 ? '😍' : score >= 3 ? '🙂' : '🙏');
  await ctx.send.cta({
    body:
      score >= 3
        ? `Thanks! The official photos from *${found.event.title}* are up: find yourself in the crowd.`
        : `Sorry it wasn't great; the organisers read every rating. The photos are up if you want them.`,
    displayText: 'See the photos',
    url: `${ctx.config.publicBaseUrl}/x/event-tickets/gallery/${found.event.id}`,
    footer: DEMO_FOOTER,
  });
}
