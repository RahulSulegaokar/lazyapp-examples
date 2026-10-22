import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';
import type { CreateTemplateInput } from '@lazyapp-examples/sdk';

export const TEMPLATES = {
  deadline: 'demo_education_admissions_deadline_reminder',
  counselling: 'demo_education_admissions_counselling_reminder',
  intake: 'demo_education_admissions_intake_announcement',
} as const;

export const FLOWS = {
  finder: 'finder',
} as const;

/** Quick-reply payloads the templates carry. */
export const TEMPLATE_PAYLOADS = {
  documents: 'menu:documents',
  counselling: 'menu:counselling',
  eligibility: 'menu:finder',
  stopAlerts: 'alerts:stop',
} as const;

const FOOTER = 'BrightPath Overseas · LazyApp demo';

/**
 * The broadcast-ready intake announcement (marketing, image header). Meta reviews a
 * sample of every media header, and `npm run setup` cannot upload one, so this template
 * is created by `src/provision-intake-template.ts` (it uploads the sample, then creates it).
 */
export const INTAKE_TEMPLATE: Omit<CreateTemplateInput, 'header'> = {
  name: TEMPLATES.intake,
  language: 'en',
  category: 'MARKETING',
  body_text:
    'Hi {{1}}, applications for the {{2}} intake are now open at {{3}} partner universities in the UK, Canada, Australia, Germany, Ireland and the USA. Early applicants can get scholarships worth up to {{4}}. Check your eligibility in two minutes.',
  body_examples: ['Rahul', 'Sep–Dec 2027', '18', '₹10 lakh'],
  footer_text: FOOTER,
  buttons: [
    { type: 'QUICK_REPLY', text: 'Check eligibility' },
    { type: 'QUICK_REPLY', text: 'Stop alerts' },
  ],
};

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose:
        'Deadline reminders 7 days and 1 day before the application deadline, scheduled only after the student taps "Remind me".',
      input: {
        name: TEMPLATES.deadline,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, the application deadline for {{2}} ({{3}} intake) is {{4}}. Reply here to finish any pending documents with your counsellor.',
        body_examples: ['Rahul', 'MSc Data Science, University of Leeds', 'Sep 2027', '23 Jun 2027'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Upload documents' },
          { type: 'QUICK_REPLY', text: 'Talk to counsellor' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose: 'Reminder 1 hour before a booked counselling call, after the student taps "Remind me".',
      input: {
        name: TEMPLATES.counselling,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, your counselling call with {{2}} is today at {{3}}. Keep your marksheets and passport handy so we can shortlist universities together.',
        body_examples: ['Rahul', 'Priya Sharma', '3:00 PM'],
        footer_text: FOOTER,
        buttons: [{ type: 'QUICK_REPLY', text: 'Upload documents' }],
      },
    },
  ],
  flows: [
    {
      key: FLOWS.finder,
      purpose:
        'Course finder: country, level, field, intake, budget and IELTS, matched live (data_exchange); returns a shortlist.',
      categories: ['LEAD_GENERATION'],
      flowJson: loadFlowJson(new URL('../flows/finder.json', import.meta.url)),
      dataExchange: true,
    },
  ],
  webhookEvents: ['payment.captured', 'payment.failed', 'message.failed'],
  requires: { catalog: 'none', payments: 'optional' },
  command: { name: 'admissions', description: 'Study abroad: course finder, counselling, documents, fees' },
  qrPrefill: 'DEMO ADMISSIONS',
};
