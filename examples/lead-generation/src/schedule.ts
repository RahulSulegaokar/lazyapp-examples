import type { KeyValueStore } from '@lazyapp-examples/demo-kit';

/**
 * Sales calendar in India Standard Time: 30-minute demos on weekdays, one lead per rep per
 * slot, kept in the example's key-value store so concurrent leads cannot double-book a rep.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export const MEETING_TIMES = ['10:00', '11:30', '14:00', '15:30', '17:00'] as const;
/** Business days ahead a demo can be booked. */
export const BOOKING_DAYS = 5;
/** Reps need an hour to prepare. */
export const MIN_LEAD_MS = 60 * 60_000;
export const MEETING_MINUTES = 30;

export interface Day {
  readonly id: string;
  readonly title: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function shifted(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MS);
}

export function istDay(instant: Date): Day {
  const local = shifted(instant);
  return {
    id: local.toISOString().slice(0, 10),
    title: `${WEEKDAYS[local.getUTCDay()] ?? ''}, ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()] ?? ''}`,
  };
}

function isWeekend(instant: Date): boolean {
  const day = shifted(instant).getUTCDay();
  return day === 0 || day === 6;
}

/** Today (if a weekday) and the following business days, in IST. */
export function businessDays(now: Date, count = BOOKING_DAYS): Day[] {
  const days: Day[] = [];
  for (let offset = 0; days.length < count && offset < count * 3; offset += 1) {
    const instant = new Date(now.getTime() + offset * DAY_MS);
    if (!isWeekend(instant)) {
      days.push(istDay(instant));
    }
  }
  return days;
}

export function slotInstant(dayId: string, time: string): Date {
  return new Date(`${dayId}T${time}:00+05:30`);
}

export function formatTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}

/** `Mon, 26 Oct at 11:30 AM` (IST). */
export function formatWhen(instant: Date): string {
  const local = shifted(instant);
  const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  return `${istDay(instant).title} at ${formatTime(time)}`;
}

export function isBookable(dayId: string, time: string, now: Date): boolean {
  if (
    !(MEETING_TIMES as readonly string[]).includes(time) ||
    !businessDays(now).some((day) => day.id === dayId)
  ) {
    return false;
  }
  return slotInstant(dayId, time).getTime() - now.getTime() >= MIN_LEAD_MS;
}

const slotKey = (repId: string, at: Date) => `meet:${repId}:${at.toISOString()}`;

/** Books the rep for `holder`. Idempotent for the same holder. */
export function reserveSlot(kv: KeyValueStore, repId: string, at: Date, holder: string): boolean {
  const current = kv.get<string>(slotKey(repId, at));
  if (current !== undefined) {
    return current === holder;
  }
  kv.set(slotKey(repId, at), holder);
  return true;
}

export function releaseSlot(kv: KeyValueStore, repId: string, at: Date, holder: string): void {
  if (kv.get<string>(slotKey(repId, at)) === holder) {
    kv.delete(slotKey(repId, at));
  }
}

export interface OpenSlot {
  readonly day: Day;
  readonly time: string;
  readonly at: Date;
}

export function openSlotsOn(kv: KeyValueStore, repId: string, dayId: string, now: Date): OpenSlot[] {
  const day = istDay(slotInstant(dayId, '12:00'));
  return MEETING_TIMES.filter((time) => isBookable(dayId, time, now))
    .map((time) => ({ day, time, at: slotInstant(dayId, time) }))
    .filter((slot) => kv.get<string>(slotKey(repId, slot.at)) === undefined);
}

export function openDays(kv: KeyValueStore, repId: string, now: Date): Day[] {
  return businessDays(now).filter((day) => openSlotsOn(kv, repId, day.id, now).length > 0);
}

export function nextOpenSlots(kv: KeyValueStore, repId: string, now: Date, limit: number): OpenSlot[] {
  return businessDays(now)
    .flatMap((day) => openSlotsOn(kv, repId, day.id, now))
    .slice(0, limit);
}
