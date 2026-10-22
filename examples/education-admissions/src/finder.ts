import { BUDGETS, IELTS_BANDS, PROGRAMS } from './catalog.js';
import type { BudgetId, CountryId, FieldId, IeltsId, LevelId, Program } from './catalog.js';

/**
 * Program matching and intake dates. Pure functions of the profile and the clock,
 * shared by the Flow endpoint and the list fallback so both give the same answers.
 */

export interface Profile {
  readonly country: CountryId | 'any' | null;
  readonly level: LevelId | null;
  readonly field: FieldId | 'any' | null;
  /** Intake season id, e.g. `2027-fall`. */
  readonly intake: string | null;
  readonly budget: BudgetId | null;
  readonly ielts: IeltsId | null;
}

export const EMPTY_PROFILE: Profile = {
  country: null,
  level: null,
  field: null,
  intake: null,
  budget: null,
  ielts: null,
};

const SEASONS = [
  { id: 'spring', title: 'Jan–Apr', months: [1, 2, 3, 4] },
  { id: 'summer', title: 'May–Aug', months: [5, 6, 7, 8] },
  { id: 'fall', title: 'Sep–Dec', months: [9, 10, 11, 12] },
] as const;

/** Applications need about ten weeks before classes start (offer, deposit, visa). */
const APPLICATION_LEAD_MS = 10 * 7 * 24 * 60 * 60 * 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface IntakeOption {
  readonly id: string;
  readonly title: string;
}

/** The next three intake seasons you can still apply for. */
export function intakeOptions(now: Date): IntakeOption[] {
  const earliest = new Date(now.getTime() + APPLICATION_LEAD_MS);
  let year = earliest.getUTCFullYear();
  let index = SEASONS.findIndex((season) =>
    (season.months as readonly number[]).includes(earliest.getUTCMonth() + 1),
  );
  const options: IntakeOption[] = [];
  while (options.length < 3) {
    const season = SEASONS[index];
    if (season !== undefined) {
      options.push({ id: `${year}-${season.id}`, title: `${season.title} ${year}` });
    }
    index += 1;
    if (index >= SEASONS.length) {
      index = 0;
      year += 1;
    }
  }
  return options;
}

export function intakeTitle(id: string): string {
  const [year, seasonId] = id.split('-');
  const season = SEASONS.find((entry) => entry.id === seasonId);
  return season === undefined ? id : `${season.title} ${year ?? ''}`;
}

/** A concrete start: `{ year: 2027, month: 9 }`. */
export interface Intake {
  readonly year: number;
  readonly month: number;
}

export function intakeLabel(intake: Intake): string {
  return `${MONTHS[intake.month - 1] ?? ''} ${intake.year}`;
}

export function intakeKey(intake: Intake): string {
  return `${intake.year}-${String(intake.month).padStart(2, '0')}`;
}

export function parseIntakeKey(key: string): Intake | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  return match === null ? null : { year: Number(match[1]), month: Number(match[2]) };
}

/** The program's next starts you can still make, optionally within one season. */
export function nextIntakes(program: Program, now: Date, season: string | null = null, count = 3): Intake[] {
  const earliest = now.getTime() + APPLICATION_LEAD_MS;
  const [seasonYear, seasonId] = season?.split('-') ?? [];
  const seasonMonths = SEASONS.find((entry) => entry.id === seasonId)?.months as
    readonly number[] | undefined;
  const intakes: Intake[] = [];
  for (
    let year = now.getUTCFullYear();
    year <= now.getUTCFullYear() + 2 && intakes.length < count;
    year += 1
  ) {
    for (const month of [...program.intakeMonths].sort((a, b) => a - b)) {
      const starts = Date.UTC(year, month - 1, 1);
      const inSeason =
        seasonMonths === undefined || (seasonMonths.includes(month) && String(year) === seasonYear);
      if (starts >= earliest && inSeason && intakes.length < count) {
        intakes.push({ year, month });
      }
    }
  }
  return intakes;
}

/** Application deadline: ten weeks before the intake starts. */
export function deadlineFor(intake: Intake): Date {
  return new Date(Date.UTC(intake.year, intake.month - 1, 1) - APPLICATION_LEAD_MS);
}

export function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export interface MatchResult {
  readonly programs: readonly Program[];
  /** False when nothing met every preference and these are the closest options. */
  readonly exact: boolean;
  /** The student still needs an English test score. */
  readonly needsEnglishTest: boolean;
}

export function matchPrograms(profile: Profile, now: Date, limit = 10): MatchResult {
  const budgetMax =
    BUDGETS.find((budget) => budget.id === profile.budget)?.maxLakh ?? Number.POSITIVE_INFINITY;
  const score = IELTS_BANDS.find((band) => band.id === profile.ielts)?.score ?? null;
  const checks = (program: Program) => ({
    country: profile.country === null || profile.country === 'any' || program.country === profile.country,
    field: profile.field === null || profile.field === 'any' || program.field === profile.field,
    budget: program.tuitionLakh <= budgetMax,
    english: score === null || score >= program.ieltsMin,
    intake: profile.intake === null || nextIntakes(program, now, profile.intake, 1).length > 0,
  });
  const candidates = PROGRAMS.filter((program) => profile.level === null || program.level === profile.level);
  const exact = candidates.filter((program) => Object.values(checks(program)).every(Boolean));
  const needsEnglishTest = profile.ielts === null || profile.ielts === 'none';
  if (exact.length > 0) {
    return { programs: exact.slice(0, limit), exact: true, needsEnglishTest };
  }
  const weights = { country: 4, field: 3, budget: 2, english: 1, intake: 1 } as const;
  const ranked = candidates
    .map((program) => {
      const result = checks(program);
      const total = (Object.keys(weights) as (keyof typeof weights)[]).reduce(
        (sum, key) => sum + (result[key] ? weights[key] : 0),
        0,
      );
      return { program, total };
    })
    .sort((a, b) => b.total - a.total || a.program.tuitionLakh - b.program.tuitionLakh);
  return {
    programs: ranked.slice(0, Math.min(limit, 5)).map((entry) => entry.program),
    exact: false,
    needsEnglishTest,
  };
}
