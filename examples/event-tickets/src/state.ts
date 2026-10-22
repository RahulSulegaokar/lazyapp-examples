import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';

export const ticketsStateSchema = z.object({
  step: z.enum(['browse', 'quantity', 'details', 'payment', 'ticketed']),
  /** The event and tier being booked. Bookings themselves live in `kv` (the box office). */
  selection: z.object({ eventId: z.string(), tierId: z.string() }).nullable(),
  /** The booking in progress or just issued. */
  bookingId: z.string().nullable(),
  /** Bookings whose reminders are scheduled, so "Remind me" is not offered twice. */
  reminded: z.array(z.string()).max(20),
});

export type TicketsState = z.infer<typeof ticketsStateSchema>;
export type Ctx = ExampleContext<TicketsState>;

export const initialTicketsState = (): TicketsState => ({
  step: 'browse',
  selection: null,
  bookingId: null,
  reminded: [],
});
