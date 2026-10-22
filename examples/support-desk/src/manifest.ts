import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const TEMPLATES = {
  /** "An agent picked up your ticket": the only message the desk ever sends outside the chat window. */
  ticketUpdate: 'demo_support_desk_ticket_update',
} as const;

export const FLOWS = {
  csat: 'csat',
} as const;

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose:
        'Ticket update the customer asked for ("Notify me") when the desk is closed; sent when the next shift starts.',
      input: {
        name: TEMPLATES.ticketUpdate,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, there is an update on your Halo Home ticket {{2}}: {{3}} Reply here to continue the conversation with our team.',
        body_examples: [
          'Asha',
          'SUP-48211',
          'Meera from our priority desk has picked it up and will reply shortly.',
        ],
        footer_text: 'Halo Home Care · LazyApp demo',
        buttons: [{ type: 'QUICK_REPLY', text: 'View ticket' }],
        submit: true,
      },
    },
  ],
  flows: [
    {
      key: FLOWS.csat,
      purpose: 'Customer satisfaction survey after a resolved ticket (navigate, no data endpoint).',
      categories: ['SURVEY', 'CUSTOMER_SUPPORT'],
      flowJson: loadFlowJson(new URL('../flows/csat.json', import.meta.url)),
      dataExchange: false,
    },
  ],
  webhookEvents: ['message.failed'],
  requires: { catalog: 'none', payments: 'none' },
  command: { name: 'support', description: 'Customer support desk: FAQs, order tracking, tickets, agents' },
  qrPrefill: 'DEMO SUPPORT',
};
