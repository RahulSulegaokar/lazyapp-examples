import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { BOOKING_HORIZON_DAYS, MIN_LEAD_MS } from './clinic.js';
import type { Doctor } from './clinic.js';

/**
 * Real availability: the doctor's weekly roster minus slots other patients hold or booked.
 * Slots live in the example-wide key-value store, so two people never get the same one.
 * All dates are `YYYY-MM-DD` and times `HH:MM` in IST (the clinic's local time).
 */

const IST = 'Asia/Kolkata';

export interface SlotRecord {
  readonly bookingId: string;
  /** Session address of the patient who holds it. */
  readonly address: string;
  readonly status: 'held' | 'booked';
  /** ISO time a hold lapses; null once booked. */
  readonly heldUntil: string | null;
}

const slotKey = (doctorId: string, date: string, time: string) => `slot:${doctorId}:${date}:${time}`;

/** The instant a slot starts. */
export function slotStart(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

/** Calendar date in IST for an instant. */
export function istDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(instant);
}

/** "Sat, 24 Oct". */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(slotStart(date, '12:00'));
}

/** "10:30 AM". */
export function timeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** "Sat, 24 Oct · 10:30 AM". */
export function whenLabel(date: string, time: string): string {
  return `${dayLabel(date)} · ${timeLabel(time)}`;
}

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Every slot on the doctor's roster for a date, ignoring bookings. */
export function rosterSlots(doctor: Doctor, date: string): string[] {
  const weekday = slotStart(date, '12:00').getUTCDay();
  if (!doctor.roster.days.includes(weekday)) {
    return [];
  }
  return doctor.roster.sessions.flatMap((session) => {
    const times: string[] = [];
    for (
      let minute = minutesOf(session.from);
      minute + doctor.roster.slotMinutes <= minutesOf(session.to);
      minute += doctor.roster.slotMinutes
    ) {
      times.push(timeOf(minute));
    }
    return times;
  });
}

export class SlotBook {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  /** Free for `address`: nobody else holds or booked it, and it is far enough ahead. */
  isFree(doctorId: string, date: string, time: string, address: string): boolean {
    if (slotStart(date, time).getTime() < this.now().getTime() + MIN_LEAD_MS) {
      return false;
    }
    const record = this.kv.get<SlotRecord>(slotKey(doctorId, date, time));
    if (record === undefined || record.address === address) {
      return true;
    }
    return (
      record.status === 'held' && (record.heldUntil === null || new Date(record.heldUntil) <= this.now())
    );
  }

  freeTimes(doctor: Doctor, date: string, address: string): string[] {
    return rosterSlots(doctor, date).filter((time) => this.isFree(doctor.id, date, time, address));
  }

  /** Dates within the booking horizon that still have a free slot, with how many. */
  openDates(doctor: Doctor, address: string): { date: string; free: number }[] {
    const today = this.now();
    const dates: { date: string; free: number }[] = [];
    for (let offset = 0; offset < BOOKING_HORIZON_DAYS; offset += 1) {
      const date = istDate(new Date(today.getTime() + offset * 24 * 60 * 60 * 1000));
      const free = this.freeTimes(doctor, date, address).length;
      if (free > 0) {
        dates.push({ date, free });
      }
    }
    return dates;
  }

  /** Holds the slot for `address` until `until`. False when someone else got there first. */
  hold(
    doctorId: string,
    date: string,
    time: string,
    address: string,
    bookingId: string,
    until: Date,
  ): boolean {
    if (!this.isFree(doctorId, date, time, address)) {
      return false;
    }
    this.kv.set(slotKey(doctorId, date, time), {
      bookingId,
      address,
      status: 'held',
      heldUntil: until.toISOString(),
    } satisfies SlotRecord);
    return true;
  }

  /** Turns a hold into a booking. False when the hold lapsed and someone else took the slot. */
  confirm(doctorId: string, date: string, time: string, address: string, bookingId: string): boolean {
    const record = this.kv.get<SlotRecord>(slotKey(doctorId, date, time));
    const ours = record?.address === address && record.bookingId === bookingId;
    if (!ours && !this.isFree(doctorId, date, time, address)) {
      return false;
    }
    this.kv.set(slotKey(doctorId, date, time), {
      bookingId,
      address,
      status: 'booked',
      heldUntil: null,
    } satisfies SlotRecord);
    return true;
  }

  /** Frees a slot, but only if this booking still owns it. */
  release(doctorId: string, date: string, time: string, bookingId: string): void {
    const key = slotKey(doctorId, date, time);
    if (this.kv.get<SlotRecord>(key)?.bookingId === bookingId) {
      this.kv.delete(key);
    }
  }
}
