import { CLOSING_HOUR, OPENING_HOUR } from './kitchen.js';

/** Bengaluru time. Every clock in this example is IST, whatever the server's zone. */
const IST_OFFSET_MS = 330 * 60_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

interface IstParts {
  readonly date: string;
  readonly minutes: number;
}

function ist(at: Date): IstParts {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** `2026-10-24` + `19:30` (IST) → the instant. */
export function istInstant(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00+05:30`));
}

export function timeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function dayLabel(date: string, now: Date): string {
  const today = ist(now).date;
  const tomorrow = ist(new Date(now.getTime() + DAY)).date;
  const day = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions): string =>
    day.toLocaleDateString('en-IN', { ...options, timeZone: 'UTC' });
  const pretty = `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
  if (date === today) {
    return `Today, ${pretty}`;
  }
  return date === tomorrow ? `Tomorrow, ${pretty}` : pretty;
}

/** "Today, Fri 23 Oct, 7:30 pm". */
export function instantLabel(at: Date, now: Date): string {
  const parts = ist(at);
  const time = `${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}`;
  return `${dayLabel(parts.date, now)}, ${timeLabel(time)}`;
}

export function isKitchenOpen(now: Date): boolean {
  const { minutes } = ist(now);
  return minutes >= OPENING_HOUR * 60 && minutes < CLOSING_HOUR * 60 - 30;
}

/**
 * The next eight half-hour delivery slots, at least an hour out and inside
 * kitchen hours (11 am – 11 pm), rolling over to tomorrow.
 */
export function laterSlots(now: Date, count = 8): { at: Date; label: string }[] {
  const slots: { at: Date; label: string }[] = [];
  let cursor = Math.ceil((now.getTime() + 60 * MINUTE) / (30 * MINUTE)) * 30 * MINUTE;
  while (slots.length < count) {
    const at = new Date(cursor);
    const { minutes } = ist(at);
    if (minutes >= OPENING_HOUR * 60 + 30 && minutes <= CLOSING_HOUR * 60 - 30) {
      slots.push({ at, label: instantLabel(at, now) });
    }
    cursor += 30 * MINUTE;
  }
  return slots;
}

// --- Table booking -------------------------------------------------------------------

export const TABLE_TIMES = [
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
];
export const BOOKING_DAYS = 7;

export function bookingDates(now: Date): { id: string; title: string }[] {
  return Array.from({ length: BOOKING_DAYS }, (_unused, offset) => {
    const date = ist(new Date(now.getTime() + offset * DAY)).date;
    return { id: date, title: dayLabel(date, now) };
  });
}

/** Times still bookable on `date`: today's need an hour's notice. */
export function bookableTimes(date: string, now: Date): string[] {
  const earliest = now.getTime() + 60 * MINUTE;
  return TABLE_TIMES.filter((time) => istInstant(date, time).getTime() >= earliest);
}

export function isBookingDate(date: string, now: Date): boolean {
  return bookingDates(now).some((entry) => entry.id === date);
}
