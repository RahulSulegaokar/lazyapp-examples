import { z } from 'zod';
import { CITIES } from './listings.js';

/**
 * Per-buyer state. Ids, not copies of listings: the listing service stays the source of
 * truth, and a deploy that changes inventory never leaves stale prices in a session.
 */

const purpose = z.enum(['buy', 'rent']);

export const preferencesSchema = z.object({
  purpose,
  city: z.enum(CITIES),
  locality: z.string().nullable(),
  budget: z.string().nullable(),
  bhk: z.array(z.number().int().min(1).max(4)),
});

export const visitSchema = z.object({
  /** `V-7KQ2M9`: what the buyer and the agent quote to each other. */
  id: z.string(),
  listingId: z.string(),
  /** ISO instant. */
  at: z.string(),
  status: z.enum(['booked', 'cancelled']),
  name: z.string(),
  party: z.enum(['solo', 'family']),
  agentId: z.string(),
  /** Set once the confirmation, agent card and reminders went out. */
  confirmed: z.boolean(),
  /** LazyApp uuid of the confirmation template, to fall back if Meta rejects it. */
  confirmationUuid: z.string().nullable(),
  feedback: z.enum(['loved', 'okay', 'no']).nullable(),
});

export const realEstateStateSchema = z.object({
  step: z.enum(['menu', 'search', 'results', 'listing', 'emi', 'visit', 'feedback']),
  /** Answers collected by the button fallback while the search flow is unavailable. */
  draft: z.object({ purpose: purpose.nullable(), city: z.enum(CITIES).nullable() }),
  prefs: preferencesSchema.nullable(),
  /** Listing ids from the last search or "near me", in display order. */
  results: z.array(z.string()),
  /** The listing being looked at: what "Book a visit" and "EMI" apply to. */
  focus: z.string().nullable(),
  shortlist: z.array(z.string()).max(10),
  brochures: z.array(z.string()),
  emiQuotes: z.number().int().nonnegative(),
  advisorRequested: z.boolean(),
  /** What the open visit flow is for: a new booking or moving an existing one. */
  pendingVisit: z.object({ listingId: z.string(), rescheduleOf: z.string().nullable() }).nullable(),
  visits: z.array(visitSchema),
  /** Tags already on the LazyApp contact, so only the difference is sent. */
  tags: z.array(z.string()),
});

export type RealEstateState = z.infer<typeof realEstateStateSchema>;
export type Visit = z.infer<typeof visitSchema>;
export type FeedbackRating = NonNullable<Visit['feedback']>;

export const initialRealEstateState = (): RealEstateState => ({
  step: 'menu',
  draft: { purpose: null, city: null },
  prefs: null,
  results: [],
  focus: null,
  shortlist: [],
  brochures: [],
  emiQuotes: 0,
  advisorRequested: false,
  pendingVisit: null,
  visits: [],
  tags: [],
});
