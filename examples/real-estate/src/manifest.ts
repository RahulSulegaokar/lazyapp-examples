import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const EXAMPLE_ID = 'real-estate';
export const START_CODE = 'DEMO HOMES';

/** Workspace-wide names: always `demo_real_estate_<what>`. */
export const TEMPLATES = {
  visitConfirmed: 'demo_real_estate_visit_confirmed',
  visitReminder: 'demo_real_estate_visit_reminder',
  visitFeedback: 'demo_real_estate_visit_feedback',
} as const;

export const FLOWS = {
  search: 'search',
  emi: 'emi',
  visit: 'visit',
} as const;

const FOOTER = 'Brickfield Homes · LazyApp demo';

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose:
        'Confirms a booked site visit with the project pin as a location header; quick replies reschedule or cancel.',
      input: {
        name: TEMPLATES.visitConfirmed,
        language: 'en',
        category: 'UTILITY',
        header: { format: 'LOCATION' },
        body_text:
          'Your site visit to {{1}} is confirmed for {{2}}. {{3}} from Brickfield Homes will meet you at the sales gallery, so please carry a photo ID for the gate.',
        body_examples: ['Brickfield Aurora, Whitefield', 'Sat, 24 Oct at 11:30 AM', 'Priya Nair'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Reschedule' },
          { type: 'QUICK_REPLY', text: 'Cancel visit' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose: 'Reminder before a booked visit (a follow-up the buyer created by booking).',
      input: {
        name: TEMPLATES.visitReminder,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Reminder: your site visit to {{1}} is on {{2}}. {{3}} will be waiting at the sales gallery; tap below for directions or to change the time.',
        body_examples: ['Brickfield Aurora, Whitefield', 'Sat, 24 Oct at 11:30 AM', 'Priya Nair'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Get directions' },
          { type: 'QUICK_REPLY', text: 'Reschedule' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose: 'Asks how the visit went, after it; the answer updates the lead score.',
      input: {
        name: TEMPLATES.visitFeedback,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Thank you for visiting {{1}} with {{2}}. How did the site visit go? Your answer helps us shortlist the right homes for you.',
        body_examples: ['Brickfield Aurora', 'Priya Nair'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Loved it' },
          { type: 'QUICK_REPLY', text: 'It was okay' },
          { type: 'QUICK_REPLY', text: 'Not for me' },
        ],
      },
    },
  ],
  flows: [
    {
      key: FLOWS.search,
      purpose:
        'Home preferences (buy/rent, city, locality, budget, bedrooms). Localities and budgets reload from the endpoint as the city and purpose change.',
      categories: ['LEAD_GENERATION'],
      flowJson: loadFlowJson(new URL('../flows/search.json', import.meta.url)),
      dataExchange: true,
    },
    {
      key: FLOWS.emi,
      purpose: 'EMI calculator: the endpoint computes EMI, interest and the income lenders expect.',
      categories: ['OTHER'],
      flowJson: loadFlowJson(new URL('../flows/emi.json', import.meta.url)),
      dataExchange: true,
    },
    {
      key: FLOWS.visit,
      purpose: 'Site-visit booking with live slot availability; the endpoint reserves the slot.',
      categories: ['APPOINTMENT_BOOKING'],
      flowJson: loadFlowJson(new URL('../flows/visit.json', import.meta.url)),
      dataExchange: true,
    },
  ],
  webhookEvents: ['message.failed'],
  requires: { catalog: 'none', payments: 'none' },
  command: { name: 'homes', description: 'Find a home, book a site visit, check your EMI' },
  qrPrefill: START_CODE,
  iceBreaker: 'DEMO HOMES Find me a 2 BHK in Bengaluru',
};
