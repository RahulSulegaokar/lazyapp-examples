import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPdf } from '@lazyapp-examples/demo-kit';
import type { PdfDocument } from '@lazyapp-examples/demo-kit';
import { GUIDE_FILE, PLANS } from './product.js';

/**
 * The lead magnet: a short GST invoicing guide, rendered to `public/` and served by the demo
 * server at `/public/lead-generation/<file>`. Regenerate after editing:
 *
 *   npm run assets -w @lazyapp-examples/example-lead-generation
 */
export const GUIDE: PdfDocument = {
  title: 'The GST invoicing checklist',
  subtitle: 'A 5-minute guide for Indian small businesses · Ledgerly',
  accent: [0.16, 0.27, 0.62],
  footer:
    'Ledgerly is a fictional product in the LazyApp WhatsApp demo. General information, not tax advice.',
  blocks: [
    { kind: 'heading', text: '1. Get every invoice right' },
    {
      kind: 'bullets',
      items: [
        'Supplier and buyer GSTIN, a unique serial number per financial year, and the place of supply.',
        'HSN or SAC codes on every line, with the right digits for your turnover.',
        'CGST and SGST for sales within your state, IGST across states.',
      ],
    },
    { kind: 'heading', text: '2. Know when e-invoicing applies' },
    {
      kind: 'paragraph',
      text:
        'Businesses above the notified turnover threshold must report B2B invoices to the Invoice Registration ' +
        'Portal and print the IRN and QR code on the invoice. Check the current threshold every April: it has only ever come down.',
    },
    { kind: 'heading', text: '3. Generate e-way bills from the invoice' },
    {
      kind: 'paragraph',
      text:
        'Goods worth more than the e-way bill limit need one before they move. Creating it from the invoice data ' +
        'avoids retyping, and the vehicle number can be added later.',
    },
    { kind: 'heading', text: '4. Reconcile with GSTR-2B every month' },
    {
      kind: 'bullets',
      items: [
        'Download GSTR-2B after the 14th and match it against your purchase register.',
        'Chase suppliers for invoices they have not uploaded before you file GSTR-3B.',
        'Input tax credit you do not claim on time is lost for good.',
      ],
    },
    { kind: 'heading', text: '5. Collect faster' },
    {
      kind: 'paragraph',
      text: 'Send the invoice with a UPI payment link on WhatsApp and a polite reminder three days before the due date.',
    },
    { kind: 'heading', text: 'Where Ledgerly fits' },
    { kind: 'table', rows: PLANS.map((plan) => [plan.name, `${plan.price}: ${plan.pitch}`] as const) },
    {
      kind: 'note',
      text: 'Thresholds and limits change; confirm them on the GST portal before you rely on them.',
    },
  ],
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = fileURLToPath(new URL('../public/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${GUIDE_FILE}`, renderPdf(GUIDE));
  process.stdout.write(`Wrote ${GUIDE_FILE} to ${dir}\n`);
}
