import type { ExampleContext } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';

/** Where the person is in the guided tour, so free text and stale buttons land somewhere sensible. */
export const TOUR_STEPS = [
  'intro',
  'customers',
  'connect',
  'embed',
  'webhooks',
  'try',
  'status',
  'call',
] as const;
export type TourStep = (typeof TOUR_STEPS)[number];

export const platformStateSchema = z.object({
  step: z.enum(TOUR_STEPS),
  /** Embeddable components the person opened in step 3. */
  componentsSeen: z.array(z.string()).max(10),
  /** Preferred call time, once picked. */
  callSlot: z.string().nullable(),
});

export type PlatformState = z.infer<typeof platformStateSchema>;

export const initialPlatformState = (): PlatformState => ({
  step: 'intro',
  componentsSeen: [],
  callSlot: null,
});

export type Ctx = ExampleContext<PlatformState>;
