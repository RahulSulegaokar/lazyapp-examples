import { DEMO_FOOTER, FlowUnavailableError, formatInr } from '@lazyapp-examples/demo-kit';
import { syncLeadTags } from './crm.js';
import {
  DEFAULT_LOAN_PAISE,
  DEFAULT_RATE,
  describeQuote,
  emiQuote,
  isRate,
  isTenure,
  parseLoanAmount,
  typicalLoanPaise,
} from './emi.js';
import { MENU_IDS, VISIT_IDS } from './ids.js';
import { getListing } from './listings.js';
import { FLOWS } from './manifest.js';
import type { Ctx } from './types.js';

/** The loan to start from: 80% of the home in focus, or a typical ₹75 L. */
export function defaultLoan(focus: string | null): number {
  const listing = focus === null ? undefined : getListing(focus);
  return listing?.purpose === 'buy' ? typicalLoanPaise(listing.pricePaise) : DEFAULT_LOAN_PAISE;
}

/** Opens the EMI Flow (the endpoint does the maths), or answers in the chat. */
export async function startEmi(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'emi' }));
  const listing = ctx.state.focus === null ? undefined : getListing(ctx.state.focus);
  try {
    await ctx.flows.send({
      key: FLOWS.emi,
      header: 'EMI calculator',
      body:
        listing?.purpose === 'buy'
          ? `Work out the EMI for *${listing.name}*. Change the loan, tenure and rate to compare.`
          : 'Work out your home-loan EMI. Change the loan, tenure and rate to compare.',
      cta: 'Calculate EMI',
      footer: DEMO_FOOTER,
    });
  } catch (error) {
    if (!(error instanceof FlowUnavailableError)) {
      throw error;
    }
    await quoteInChat(
      ctx,
      defaultLoan(ctx.state.focus),
      '(The calculator form is not available right now, so here are the numbers in the chat.)\n\n',
    );
  }
}

/** EMI at three tenures for one loan; typing another amount ("60 lakh") recalculates. */
export async function quoteInChat(ctx: Ctx, loanPaise: number, prefix = ''): Promise<void> {
  const rate = Number(DEFAULT_RATE);
  const lines = [15, 20, 25].map((years) => {
    const quote = emiQuote(loanPaise, rate, years);
    return `• ${years} years: *${formatInr(quote.emiPaise)}/month*`;
  });
  ctx.setState((state) => ({ ...state, step: 'emi', emiQuotes: state.emiQuotes + 1 }));
  await ctx.send.buttons({
    body:
      `${prefix}EMI on a loan of *${formatInr(loanPaise)}* at ${rate}% p.a.:\n${lines.join('\n')}\n\n` +
      'Type another loan amount (for example *60 lakh* or *1.2 cr*) to recalculate.',
    footer: DEMO_FOOTER,
    buttons: emiNextSteps(ctx),
  });
  await syncLeadTags(ctx);
}

/** The Flow's RESULT screen closed: echo the numbers into the chat (recomputed, never trusted). */
export async function onEmiCompleted(ctx: Ctx, response: Readonly<Record<string, unknown>>): Promise<void> {
  const loan = typeof response.loan_amount === 'string' ? parseLoanAmount(response.loan_amount) : null;
  const tenure = Number(response.tenure);
  const rate = typeof response.rate === 'string' ? response.rate : '';
  if (loan === null || !isTenure(tenure) || !isRate(rate)) {
    await quoteInChat(ctx, defaultLoan(ctx.state.focus));
    return;
  }
  const quote = emiQuote(loan, Number(rate), tenure);
  ctx.setState((state) => ({ ...state, step: 'emi', emiQuotes: state.emiQuotes + 1 }));
  await ctx.send.buttons({
    body: `Here is your EMI, saved in this chat:\n\n${describeQuote(quote)}`,
    footer: DEMO_FOOTER,
    buttons: emiNextSteps(ctx),
  });
  await syncLeadTags(ctx);
}

function emiNextSteps(ctx: Ctx): { id: string; title: string }[] {
  const focus = ctx.state.focus === null ? undefined : getListing(ctx.state.focus);
  return [
    ...(focus === undefined ? [] : [{ id: `${VISIT_IDS.book}${focus.id}`, title: 'Book a site visit' }]),
    { id: MENU_IDS.advisor, title: 'Talk to an advisor' },
    { id: MENU_IDS.search, title: 'Find a home' },
  ];
}
