/**
 * Business hours and SLA clocks, in India time (UTC+5:30, no daylight saving). Pure functions
 * of `Date`, so tests pin any moment of the week.
 */

const IST_OFFSET_MS = 330 * 60_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Agents work Monday to Saturday, 9 am to 9 pm IST. */
export const HOURS = { open: 9, close: 21, days: [1, 2, 3, 4, 5, 6] as readonly number[] } as const;

export const HOURS_LABEL = 'Mon–Sat, 9 am–9 pm IST';

/** Wall-clock fields of `date` in IST. */
function ist(date: Date): { readonly day: number; readonly minutes: number; readonly midnight: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60;
  const midnight =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS;
  return { day: shifted.getUTCDay(), minutes, midnight };
}

export function isOpen(date: Date): boolean {
  const { day, minutes } = ist(date);
  return HOURS.days.includes(day) && minutes >= HOURS.open * 60 && minutes < HOURS.close * 60;
}

/** `date` itself when the desk is open, otherwise the next opening time. */
export function nextOpening(date: Date): Date {
  if (isOpen(date)) {
    return date;
  }
  const parts = ist(date);
  let { day, midnight } = parts;
  if (HOURS.days.includes(day) && parts.minutes < HOURS.open * 60) {
    return new Date(midnight + HOURS.open * 60 * MINUTE);
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    midnight += DAY;
    day = (day + 1) % 7;
    if (HOURS.days.includes(day)) {
      return new Date(midnight + HOURS.open * 60 * MINUTE);
    }
  }
  throw new Error('No opening day configured');
}

/** `start` plus `minutes` of business time: the clock only runs while the desk is open. */
export function addBusinessMinutes(start: Date, minutes: number): Date {
  let cursor = nextOpening(start);
  let remaining = minutes;
  for (;;) {
    const { minutes: now, midnight } = ist(cursor);
    const left = HOURS.close * 60 - now;
    if (remaining <= left) {
      return new Date(cursor.getTime() + remaining * MINUTE);
    }
    remaining -= left;
    cursor = nextOpening(new Date(midnight + HOURS.close * 60 * MINUTE));
  }
}

const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' });
const SHORT_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});

/** `9:15 am`. */
export function formatTime(date: Date): string {
  return TIME.format(date).replace(
    /\s?([AP]M)$/i,
    (_match, meridiem: string) => ` ${meridiem.toLowerCase()}`,
  );
}

/** `9:15 am`, `9:15 am tomorrow`, `9:15 am Monday`: relative to `now`. */
export function formatWhen(date: Date, now: Date): string {
  const days = Math.round((ist(date).midnight - ist(now).midnight) / DAY);
  if (days === 0) {
    return formatTime(date);
  }
  if (days === 1) {
    return `${formatTime(date)} tomorrow`;
  }
  if (days === -1) {
    return `${formatTime(date)} yesterday`;
  }
  return days < 7
    ? `${formatTime(date)} ${WEEKDAY.format(date)}`
    : `${formatTime(date)}, ${SHORT_DATE.format(date)}`;
}

/** `3 Nov`. */
export function formatDate(date: Date): string {
  return SHORT_DATE.format(date);
}

/** `12 min`, `1 h 5 min`, `3 h`. */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
