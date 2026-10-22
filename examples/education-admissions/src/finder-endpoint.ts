import { fit } from '@lazyapp-examples/demo-kit';
import type {
  FlowExchangeContext,
  FlowExchangeRequest,
  FlowExchangeResponse,
} from '@lazyapp-examples/demo-kit';
import {
  BUDGETS,
  COUNTRIES,
  FIELDS,
  findProgram,
  IELTS_BANDS,
  LEVELS,
  PROGRAMS,
  tuitionLabel,
} from './catalog.js';
import type { Program } from './catalog.js';
import { intakeLabel, intakeOptions, intakeTitle, matchPrograms, nextIntakes } from './finder.js';
import type { Profile } from './finder.js';
import type { AdmissionsState } from './state.js';

type FlowCtx = FlowExchangeContext<AdmissionsState>;

/**
 * Data endpoint of the `finder` Flow. INIT fills the dropdowns (intakes move with the
 * calendar), `search` matches live, and `shortlist` saves the choice and closes the Flow.
 */
export async function finderEndpoint(
  ctx: FlowCtx,
  request: FlowExchangeRequest,
): Promise<FlowExchangeResponse> {
  const data = request.data ?? {};
  const trigger = request.action === 'data_exchange' ? data.trigger : null;
  if (trigger === 'search') {
    const profile = parseProfile(data);
    ctx.setState((state) => ({ ...state, profile }));
    return resultsScreen(profile, ctx.now());
  }
  if (trigger === 'shortlist') {
    const picked = (Array.isArray(data.shortlist) ? data.shortlist : [])
      .filter((id): id is string => typeof id === 'string' && findProgram(id) !== undefined)
      .slice(0, 5);
    if (picked.length === 0) {
      return resultsScreen(ctx.state.profile, ctx.now());
    }
    ctx.setState((state) => ({ ...state, shortlist: picked }));
    return {
      screen: 'SUCCESS',
      data: { extension_message_response: { params: { flow_token: request.flow_token, shortlist: picked } } },
    };
  }
  return prefsScreen(ctx.now());
}

function prefsScreen(now: Date): FlowExchangeResponse {
  return {
    screen: 'PREFS',
    data: {
      countries: [
        ...COUNTRIES.map((country) => ({ id: country.id, title: `${country.flag} ${country.title}` })),
        { id: 'any', title: '🌍 Open to any country' },
      ],
      levels: LEVELS.map((level) => ({ id: level.id, title: level.title })),
      fields: [
        ...FIELDS.map((field) => ({ id: field.id, title: field.title })),
        { id: 'any', title: 'Not sure yet' },
      ],
      intakes: intakeOptions(now),
      budgets: BUDGETS.map((budget) => ({ id: budget.id, title: budget.title })),
      ielts_bands: IELTS_BANDS.map((band) => ({ id: band.id, title: band.title })),
    },
  };
}

export function resultsScreen(profile: Profile, now: Date): FlowExchangeResponse {
  const result = matchPrograms(profile, now);
  const notes = [
    result.exact ? null : 'Nothing matched every preference, so here are the closest options.',
    result.needsEnglishTest ? 'You will need an IELTS or PTE score before the application deadline.' : null,
  ].filter((note) => note !== null);
  return {
    screen: 'RESULTS',
    data: {
      heading: result.exact
        ? `${result.programs.length} program${result.programs.length === 1 ? '' : 's'} match`
        : 'Closest matches',
      summary: profileSummary(profile),
      programs: result.programs.map((program) => programOption(program, profile, now)),
      has_note: notes.length > 0,
      note: notes.join(' '),
    },
  };
}

function programOption(
  program: Program,
  profile: Profile,
  now: Date,
): { id: string; title: string; description: string } {
  const intake = nextIntakes(program, now, profile.intake, 1)[0] ?? nextIntakes(program, now, null, 1)[0];
  return {
    id: program.id,
    title: fit(`${program.name} · ${program.shortUniversity}`, 30),
    description: fit(
      `${program.university}, ${program.city} · ${tuitionLabel(program)} · IELTS ${program.ieltsMin.toFixed(1)}${intake === undefined ? '' : ` · ${intakeLabel(intake)}`}`,
      300,
    ),
  };
}

export function profileSummary(profile: Profile): string {
  const parts = [
    LEVELS.find((level) => level.id === profile.level)?.title,
    FIELDS.find((field) => field.id === profile.field)?.title,
    profile.country === 'any'
      ? 'Any country'
      : COUNTRIES.find((country) => country.id === profile.country)?.title,
    profile.intake === null ? undefined : intakeTitle(profile.intake),
    BUDGETS.find((budget) => budget.id === profile.budget)?.title,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? `${PROGRAMS.length} partner programs` : parts.join(' · ');
}

function parseProfile(data: Readonly<Record<string, unknown>>): Profile {
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  return {
    country: pick(data.country, [...COUNTRIES.map((country) => country.id), 'any'] as const),
    level: pick(
      data.level,
      LEVELS.map((level) => level.id),
    ),
    field: pick(data.field, [...FIELDS.map((field) => field.id), 'any'] as const),
    intake:
      typeof data.intake === 'string' && /^\d{4}-(spring|summer|fall)$/.test(data.intake)
        ? data.intake
        : null,
    budget: pick(
      data.budget,
      BUDGETS.map((budget) => budget.id),
    ),
    ielts: pick(
      data.ielts,
      IELTS_BANDS.map((band) => band.id),
    ),
  };
}
