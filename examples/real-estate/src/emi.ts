import { formatInr } from '@lazyapp-examples/demo-kit';

/**
 * Home-loan maths, in paise. EMI = P·r·(1+r)^n / ((1+r)^n − 1) with r the monthly rate.
 * Banks quote "EMI per lakh", so everything rounds to the rupee the way their sheets do.
 */

export const TENURE_YEARS = [10, 15, 20, 25, 30] as const;
/** Indicative floating rates (% p.a.) at the time of writing. */
export const RATES = ['8.35', '8.50', '8.75', '9.00', '9.50'] as const;
export const DEFAULT_TENURE = 20;
export const DEFAULT_RATE = '8.50';
/** Lenders fund up to 80% of the property value for loans above ₹75 L. */
export const LOAN_TO_VALUE = 0.8;
/** Banks cap EMI at about half of take-home pay. */
export const MAX_EMI_TO_INCOME = 0.5;

const LAKH_PAISE = 1_00_000 * 100;
const CRORE_PAISE = 1_00_00_000 * 100;
export const MIN_LOAN_PAISE = 5 * LAKH_PAISE;
export const MAX_LOAN_PAISE = 20 * CRORE_PAISE;
/** Used when someone opens the calculator without picking a home. */
export const DEFAULT_LOAN_PAISE = 75 * LAKH_PAISE;

export interface EmiQuote {
  readonly principalPaise: number;
  readonly annualRatePercent: number;
  readonly tenureYears: number;
  readonly emiPaise: number;
  readonly totalInterestPaise: number;
  readonly totalPaidPaise: number;
  /** Monthly take-home pay a lender would want to see. */
  readonly incomeNeededPaise: number;
}

export function emiQuote(principalPaise: number, annualRatePercent: number, tenureYears: number): EmiQuote {
  const months = tenureYears * 12;
  const r = annualRatePercent / 12 / 100;
  const growth = (1 + r) ** months;
  const exact = r === 0 ? principalPaise / months : (principalPaise * r * growth) / (growth - 1);
  const emiPaise = Math.round(exact / 100) * 100;
  const totalPaidPaise = emiPaise * months;
  return {
    principalPaise,
    annualRatePercent,
    tenureYears,
    emiPaise,
    totalInterestPaise: totalPaidPaise - principalPaise,
    totalPaidPaise,
    incomeNeededPaise: Math.ceil(emiPaise / MAX_EMI_TO_INCOME / 100_000) * 100_000,
  };
}

/** The loan a buyer typically gets for a home of this price. */
export function typicalLoanPaise(pricePaise: number): number {
  return Math.round((pricePaise * LOAN_TO_VALUE) / LAKH_PAISE) * LAKH_PAISE;
}

/**
 * Parses what someone typed as a loan amount: `7500000`, `75,00,000`, `75 lakh`, `75L`,
 * `1.2 cr`. Returns paise, or null when it is not an amount in the supported range.
 */
export function parseLoanAmount(input: string): number | null {
  const text = input
    .toLowerCase()
    .replace(/[₹,\s]/g, '')
    .replace(/^rs\.?/, '');
  const match = /^(\d+(?:\.\d+)?)(l|lac|lakh|lakhs|cr|crore|crores)?$/.exec(text);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  const unit = match[2] ?? '';
  const scale = unit.startsWith('c') ? CRORE_PAISE : unit.startsWith('l') ? LAKH_PAISE : 100;
  const paise = Math.round(value * scale);
  return paise >= MIN_LOAN_PAISE && paise <= MAX_LOAN_PAISE ? paise : null;
}

export function isTenure(value: number): value is (typeof TENURE_YEARS)[number] {
  return (TENURE_YEARS as readonly number[]).includes(value);
}

export function isRate(value: string): value is (typeof RATES)[number] {
  return (RATES as readonly string[]).includes(value);
}

/** Chat-friendly summary of a quote. */
export function describeQuote(quote: EmiQuote): string {
  return [
    `*${formatInr(quote.emiPaise)}/month* for ${quote.tenureYears} years at ${quote.annualRatePercent}%`,
    `Loan ${formatInr(quote.principalPaise)} · interest ${formatInr(quote.totalInterestPaise)} · total ${formatInr(quote.totalPaidPaise)}`,
    `Lenders look for a take-home of about ${formatInr(quote.incomeNeededPaise)}/month.`,
  ].join('\n');
}
