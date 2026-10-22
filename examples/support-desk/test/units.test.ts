import { DemoStore } from '@lazyapp-examples/demo-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { normaliseOrderId } from '../src/data.js';
import { addBusinessMinutes, formatDuration, formatWhen, isOpen, nextOpening } from '../src/hours.js';
import { TicketDesk } from '../src/tickets.js';

const ist = (local: string) => new Date(`${local}+05:30`);

describe('business hours (Mon–Sat, 9 am–9 pm IST)', () => {
  it.each([
    ['2026-10-23T09:00:00', true],
    ['2026-10-23T20:59:00', true],
    ['2026-10-23T21:00:00', false],
    ['2026-10-23T08:59:00', false],
    ['2026-10-25T12:00:00', false], // Sunday
  ])('isOpen(%s) → %s', (local, expected) => {
    expect(isOpen(ist(local))).toBe(expected);
  });

  it('finds the next opening across nights and Sundays', () => {
    expect(nextOpening(ist('2026-10-23T10:00:00'))).toEqual(ist('2026-10-23T10:00:00'));
    expect(nextOpening(ist('2026-10-23T06:30:00'))).toEqual(ist('2026-10-23T09:00:00'));
    expect(nextOpening(ist('2026-10-23T22:00:00'))).toEqual(ist('2026-10-24T09:00:00'));
    expect(nextOpening(ist('2026-10-24T21:30:00'))).toEqual(ist('2026-10-26T09:00:00'));
  });

  it('runs the SLA clock only in business hours', () => {
    expect(addBusinessMinutes(ist('2026-10-23T09:00:00'), 15)).toEqual(ist('2026-10-23T09:15:00'));
    expect(addBusinessMinutes(ist('2026-10-23T20:30:00'), 60)).toEqual(ist('2026-10-24T09:30:00'));
    expect(addBusinessMinutes(ist('2026-10-24T20:00:00'), 240)).toEqual(ist('2026-10-26T12:00:00'));
    expect(addBusinessMinutes(ist('2026-10-25T03:00:00'), 15)).toEqual(ist('2026-10-26T09:15:00'));
  });

  it('formats times relative to now', () => {
    const now = ist('2026-10-23T22:00:00');
    expect(formatWhen(ist('2026-10-23T22:30:00'), now)).toBe('10:30 pm');
    expect(formatWhen(ist('2026-10-24T09:15:00'), now)).toBe('9:15 am tomorrow');
    expect(formatWhen(ist('2026-10-26T09:00:00'), now)).toBe('9:00 am Monday');
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatDuration(-12 * 60_000)).toBe('12 min');
  });
});

describe('ticket rules', () => {
  const stores: DemoStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });
  const deskAt = (clock: { now: Date }) => {
    const store = new DemoStore(':memory:');
    stores.push(store);
    return new TicketDesk(
      store.keyValue('example:support-desk', () => clock.now),
      () => clock.now,
    );
  };

  it('assigns round robin within the priority team', () => {
    const clock = { now: ist('2026-10-23T10:00:00') };
    const desk = deskAt(clock);
    const create = () =>
      desk.create({
        address: '+919800000001',
        categoryId: 'not_delivered',
        orderId: null,
        description: 'x',
        attachments: [],
        conversationId: null,
      });
    expect([create(), create(), create()].map((ticket) => ticket.agent?.name)).toEqual([
      'Meera',
      'Farhan',
      'Meera',
    ]);
  });

  it('allows reopening for 7 days after resolution', () => {
    const clock = { now: ist('2026-10-23T10:00:00') };
    const desk = deskAt(clock);
    const created = desk.create({
      address: '+919800000001',
      categoryId: 'other',
      orderId: null,
      description: 'x',
      attachments: [],
      conversationId: null,
    });
    const resolved = desk.resolve(desk.respond(created));
    clock.now = ist('2026-10-30T09:59:00');
    expect(desk.canReopen(resolved)).toBe(true);
    clock.now = ist('2026-10-30T10:01:00');
    expect(desk.canReopen(resolved)).toBe(false);
    expect(desk.canReopen(created)).toBe(false);
  });

  it('normalises typed order numbers', () => {
    expect(normaliseOrderId('hh1057')).toBe('HH-1057');
    expect(normaliseOrderId('my order #HH 1042 is late')).toBe('HH-1042');
    expect(normaliseOrderId('order 1042')).toBeNull();
  });
});
