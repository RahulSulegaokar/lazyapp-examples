import { createHash } from 'node:crypto';
import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import { agentFor, getListing } from './listings.js';
import { isBookable, releaseSlot, reserveSlot } from './schedule.js';
import type { RealEstateState, Visit } from './state.js';

/**
 * Visit bookings as pure functions over state and the slot ledger, so the Flow endpoint
 * and the button fallback book the same way and tests need no messaging at all.
 */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** `V-7KQ2M9`: short, unambiguous (no 0/O/1/I), deterministic for a seed (a flow token). */
export function visitIdFrom(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  const chars = Array.from(digest.subarray(0, 6), (byte) => ALPHABET[byte % ALPHABET.length] ?? 'X');
  return `V-${chars.join('')}`;
}

export interface VisitRequest {
  readonly visitId: string;
  readonly listingId: string;
  readonly dayId: string;
  readonly time: string;
  readonly name: string;
  readonly party: Visit['party'];
  /** Id of the booked visit this one moves, if it is a reschedule. */
  readonly rescheduleOf: string | null;
}

export type PlaceVisitResult =
  | { readonly ok: true; readonly visit: Visit; readonly state: RealEstateState }
  | { readonly ok: false; readonly reason: 'invalid' | 'taken' };

/**
 * Reserves the slot and records the visit. Idempotent per `visitId`: replaying the same
 * request (a retried data_exchange) returns the same visit without taking a second place.
 */
export function placeVisit(
  kv: KeyValueStore,
  state: RealEstateState,
  request: VisitRequest,
  now: Date,
): PlaceVisitResult {
  const listing = getListing(request.listingId);
  const previous =
    request.rescheduleOf === null
      ? undefined
      : state.visits.find((visit) => visit.id === request.rescheduleOf && visit.status === 'booked');
  if (listing === undefined || !isBookable(request.dayId, request.time, now)) {
    return { ok: false, reason: 'invalid' };
  }
  if (request.rescheduleOf !== null && previous === undefined) {
    return { ok: false, reason: 'invalid' };
  }
  const id = previous?.id ?? request.visitId;
  const at = new Date(`${request.dayId}T${request.time}:00+05:30`);
  if (previous?.at === at.toISOString()) {
    return { ok: true, visit: previous, state };
  }
  if (!reserveSlot(kv, listing.id, at, id)) {
    return { ok: false, reason: 'taken' };
  }
  if (previous !== undefined) {
    releaseSlot(kv, previous.listingId, new Date(previous.at), previous.id);
  }
  const existing = state.visits.find((visit) => visit.id === id);
  const visit: Visit = {
    id,
    listingId: listing.id,
    at: at.toISOString(),
    status: 'booked',
    name: request.name,
    party: request.party,
    agentId: agentFor(listing.city).id,
    confirmed: existing?.confirmed === true && existing.at === at.toISOString(),
    confirmationUuid: null,
    feedback: null,
  };
  kv.set(`visit:${id}`, {
    listingId: listing.id,
    at: visit.at,
    party: visit.party,
    bookedAt: now.toISOString(),
  });
  return {
    ok: true,
    visit,
    state: { ...state, visits: [...state.visits.filter((entry) => entry.id !== id), visit] },
  };
}

/** Frees the slot and marks the visit cancelled. No-op for unknown or already-cancelled visits. */
export function cancelVisit(kv: KeyValueStore, state: RealEstateState, visitId: string): RealEstateState {
  const visit = state.visits.find((entry) => entry.id === visitId && entry.status === 'booked');
  if (visit === undefined) {
    return state;
  }
  releaseSlot(kv, visit.listingId, new Date(visit.at), visit.id);
  kv.delete(`visit:${visit.id}`);
  return {
    ...state,
    visits: state.visits.map((entry) => (entry.id === visitId ? { ...entry, status: 'cancelled' } : entry)),
  };
}

export function findVisit(state: RealEstateState, visitId: string): Visit | undefined {
  return state.visits.find((visit) => visit.id === visitId);
}

export function updateVisit(state: RealEstateState, visitId: string, patch: Partial<Visit>): RealEstateState {
  return {
    ...state,
    visits: state.visits.map((visit) => (visit.id === visitId ? { ...visit, ...patch } : visit)),
  };
}

export interface FollowUpPlan {
  /** Null when the visit is too soon for a reminder to help. */
  readonly reminderAt: Date | null;
  readonly feedbackAt: Date;
}

const MINUTE = 60_000;

/**
 * When the reminder and the feedback request go out. Production follows the visit; the
 * demo compresses the journey into minutes (follow-ups end with the 24-hour session).
 */
export function followUpPlan(visitAt: Date, now: Date, mode: 'demo' | 'production'): FollowUpPlan {
  if (mode === 'demo') {
    return {
      reminderAt: new Date(now.getTime() + 2 * MINUTE),
      feedbackAt: new Date(now.getTime() + 7 * MINUTE),
    };
  }
  const reminderAt = new Date(visitAt.getTime() - 180 * MINUTE);
  return {
    reminderAt: reminderAt.getTime() - now.getTime() >= 15 * MINUTE ? reminderAt : null,
    feedbackAt: new Date(visitAt.getTime() + 120 * MINUTE),
  };
}
