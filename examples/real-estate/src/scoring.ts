import type { RealEstateState } from './state.js';

/**
 * Lead scoring from what the buyer did, not what they said: searching is cheap, booking a
 * visit is not. The score drives the temperature tag the sales team filters on.
 */

export type Temperature = 'hot' | 'warm' | 'cold';

export interface LeadScore {
  readonly score: number;
  readonly temperature: Temperature;
  readonly signals: readonly string[];
}

export function scoreLead(state: RealEstateState): LeadScore {
  const signals: [string, number][] = [];
  const add = (label: string, points: number, when: boolean) => {
    if (when) {
      signals.push([label, points]);
    }
  };
  const booked = state.visits.filter((visit) => visit.status === 'booked');
  add('searched', 10, state.prefs !== null || state.results.length > 0);
  add(
    `shortlisted ${state.shortlist.length}`,
    Math.min(15, state.shortlist.length * 5),
    state.shortlist.length > 0,
  );
  add('downloaded a brochure', 5, state.brochures.length > 0);
  add('ran the EMI calculator', 15, state.emiQuotes > 0);
  add('asked for an advisor', 15, state.advisorRequested);
  add('booked a site visit', 30, booked.length > 0);
  add(
    'loved the visit',
    30,
    state.visits.some((visit) => visit.feedback === 'loved'),
  );
  add(
    'visit was okay',
    5,
    state.visits.some((visit) => visit.feedback === 'okay'),
  );
  add(
    'did not like the visit',
    -10,
    state.visits.some((visit) => visit.feedback === 'no'),
  );

  const score = Math.max(
    0,
    Math.min(
      100,
      signals.reduce((sum, [, points]) => sum + points, 0),
    ),
  );
  return {
    score,
    temperature: score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold',
    signals: signals.map(([label]) => label),
  };
}

export const TAG_PREFIX = 'demo-homes';

/** Tags the LazyApp contact should carry, for segments and broadcasts. */
export function tagsFor(state: RealEstateState): string[] {
  const tags = new Set<string>([TAG_PREFIX, `${TAG_PREFIX}:${scoreLead(state).temperature}`]);
  if (state.prefs !== null) {
    tags.add(`${TAG_PREFIX}:${state.prefs.purpose}`);
    tags.add(`${TAG_PREFIX}:city-${state.prefs.city}`);
  }
  if (state.visits.some((visit) => visit.status === 'booked')) {
    tags.add(`${TAG_PREFIX}:visit-booked`);
  }
  return [...tags].sort();
}

/** What to attach and detach to move the contact from `current` to `desired`. */
export function tagDiff(
  current: readonly string[],
  desired: readonly string[],
): { readonly add: string[]; readonly remove: string[] } {
  return {
    add: desired.filter((tag) => !current.includes(tag)),
    remove: current.filter((tag) => !desired.includes(tag)),
  };
}
