import { randomBytes } from 'node:crypto';
import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import type { EventInfo, Tier } from './catalog.js';
import { endsAt, findEvent, findTier, startsAt } from './catalog.js';
import type { Quote } from './pricing.js';
import { quote } from './pricing.js';

/** How long seats stay reserved while someone pays. */
export const HOLD_MINUTES = 15;
/** Most tickets one booking can hold. */
export const MAX_PER_BOOKING = 6;

export type BookingStatus = 'held' | 'awaiting_payment' | 'issued' | 'cancelled' | 'expired' | 'refunded';

export interface Booking {
  /** Short and human: printed on the ticket, said over the phone. */
  readonly id: string;
  /** Long and secret: the QR code and the ticket URLs carry this, never the id. */
  readonly code: string;
  readonly address: string;
  readonly eventId: string;
  readonly tierId: string;
  readonly quantity: number;
  readonly name: string;
  readonly email: string | null;
  readonly quote: Quote;
  /** The buyer ticked "send me reminders and live updates". */
  readonly updates: boolean;
  readonly status: BookingStatus;
  readonly createdAt: string;
  readonly holdExpiresAt: string;
  /** Snapshotted at booking time: "tonight" must not move once you have a ticket. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly paymentId: string | null;
  readonly paymentAttempts: number;
  readonly issuedAt: string | null;
  readonly checkedInAt: string | null;
  readonly rating: number | null;
}

export type HoldResult =
  | { readonly ok: true; readonly booking: Booking }
  | {
      readonly ok: false;
      readonly reason: 'sold_out' | 'not_enough' | 'unknown';
      readonly available: number;
    };

interface HoldEntry {
  readonly quantity: number;
  readonly expiresAt: string;
}

/**
 * Inventory, bookings, check-in and waitlists on the example's key-value store. Every
 * read-modify-write is synchronous (SQLite), so two buyers in the same process can never both
 * take the last seat.
 */
export class BoxOffice {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  /** Seats left: capacity, minus sold, minus live holds. */
  available(event: EventInfo, tier: Tier): number {
    const sold = this.kv.get<number>(`sold:${event.id}:${tier.id}`) ?? 0;
    const held = Object.values(this.liveHolds(event.id, tier.id)).reduce(
      (sum, hold) => sum + hold.quantity,
      0,
    );
    return Math.max(0, tier.capacity - tier.soldAtStart - sold - held);
  }

  hold(input: {
    readonly address: string;
    readonly eventId: string;
    readonly tierId: string;
    readonly quantity: number;
    readonly name: string;
    readonly email: string | null;
    readonly promo: string | null;
    readonly updates: boolean;
  }): HoldResult {
    const event = findEvent(input.eventId);
    const tier = event === undefined ? undefined : findTier(event, input.tierId);
    if (event === undefined || tier === undefined) {
      return { ok: false, reason: 'unknown', available: 0 };
    }
    const available = this.available(event, tier);
    if (available === 0) {
      return { ok: false, reason: 'sold_out', available };
    }
    if (input.quantity > available) {
      return { ok: false, reason: 'not_enough', available };
    }
    const now = this.now();
    const sequence = (this.kv.get<number>('booking-seq') ?? 24_050) + 1;
    this.kv.set('booking-seq', sequence);
    const booking: Booking = {
      id: `${event.code}-${sequence}`,
      code: randomBytes(12).toString('base64url'),
      address: input.address,
      eventId: event.id,
      tierId: tier.id,
      quantity: input.quantity,
      name: input.name,
      email: input.email,
      quote: quote(event, tier, input.quantity, input.promo),
      updates: input.updates,
      status: 'held',
      createdAt: now.toISOString(),
      holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000).toISOString(),
      startsAt: startsAt(event, now).toISOString(),
      endsAt: endsAt(event, now).toISOString(),
      paymentId: null,
      paymentAttempts: 0,
      issuedAt: null,
      checkedInAt: null,
      rating: null,
    };
    this.setHold(booking, { quantity: booking.quantity, expiresAt: booking.holdExpiresAt });
    this.save(booking);
    this.kv.set(
      `by:${input.address}`,
      [...(this.kv.get<string[]>(`by:${input.address}`) ?? []), booking.id].slice(-20),
    );
    return { ok: true, booking };
  }

  get(id: string): Booking | undefined {
    return this.kv.get<Booking>(`booking:${id}`);
  }

  byCode(code: string): Booking | undefined {
    const id = this.kv.get<string>(`code:${code}`);
    return id === undefined ? undefined : this.get(id);
  }

  /** Issued bookings of `address`, newest first. */
  ticketsFor(address: string): Booking[] {
    return (this.kv.get<string[]>(`by:${address}`) ?? [])
      .map((id) => this.get(id))
      .filter((booking): booking is Booking => booking?.status === 'issued')
      .reverse();
  }

  isHoldLive(booking: Booking): boolean {
    return booking.status !== 'issued' && new Date(booking.holdExpiresAt) > this.now();
  }

