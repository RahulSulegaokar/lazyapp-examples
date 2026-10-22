import { DEMO_FOOTER, fit, FlowUnavailableError, RESERVED_IDS, ui } from '@lazyapp-examples/demo-kit';
import {
  BUDGETS,
  COUNTRIES,
  findCountry,
  findProgram,
  IELTS_BANDS,
  LEVELS,
  SCHOLARSHIPS,
  tuitionLabel,
} from './catalog.js';
import type { Program } from './catalog.js';
import type { Ctx } from './context.js';
import { assetUrl, tagContact } from './context.js';
import { profileSummary } from './finder-endpoint.js';
import { intakeLabel, matchPrograms, nextIntakes } from './finder.js';
import { FLOWS } from './manifest.js';
import { MENU_IDS, showMenu } from './menu.js';

export const PROGRAM_IDS = {
  brochurePrefix: 'prog:brochure:',
  applyPrefix: 'prog:apply:',
} as const;

// --- Course finder: the Flow, or the same questions as lists ----------------------------

export async function startFinder(ctx: Ctx): Promise<void> {
  if (await ctx.flows.isAvailable(FLOWS.finder)) {
    try {
      await ctx.flows.send({
        key: FLOWS.finder,
        header: 'Course finder',
        body: 'Six quick questions: country, level, field, intake, budget and IELTS. You will see matching programs instantly and can shortlist up to five.',
        cta: 'Find programs',
        footer: DEMO_FOOTER,
      });
      ctx.setState((state) => ({ ...state, step: 'results' }));
      return;
    } catch (error) {
      if (!(error instanceof FlowUnavailableError)) {
        throw error;
      }
    }
  }
  ctx.setState((state) => ({ ...state, step: 'finder-country' }));
  await ctx.send.list({
    header: 'Course finder',
    body: "(The course finder form is not published on this number, so let's do it in four taps.)\n\nWhere would you like to study?",
    button: 'Choose country',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Countries',
        rows: [
          ...COUNTRIES.map((country) => ({
            id: `finder:country:${country.id}`,
            title: `${country.flag} ${country.title}`,
          })),
          { id: 'finder:country:any', title: '🌍 Open to any country' },
        ],
      },
    ],
  });
}

export async function onFinderStep(ctx: Ctx, field: string, value: string): Promise<void> {
  switch (field) {
    case 'country': {
      const country = value === 'any' ? 'any' : findCountry(value)?.id;
      if (country === undefined) {
        return startFinder(ctx);
      }
      ctx.setState((state) => ({ ...state, step: 'finder-level', profile: { ...state.profile, country } }));
      await ctx.send.buttons({
        body: 'Which level?',
        footer: DEMO_FOOTER,
        buttons: LEVELS.map((level) => ({ id: `finder:level:${level.id}`, title: level.title })),
      });
      return;
    }
    case 'level': {
      const level = LEVELS.find((entry) => entry.id === value)?.id;
      if (level === undefined) {
        return startFinder(ctx);
      }
      ctx.setState((state) => ({ ...state, step: 'finder-budget', profile: { ...state.profile, level } }));
      await ctx.send.list({
        body: 'What tuition budget per year are you planning for? (Living costs are extra.)',
        button: 'Choose budget',
        footer: DEMO_FOOTER,
        sections: [
          {
            title: 'Tuition per year',
            rows: BUDGETS.map((budget) => ({ id: `finder:budget:${budget.id}`, title: budget.title })),
          },
        ],
      });
      return;
    }
    case 'budget': {
      const budget = BUDGETS.find((entry) => entry.id === value)?.id;
      if (budget === undefined) {
        return startFinder(ctx);
      }
      ctx.setState((state) => ({ ...state, step: 'finder-ielts', profile: { ...state.profile, budget } }));
      await ctx.send.list({
        body: 'Your IELTS overall band (or PTE equivalent)?',
        button: 'Choose band',
        footer: DEMO_FOOTER,
        sections: [
          {
            title: 'IELTS',
            rows: IELTS_BANDS.map((band) => ({ id: `finder:ielts:${band.id}`, title: band.title })),
          },
        ],
      });
      return;
    }
    case 'ielts': {
      const ielts = IELTS_BANDS.find((entry) => entry.id === value)?.id;
      if (ielts === undefined) {
        return startFinder(ctx);
      }
      ctx.setState((state) => ({
        ...state,
        profile: { ...state.profile, ielts, field: state.profile.field ?? 'any' },
      }));
      const result = matchPrograms(ctx.state.profile, ctx.now());
      const shortlist = result.programs.slice(0, 5).map((program) => program.id);
      ctx.setState((state) => ({ ...state, shortlist }));
      return showPrograms(
        ctx,
        `${result.exact ? 'Programs that fit' : 'Nothing matched everything, so here are the closest'}: ${profileSummary(ctx.state.profile)}.${result.needsEnglishTest ? ' You will need an IELTS/PTE score before the deadline.' : ''}`,
      );
    }
    default:
      return startFinder(ctx);
  }
}

/** The finder Flow closed; its endpoint already saved the profile and the shortlist. */
export async function onFinderCompleted(ctx: Ctx): Promise<void> {
  return showPrograms(ctx, `Your shortlist: ${profileSummary(ctx.state.profile)}.`);
}

// --- Showing programs ------------------------------------------------------------------

