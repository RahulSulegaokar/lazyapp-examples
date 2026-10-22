import { DEMO_FOOTER, FlowUnavailableError } from '@lazyapp-examples/demo-kit';
import { pushCrmEvent, syncLeadTags } from './crm.js';
import { LEAD_IDS, QUALIFY_PREFIX } from './ids.js';
import { FLOWS } from './manifest.js';
import { startMeeting } from './meeting.js';
import { BUDGETS, NEEDS, SIZES, TIMELINES } from './product.js';
import type { Option } from './product.js';
import { needsLine, recommendedPlan, scoreLead } from './scoring.js';
import { answersSchema } from './state.js';
import type { Answers } from './state.js';
import type { Ctx, Deps } from './types.js';

/** "Book a demo" before we know the lead: the qualification Flow, or four quick lists. */
export async function startQualify(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'qualify' }));
  try {
    await ctx.flows.send({
      key: FLOWS.qualify,
      header: 'Book your Ledgerly demo',
      body: 'Six quick questions so the demo is about your business, not a generic tour. Takes 30 seconds.',
      cta: 'Start',
      footer: DEMO_FOOTER,
      screen: 'NEEDS',
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await ask(
      ctx,
      '(The form is not available right now, so four quick taps instead.)\n\nWhat do you need most?',
      'Pick one',
      QUALIFY_PREFIX.need,
      NEEDS,
    );
  }
}

async function ask(
  ctx: Ctx,
  body: string,
  button: string,
  prefix: string,
  options: readonly Option[],
): Promise<void> {
  await ctx.send.list({
    body,
    button,
    footer: DEMO_FOOTER,
    sections: [
      {
        rows: options.map((option) => ({
          id: `${prefix}${option.id}`,
          title: option.title,
          ...(option.description === undefined ? {} : { description: option.description }),
        })),
      },
    ],
  });
}

/**
 * One answer from the list fallback. Each answer is stored as it comes, so a lead who stops
 * half way still leaves a partial profile for sales.
 */
export async function onFallbackAnswer(ctx: Ctx, deps: Deps, id: string): Promise<void> {
  const answers = ctx.state.answers;
  const value = id.slice(id.lastIndexOf(':') + 1);
  if (id.startsWith(QUALIFY_PREFIX.need)) {
    if (!setAnswers(ctx, { ...answers, needs: [value] })) {
      return startQualify(ctx);
    }
    return ask(ctx, 'How big is your team?', 'Team size', QUALIFY_PREFIX.size, SIZES);
  }
  if (id.startsWith(QUALIFY_PREFIX.size)) {
    if (!setAnswers(ctx, { ...answers, size: value })) {
      return startQualify(ctx);
    }
    return ask(
      ctx,
      'What monthly budget do you have for billing software?',
      'Budget',
      QUALIFY_PREFIX.budget,
      BUDGETS,
    );
  }
  if (id.startsWith(QUALIFY_PREFIX.budget)) {
    if (!setAnswers(ctx, { ...answers, budget: value })) {
      return startQualify(ctx);
    }
    return ask(ctx, 'When do you want to switch?', 'Timeline', QUALIFY_PREFIX.timeline, TIMELINES);
  }
  if (!setAnswers(ctx, { ...answers, timeline: value })) {
    return startQualify(ctx);
  }
  await qualified(ctx, deps);
}

function setAnswers(ctx: Ctx, candidate: Record<string, unknown>): boolean {
  const parsed = answersSchema.safeParse(candidate);
  if (parsed.success) {
    ctx.setState((state) => ({ ...state, answers: parsed.data }));
  }
  return parsed.success;
}

/** The Flow's `complete` payload, re-validated: option ids, optional text, a plausible email. */
export function answersFromFlow(response: Readonly<Record<string, unknown>>): Answers | null {
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
  const email = text(response.email, 120);
  const parsed = answersSchema.safeParse({
    needs: Array.isArray(response.needs) ? response.needs : [],
    size: response.size,
    role: response.role,
    budget: response.budget,
    timeline: response.timeline,
    company: text(response.company, 80),
    email: email !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
  });
  return parsed.success && parsed.data.needs.length > 0 ? parsed.data : null;
}

export async function onQualifyCompleted(
  ctx: Ctx,
  deps: Deps,
  response: Readonly<Record<string, unknown>>,
): Promise<void> {
  const answers = answersFromFlow(response);
  if (answers === null) {
    await ctx.send.text('Some answers were missing, so let us try that again.');
    return startQualify(ctx);
  }
  ctx.setState((state) => ({ ...state, answers }));
  await qualified(ctx, deps);
}

/**
 * Scores the lead, tags it, tells the CRM (and sales, if hot), then routes: hot leads go
 * straight to the calendar, warm ones are offered a demo, cold ones get the guide first.
 */
async function qualified(ctx: Ctx, deps: Deps): Promise<void> {
  const score = scoreLead(ctx.state.answers);
  const plan = recommendedPlan(ctx.state.answers);
  ctx.setState((state) => ({ ...state, step: 'qualified', score }));
  await pushCrmEvent(ctx, deps, 'lead.qualified');
  const alert = score.grade === 'hot' ? await pushCrmEvent(ctx, deps, 'lead.hot') : null;
  await syncLeadTags(ctx);

  const behindTheScenes =
    `_Behind the scenes: scored ${score.value}/100 (${score.grade}), tagged for segments` +
    (alert === null
      ? ''
      : alert.status === 'delivered'
        ? ', sales alerted in the CRM'
        : ', lead saved for sales') +
    '._';
  const fit = `*${plan.name}* (${plan.price}) fits what you need: ${needsLine(ctx.state.answers)}.`;

  if (score.grade === 'hot') {
    await ctx.send.text(`You are exactly who we built Ledgerly for. ${fit}\n\n${behindTheScenes}`);
    await startMeeting(ctx, deps);
    return;
  }
  await ctx.send.buttons({
    body:
      score.grade === 'warm'
        ? `Thanks! ${fit} A 30-minute demo is the fastest way to see it with your own invoices.\n\n${behindTheScenes}`
        : `Thanks! ${fit} If you are still exploring, our GST guide is a good place to start; book a demo whenever you are ready.\n\n${behindTheScenes}`,
    footer: DEMO_FOOTER,
    buttons:
      score.grade === 'warm'
        ? [
            { id: LEAD_IDS.book, title: 'Book a demo' },
            { id: LEAD_IDS.guide, title: 'Free GST guide' },
            { id: LEAD_IDS.pricing, title: 'See pricing' },
          ]
        : [
            { id: LEAD_IDS.guide, title: 'Free GST guide' },
            { id: LEAD_IDS.book, title: 'Book a demo anyway' },
            { id: LEAD_IDS.pricing, title: 'See pricing' },
          ],
  });
}
