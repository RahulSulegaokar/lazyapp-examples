import { DEMO_FOOTER, formatInr, RESERVED_IDS, ui } from '@lazyapp-examples/demo-kit';
import { BoxOffice, MAX_PER_BOOKING } from './box-office.js';
import type { EventInfo, Tier } from './catalog.js';
import { doorsAt, EVENTS, findEvent, findTier, formatTime, formatWhen, startsAt } from './catalog.js';
import { FLOWS } from './manifest.js';
import type { Ctx } from './state.js';

export const boxOffice = (ctx: { readonly kv: Ctx['kv']; readonly now: () => Date }) =>
  new BoxOffice(ctx.kv, ctx.now);

/** "From ₹499", or "Free" when the cheapest tier costs nothing. */
function fromPrice(event: EventInfo): string {
  const cheapest = Math.min(...event.tiers.map((tier) => tier.price));
  return cheapest === 0 ? 'Free entry' : `From ${formatInr(cheapest)}`;
}

export function availabilityLabel(available: number): string {
  if (available === 0) {
    return 'sold out';
  }
  return available < 20 ? `only ${available} left` : 'available';
}

/** Discovery: a media carousel, one card per event, each with the same two quick replies. */
export async function showEvents(ctx: Ctx, intro: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'browse', selection: null }));
  const now = ctx.now();
  const upcoming = [...EVENTS].sort((a, b) => startsAt(a, now).getTime() - startsAt(b, now).getTime());
  await ctx.send.interactive(
    ui.mediaCarousel(
      `${intro}\n\nSwipe through what's on, then tap *Get tickets*.`,
      upcoming.map((event) => ({
        image: event.image,
        body: `${event.title}\n${formatWhen(event, now)} · ${event.venue.area}, ${event.venue.city}\n${fromPrice(event)}`,
        quickReplies: [
          { id: `ev:${event.id}`, title: 'Get tickets' },
          { id: `info:${event.id}`, title: 'Venue & details' },
        ],
      })),
    ),
  );
  const tickets = boxOffice(ctx).ticketsFor(ctx.user.address);
  await ctx.send.buttons({
    body:
      tickets.length === 0
        ? 'Tickets arrive right here as a QR code and a PDF, and get you in at the gate.'
        : `You have ${tickets.length} booking${tickets.length === 1 ? '' : 's'} in this chat.`,
    footer: DEMO_FOOTER,
    buttons: [{ id: 'my:tickets', title: 'My tickets' }],
  });
}

/** One event: what, when, where, and a button per ticket tier. */
export async function showEvent(ctx: Ctx, eventId: string): Promise<void> {
  const event = findEvent(eventId);
  if (event === undefined) {
    return showEvents(ctx, 'That event is no longer on sale. Here is what is on:');
  }
  const office = boxOffice(ctx);
  const now = ctx.now();
  ctx.setState((state) => ({ ...state, step: 'browse', selection: null }));
  const tiers = event.tiers.map((tier) => ({ tier, available: office.available(event, tier) }));
  const tierLines = tiers.map(
    ({ tier, available }) =>
      `• *${tier.name}* · ${tier.price === 0 ? 'Free' : formatInr(tier.price)} · ${tier.perks} (${availabilityLabel(available)})`,
  );
  const buttons = tiers.slice(0, 3).map(({ tier, available }) => ({
    id: `tier:${event.id}:${tier.id}`,
    title:
      available === 0
        ? `${tier.name} waitlist`
        : `${tier.name} ${tier.price === 0 ? '· Free' : formatInr(tier.price)}`,
  }));
  await ctx.send.buttons({
    header: { image: event.image },
    body:
      `*${event.title}*\n${event.kind} · ${formatWhen(event, now)} (doors ${formatTime(doorsAt(event, now))})\n` +
      `📍 ${event.venue.name}, ${event.venue.area}, ${event.venue.city}\n\n${event.about}\n\n${tierLines.join('\n')}`,
    footer: DEMO_FOOTER,
    buttons:
      buttons.length < 3 ? [...buttons, { id: `info:${event.id}`, title: 'Venue & details' }] : buttons,
  });
}