export async function showPrograms(ctx: Ctx, intro: string): Promise<void> {
  const programs = ctx.state.shortlist.map(findProgram).filter((program) => program !== undefined);
  ctx.setState((state) => ({ ...state, step: 'results' }));
  const [first] = programs;
  if (first === undefined) {
    await ctx.send.buttons({
      body: 'Your shortlist is empty. The course finder takes a minute.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.finder, title: 'Find a program' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  await tagLead(ctx, programs);
  if (programs.length === 1) {
    await ctx.send.buttons({
      header: { image: first.image },
      body: `${intro}\n\n${programCard(ctx, first, 1024)}`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: `${PROGRAM_IDS.brochurePrefix}${first.id}`, title: 'Brochure' },
        { id: `${PROGRAM_IDS.applyPrefix}${first.id}`, title: 'Apply' },
        { id: MENU_IDS.counselling, title: 'Talk to counsellor' },
      ],
    });
    return;
  }
  await ctx.send.interactive(
    ui.mediaCarousel(
      `${intro} Swipe to compare, tap Brochure for the PDF or Apply to start.`,
      programs.map((program) => ({
        image: program.image,
        body: programCard(ctx, program, 160),
        quickReplies: [
          { id: `${PROGRAM_IDS.brochurePrefix}${program.id}`, title: 'Brochure' },
          { id: `${PROGRAM_IDS.applyPrefix}${program.id}`, title: 'Apply' },
        ],
      })),
    ),
  );
}

function programCard(ctx: Ctx, program: Program, max: number): string {
  const intake =
    nextIntakes(program, ctx.now(), ctx.state.profile.intake, 1)[0] ??
    nextIntakes(program, ctx.now(), null, 1)[0];
  return fit(
    `*${program.name}*\n${program.university}, ${findCountry(program.country)?.flag ?? ''} ${program.city}\n${tuitionLabel(program)} · IELTS ${program.ieltsMin.toFixed(1)}${intake === undefined ? '' : ` · ${intakeLabel(intake)}`}`,
    max,
  );
}

/** Lead tags drive segments: "UK, Sep 2027 intake" is a broadcast audience. */
async function tagLead(ctx: Ctx, programs: readonly Program[]): Promise<void> {
  const countries = [...new Set(programs.map((program) => program.country))];
  await tagContact(ctx, ['admissions:lead', ...countries.map((country) => `admissions:country-${country}`)]);
}

export async function showShortlist(ctx: Ctx): Promise<void> {
  return showPrograms(ctx, 'Your shortlist.');
}

export async function onBrochure(ctx: Ctx, programId: string): Promise<void> {
  const program = findProgram(programId);
  const country = program === undefined ? undefined : findCountry(program.country);
  if (program === undefined || country === undefined) {
    return showShortlist(ctx);
  }
  const intakes = nextIntakes(program, ctx.now()).map(intakeLabel).join(', ');
  await ctx.send.document(
    assetUrl(ctx, country.brochure),
    `BrightPath-Study-in-${country.title.replace(/\s+/g, '-')}-2027.pdf`,
    `${program.name}, ${program.university}\n${program.duration} · ${tuitionLabel(program)} (indicative) · IELTS ${program.ieltsMin.toFixed(1)}\nNext intakes: ${intakes}\n🎓 ${program.scholarship}`,
  );
  await ctx.send.buttons({
    body: `Like ${program.shortUniversity}? Apply now (₹2,500 application fee) or talk it through with a counsellor first.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: `${PROGRAM_IDS.applyPrefix}${program.id}`, title: 'Apply' },
      { id: MENU_IDS.counselling, title: 'Free counselling' },
      { id: MENU_IDS.scholarships, title: 'Scholarships' },
    ],
  });
}

// --- Scholarships -----------------------------------------------------------------------

export async function showScholarships(ctx: Ctx): Promise<void> {
  const countries = new Set(
    ctx.state.shortlist.map((id) => findProgram(id)?.country).filter((id) => id !== undefined),
  );
  const relevant =
    countries.size === 0
      ? SCHOLARSHIPS
      : SCHOLARSHIPS.filter((entry) => entry.countries.some((id) => countries.has(id)));
  const list = relevant.length === 0 ? SCHOLARSHIPS : relevant;
  await ctx.send.list({
    header: 'Scholarships',
    body:
      countries.size === 0
        ? 'Major scholarships for Indian students. Shortlist programs first and I will show only the ones that apply to you.'
        : 'Scholarships for the countries on your shortlist:',
    button: 'See scholarships',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Scholarships',
        rows: list.map((entry) => ({
          id: `sch:${entry.id}`,
          title: entry.title,
          description: entry.summary,
        })),
      },
    ],
  });
}

export async function onScholarship(ctx: Ctx, id: string): Promise<void> {
  const scholarship = SCHOLARSHIPS.find((entry) => entry.id === id);
  if (scholarship === undefined) {
    return showScholarships(ctx);
  }
  if (scholarship.url === null) {
    await ctx.send.buttons({
      header: scholarship.title,
      body: scholarship.detail,
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.counselling, title: 'Free counselling' },
        { id: MENU_IDS.scholarships, title: 'More scholarships' },
      ],
    });
    return;
  }
  await ctx.send.cta({
    header: scholarship.title,
    body: `${scholarship.detail}\n\nYour counsellor helps with the essays and references. Type MENU for more.`,
    displayText: 'Official page',
    url: scholarship.url,
    footer: DEMO_FOOTER,
  });
}

export async function backToMenu(ctx: Ctx): Promise<void> {
  return showMenu(ctx, 'What next?');
}
