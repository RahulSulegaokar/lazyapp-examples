import type { KeyValueStore } from '@lazyapp-examples/demo-kit';

/**
 * Site-visit calendar in India Standard Time. Pure date maths plus a tiny slot ledger in
 * the example's key-value store, shared by every visitor, so two people cannot take the
 * last place in the same slot.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Site offices open every day; visits start on the hour or half hour. */
export const VISIT_TIMES = ['10:00', '11:30', '13:00', '15:00', '16:30', '18:00'] as const;
/** Visits each sales gallery can host per slot. */
export const SLOT_CAPACITY = 2;
/** How far ahead visits can be booked. */
export const BOOKING_DAYS = 5;
/** No visits sooner than this (the agent needs time to reach the site). */
export const MIN_LEAD_MS = 2 * 60 * 60_000;

export interface Day {
  /** `2026-10-24` (IST). */
  readonly id: string;
  /** `Sat, 24 Oct`. */
  readonly title: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The IST calendar day of an instant. */
export function istDay(instant: Date): Day {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const id = shifted.toISOString().slice(0, 10);
  return {
    id,
    title: `${WEEKDAYS[shifted.getUTCDay()] ?? ''}, ${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()] ?? ''}`,
  };
}

/** Today and the next `count - 1` days, in IST. */
export function upcomingDays(now: Date, count = BOOKING_DAYS): Day[] {
  return Array.from({ length: count }, (_, index) => istDay(new Date(now.getTime() + index * DAY_MS)));
}

/** `2026-10-24` + `11:30` IST as an instant. */
export function slotInstant(dayId: string, time: string): Date {
  return new Date(`${dayId}T${time}:00+05:30`);
}

/** `11:30` → `11:30 AM`. */
export function formatTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** `Sat, 24 Oct at 11:30 AM` (IST). */
export function formatWhen(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const time = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  return `${istDay(instant).title} at ${formatTime(time)}`;
}

/** True for `YYYY-MM-DD` + a known visit time that is still bookable. */
export function isBookable(dayId: string, time: string, now: Date): boolean {
  if (!(VISIT_TIMES as readonly string[]).includes(time) || !/^\d{4}-\d{2}-\d{2}$/.test(dayId)) {
    return false;
  }
  const at = slotInstant(dayId, time).getTime();
  return (
    !Number.isNaN(at) && at - now.getTime() >= MIN_LEAD_MS && at - now.getTime() <= BOOKING_DAYS * DAY_MS
  );
}

// --- Slot ledger ------------------------------------------------------------------

const slotKey = (listingId: string, at: Date) => `slot:${listingId}:${at.toISOString()}`;

export function holders(kv: KeyValueStore, listingId: string, at: Date): string[] {
  return kv.get<string[]>(slotKey(listingId, at)) ?? [];
}

/** Takes a place in the slot for `holder`. Idempotent: a holder already in the slot keeps it. */
export function reserveSlot(kv: KeyValueStore, listingId: string, at: Date, holder: string): boolean {
  const current = holders(kv, listingId, at);
  if (current.includes(holder)) {
    return true;
  }
  if (current.length >= SLOT_CAPACITY) {
    return false;
  }
  kv.set(slotKey(listingId, at), [...current, holder]);
  return true;
}

export function releaseSlot(kv: KeyValueStore, listingId: string, at: Date, holder: string): void {
  const remaining = holders(kv, listingId, at).filter((entry) => entry !== holder);
  if (remaining.length === 0) {
    kv.delete(slotKey(listingId, at));
  } else {
    kv.set(slotKey(listingId, at), remaining);
  }
}

export interface OpenSlot {
  readonly day: Day;
  readonly time: string;
  readonly at: Date;
}

/** Bookable slots for one day, soonest first. */
export function openSlotsOn(kv: KeyValueStore, listingId: string, dayId: string, now: Date): OpenSlot[] {
  const day = istDay(slotInstant(dayId, '12:00'));
  return VISIT_TIMES.filter((time) => isBookable(dayId, time, now))
    .map((time) => ({ day, time, at: slotInstant(dayId, time) }))
    .filter((slot) => holders(kv, listingId, slot.at).length < SLOT_CAPACITY);
}

/** The next `limit` bookable slots across the booking window. */
export function nextOpenSlots(kv: KeyValueStore, listingId: string, now: Date, limit: number): OpenSlot[] {
  return upcomingDays(now, BOOKING_DAYS + 1)
    .flatMap((day) => openSlotsOn(kv, listingId, day.id, now))
    .slice(0, limit);
}

/** Days in the window that still have a free slot. */
export function openDays(kv: KeyValueStore, listingId: string, now: Date): Day[] {
  return upcomingDays(now, BOOKING_DAYS + 1).filter(
    (day) => openSlotsOn(kv, listingId, day.id, now).length > 0,
  );
}