  /** Extends a lapsed hold if the seats are still there (e.g. a retry after the timer ran out). */
  renewHold(booking: Booking): Booking | null {
    if (this.isHoldLive(booking)) {
      return booking;
    }
    const event = findEvent(booking.eventId);
    const tier = event === undefined ? undefined : findTier(event, booking.tierId);
    if (event === undefined || tier === undefined || this.available(event, tier) < booking.quantity) {
      return null;
    }
    const renewed = {
      ...booking,
      status: 'held' as const,
      holdExpiresAt: new Date(this.now().getTime() + HOLD_MINUTES * 60_000).toISOString(),
    };
    this.setHold(renewed, { quantity: renewed.quantity, expiresAt: renewed.holdExpiresAt });
    this.save(renewed);
    return renewed;
  }

  attachPayment(booking: Booking, paymentId: string): Booking {
    const next: Booking = {
      ...booking,
      status: 'awaiting_payment',
      paymentId,
      paymentAttempts: booking.paymentAttempts + 1,
    };
    this.save(next);
    return next;
  }

  /**
   * Turns a paid (or free) booking into tickets. Idempotent. Returns null when the hold lapsed and
   * the seats were sold meanwhile: the caller refunds.
   */
  issue(booking: Booking, paymentId?: string): Booking | null {
    const current = this.get(booking.id) ?? booking;
    if (current.status === 'issued') {
      return current;
    }
    const live = this.isHoldLive(current);
    const event = findEvent(current.eventId);
    const tier = event === undefined ? undefined : findTier(event, current.tierId);
    if (event === undefined || tier === undefined) {
      return null;
    }
    this.removeHold(current);
    if (!live && this.available(event, tier) < current.quantity) {
      this.save({ ...current, status: 'expired' });
      return null;
    }
    const soldKey = `sold:${event.id}:${tier.id}`;
    this.kv.set(soldKey, (this.kv.get<number>(soldKey) ?? 0) + current.quantity);
    const issued: Booking = {
      ...current,
      status: 'issued',
      issuedAt: this.now().toISOString(),
      paymentId: paymentId ?? current.paymentId,
    };
    this.save(issued);
    this.kv.set(`code:${issued.code}`, issued.id);
    return issued;
  }

  release(booking: Booking, status: 'cancelled' | 'expired' | 'refunded'): Booking {
    this.removeHold(booking);
    const next: Booking = { ...booking, status };
    this.save(next);
    return next;
  }

  /** Marks the booking checked in. A second scan returns the first time, never a second entry. */
  checkIn(code: string): { readonly booking: Booking; readonly already: boolean } | null {
    const booking = this.byCode(code);
    if (booking?.status !== 'issued') {
      return null;
    }
    if (booking.checkedInAt !== null) {
      return { booking, already: true };
    }
    const checkedIn: Booking = { ...booking, checkedInAt: this.now().toISOString() };
    this.save(checkedIn);
    return { booking: checkedIn, already: false };
  }

  rate(booking: Booking, rating: number): Booking {
    const next: Booking = { ...booking, rating };
    this.save(next);
    return next;
  }

  // --- Waitlist ------------------------------------------------------------------------

  /** Joins (or stays on) the waitlist; returns the 1-based position. */
  joinWaitlist(eventId: string, tierId: string, address: string): number {
    const key = `waitlist:${eventId}:${tierId}`;
    const list = this.kv.get<string[]>(key) ?? [];
    const next = list.includes(address) ? list : [...list, address];
    this.kv.set(key, next);
    return next.indexOf(address) + 1;
  }

  leaveWaitlist(eventId: string, tierId: string, address: string): void {
    const key = `waitlist:${eventId}:${tierId}`;
    this.kv.set(
      key,
      (this.kv.get<string[]>(key) ?? []).filter((entry) => entry !== address),
    );
  }

  waitlistPosition(eventId: string, tierId: string, address: string): number | null {
    const position = (this.kv.get<string[]>(`waitlist:${eventId}:${tierId}`) ?? []).indexOf(address);
    return position === -1 ? null : position + 1;
  }

  // --- Internals -------------------------------------------------------------------------

  private liveHolds(eventId: string, tierId: string): Record<string, HoldEntry> {
    const now = this.now();
    return Object.fromEntries(
      Object.entries(this.kv.get<Record<string, HoldEntry>>(`holds:${eventId}:${tierId}`) ?? {}).filter(
        ([, hold]) => new Date(hold.expiresAt) > now,
      ),
    );
  }

  private setHold(booking: Booking, entry: HoldEntry): void {
    this.kv.set(`holds:${booking.eventId}:${booking.tierId}`, {
      ...this.liveHolds(booking.eventId, booking.tierId),
      [booking.id]: entry,
    });
  }

  private removeHold(booking: Booking): void {
    const { [booking.id]: _removed, ...rest } = this.liveHolds(booking.eventId, booking.tierId);
    this.kv.set(`holds:${booking.eventId}:${booking.tierId}`, rest);
  }

  private save(booking: Booking): void {
    this.kv.set(`booking:${booking.id}`, booking);
  }
}
