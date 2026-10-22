import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPdf } from '@lazyapp-examples/demo-kit';
import type { PdfDocument } from '@lazyapp-examples/demo-kit';
import { emiQuote, typicalLoanPaise } from './emi.js';
import { agentFor, CITY_NAMES, formatPrice, LISTINGS } from './listings.js';
import type { Listing } from './listings.js';
import { formatInr } from '@lazyapp-examples/demo-kit';

/**
 * Builds the brochure PDFs WhatsApp downloads (`public/<listing>.pdf`, served by the demo
 * server at `/public/real-estate/<file>`). Run after changing listings:
 *
 *   npm run assets -w @lazyapp-examples/example-real-estate
 */
export function brochure(listing: Listing): PdfDocument {
  const agent = agentFor(listing.city);
  const loan = typicalLoanPaise(listing.pricePaise);
  return {
    title: listing.name,
    subtitle: `${listing.bhk} BHK homes in ${listing.locality}, ${CITY_NAMES[listing.city]} · Brickfield Homes`,
    footer: 'Brickfield Homes is a fictional developer in the LazyApp WhatsApp demo. Not an offer to sell.',
    blocks: [
      { kind: 'heading', text: 'At a glance' },
      {
        kind: 'table',
        rows: [
          ['Configuration', `${listing.bhk} BHK`],
          ['Carpet area', `${listing.areaSqft.toLocaleString('en-IN')} sq ft`],
          [listing.purpose === 'buy' ? 'Price' : 'Rent', formatPrice(listing)],
          ['Possession', listing.possession],
          ['Address', listing.address],
        ],
      },
      { kind: 'heading', text: 'Why buyers shortlist it' },
      { kind: 'bullets', items: listing.highlights },
      ...(listing.purpose === 'buy'
        ? ([
            { kind: 'heading', text: 'Finance' },
            {
              kind: 'paragraph',
              text:
                `A typical home loan of ${formatInr(loan)} (80% of the price) works out to about ` +
                `${formatInr(emiQuote(loan, 8.5, 20).emiPaise)} a month over 20 years at 8.5%. ` +
                'Use the EMI calculator in the chat to try your own numbers.',
            },
          ] as const)
        : []),
      { kind: 'heading', text: 'Visit the sales gallery' },
      {
        kind: 'paragraph',
        text:
          `Open every day, 10 AM to 7 PM. Book a slot in the WhatsApp chat and ${agent.name}, ` +
          `your relationship manager for ${CITY_NAMES[listing.city]}, will meet you there.`,
      },
      {
        kind: 'note',
        text: 'Specifications, prices and availability are illustrative and change without notice.',
      },
    ],
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = fileURLToPath(new URL('../public/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  for (const listing of LISTINGS) {
    writeFileSync(`${dir}${listing.brochure}`, renderPdf(brochure(listing)));
  }
  process.stdout.write(`Wrote ${LISTINGS.length} brochures to ${dir}\n`);
}
