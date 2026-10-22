import { NEEDS, PLANS, titleOf } from './product.js';
import type { Budget, Plan, Role, Size, Timeline } from './product.js';
import type { Answers, LeadScore, LeadState } from './state.js';

/**
 * BANT-style fit score out of 100: budget (30), timeline (30), company size (20),
 * need fit (12) and whether we are talking to a decision maker (8). Each point comes with
 * a reason, so sales sees why a lead is hot, not just that it is.
 */

const BUDGET_POINTS: Readonly<Record<Budget, number>> = {
  lt1k: 5,
  '1k-3k': 15,
  '3k-10k': 25,
  '10k+': 30,
  unsure: 8,
};
const TIMELINE_POINTS: Readonly<Record<Timeline, number>> = { now: 30, '1-3m': 20, '3-6m': 10, exploring: 0 };
const SIZE_POINTS: Readonly<Record<Size, number>> = { '1-10': 5, '11-50': 15, '51-200': 20, '201+': 20 };
const ROLE_POINTS: Readonly<Record<Role, number>> = { owner: 8, finance: 8, ops: 4, other: 0 };

export const HOT = 70;
export const WARM = 45;

export function scoreLead(answers: Answers): LeadScore {
  const parts: [string, number][] = [];
  if (answers.budget !== null) {
    parts.push([`budget ${answers.budget}`, BUDGET_POINTS[answers.budget]]);
  }
  if (answers.timeline !== null) {
    parts.push([`timeline ${answers.timeline}`, TIMELINE_POINTS[answers.timeline]]);
  }
  if (answers.size !== null) {
    parts.push([`team ${answers.size}`, SIZE_POINTS[answers.size]]);
  }
  if (answers.needs.length > 0) {
    parts.push([`${answers.needs.length} needs`, Math.min(12, answers.needs.length * 4)]);
  }
  if (answers.role !== null) {
    parts.push([`role ${answers.role}`, ROLE_POINTS[answers.role]]);
  }
  const value = Math.min(
    100,
    parts.reduce((sum, [, points]) => sum + points, 0),
  );
  return {
    value,
    grade: value >= HOT ? 'hot' : value >= WARM ? 'warm' : 'cold',
    reasons: parts.filter(([, points]) => points > 0).map(([label, points]) => `${label} (+${points})`),
  };
}

/** The plan to pitch: Enterprise for big or multi-GSTIN teams, Starter for small single-GSTIN ones. */
export function recommendedPlan(answers: Answers): Plan {
  const id =
    answers.needs.includes('multi-gstin') || answers.size === '51-200' || answers.size === '201+'
      ? 'enterprise'
      : answers.size === '1-10' && answers.needs.every((need) => need === 'gst-billing' || need === 'eway')
        ? 'starter'
        : 'growth';
  const plan = PLANS.find((entry) => entry.id === id);
  if (plan === undefined) {
    throw new Error(`Unknown plan ${id}`);
  }
  return plan;
}

/** Enterprise deals go to the enterprise AE. */
export function repFor(answers: Answers): string {
  return recommendedPlan(answers).id === 'enterprise' ? 'vikram' : 'ananya';
}

export const TAG_PREFIX = 'demo-leads';

/** Segmentation tags: grade, size, needs, source and lifecycle. */
export function tagsFor(state: LeadState): string[] {
  const tags = new Set<string>([TAG_PREFIX, `${TAG_PREFIX}:src-${state.attribution.channel}`]);
  if (state.score !== null) {
    tags.add(`${TAG_PREFIX}:${state.score.grade}`);
  }
  if (state.answers.size !== null) {
    tags.add(`${TAG_PREFIX}:size-${state.answers.size.replace('+', 'plus')}`);
  }
  for (const need of state.answers.needs) {
    tags.add(`${TAG_PREFIX}:need-${need}`);
  }
  if (state.meeting?.status === 'booked') {
    tags.add(`${TAG_PREFIX}:meeting-booked`);
  }
  if (state.nurture === 'subscribed') {
    tags.add(`${TAG_PREFIX}:nurture`);
  }
  return [...tags].sort();
}

export function tagDiff(
  current: readonly string[],
  desired: readonly string[],
): { readonly add: string[]; readonly remove: string[] } {
  return {
    add: desired.filter((tag) => !current.includes(tag)),
    remove: current.filter((tag) => !desired.includes(tag)),
  };
}

/** "GST invoicing, E-way bills". */
export function needsLine(answers: Answers): string {
  return answers.needs.map((need) => titleOf(NEEDS, need)).join(', ');
}