export async function showVenue(ctx: Ctx, event: EventInfo, extra?: string): Promise<void> {
  const now = ctx.now();
  await ctx.send.location({
    latitude: event.venue.latitude,
    longitude: event.venue.longitude,
    name: event.venue.name,
    address: `${event.venue.area}, ${event.venue.city}`,
  });
  await ctx.send.buttons({
    body:
      `*${event.title}* at *${event.venue.name}*\n${formatWhen(event, now)} · doors ${formatTime(doorsAt(event, now))}\n\n` +
      `🚇 ${event.venue.directions}\n\n*Schedule*\n${event.schedule.join('\n')}${extra === undefined ? '' : `\n\n${extra}`}`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `ev:${event.id}`, title: 'Get tickets' },
      { id: 'browse', title: 'All events' },
    ],
  });
}

/** Tier chosen: waitlist when sold out, otherwise the attendee Flow (or quantity buttons). */
export async function chooseTier(ctx: Ctx, eventId: string, tierId: string): Promise<void> {
  const event = findEvent(eventId);
  const tier = event === undefined ? undefined : findTier(event, tierId);
  if (event === undefined || tier === undefined) {
    return showEvents(ctx, 'That ticket type is no longer on sale. Here is what is on:');
  }
  const office = boxOffice(ctx);
  const available = office.available(event, tier);
  if (available === 0) {
    return offerWaitlist(ctx, event, tier);
  }
  ctx.setState((state) => ({ ...state, step: 'details', selection: { eventId, tierId } }));
  if (await ctx.flows.isAvailable(FLOWS.attendee)) {
    await ctx.flows.send({
      key: FLOWS.attendee,
      header: event.title,
      body:
        `*${tier.name}* · ${tier.price === 0 ? 'Free' : `${formatInr(tier.price)} each`}\n` +
        "Add the attendee's details. You'll see the total, fees and any promo before you pay.",
      cta: 'Add details',
      footer: DEMO_FOOTER,
    });
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'quantity' }));
  const options = [1, 2, 4].filter((quantity) => quantity <= Math.min(available, MAX_PER_BOOKING));
  await ctx.send.buttons({
    body: `*${event.title}* · ${tier.name}\nHow many tickets? (${availabilityLabel(available)})`,
    footer: DEMO_FOOTER,
    buttons: options.map((quantity) => ({
      id: `qty:${quantity}`,
      title: `${quantity} ticket${quantity === 1 ? '' : 's'}`,
    })),
  });
}

async function offerWaitlist(ctx: Ctx, event: EventInfo, tier: Tier): Promise<void> {
  const position = boxOffice(ctx).waitlistPosition(event.id, tier.id, ctx.user.address);
  await ctx.send.buttons({
    body:
      `*${tier.name}* for ${event.title} is sold out.` +
      (position === null
        ? ' Join the waitlist and you will be offered a seat here, first come first served, if one is released.'
        : ` You are *#${position}* on the waitlist.`),
    footer: DEMO_FOOTER,
    buttons: [
      position === null
        ? { id: `wl:join:${event.id}:${tier.id}`, title: 'Join waitlist' }
        : { id: `wl:leave:${event.id}:${tier.id}`, title: 'Leave waitlist' },
      { id: `ev:${event.id}`, title: 'Other tickets' },
    ],
  });
}

export async function joinWaitlist(ctx: Ctx, eventId: string, tierId: string): Promise<void> {
  const event = findEvent(eventId);
  const tier = event === undefined ? undefined : findTier(event, tierId);
  if (event === undefined || tier === undefined) {
    return showEvents(ctx, 'That waitlist is closed. Here is what is on:');
  }
  const position = boxOffice(ctx).joinWaitlist(event.id, tier.id, ctx.user.address);
  if (ctx.user.contactUuid !== null) {
    try {
      await ctx.api.contacts.addTags(ctx.user.contactUuid, [`waitlist:${event.id}`]);
    } catch (error) {
      ctx.log.warn('could not tag the waitlisted contact', { error });
    }
  }
  await ctx.send.react('📝');
  await ctx.send.buttons({
    body:
      `You're *#${position}* on the ${tier.name} waitlist for ${event.title}. If a seat is released, the first ` +
      'person in line gets it here with a 15-minute hold to pay.',
    footer: DEMO_FOOTER,
    buttons: [
      { id: `wl:leave:${event.id}:${tier.id}`, title: 'Leave waitlist' },
      { id: `ev:${event.id}`, title: 'Other tickets' },
      { id: RESERVED_IDS.menu, title: 'All events' },
    ],
  });
}

export async function leaveWaitlist(ctx: Ctx, eventId: string, tierId: string): Promise<void> {
  boxOffice(ctx).leaveWaitlist(eventId, tierId, ctx.user.address);
  await showEvent(ctx, eventId);
}
