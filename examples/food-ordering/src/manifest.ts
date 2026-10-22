import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const TEMPLATES = {
  tableReminder: 'demo_food_ordering_table_reminder',
} as const;

export const FLOWS = {
  customize: 'customize',
  table: 'table',
} as const;

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose: 'Table reminder two hours before a booking, scheduled only when the guest taps "Remind me".',
      input: {
        name: TEMPLATES.tableReminder,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, a reminder that your table for {{2}} at Masala Mile {{3}} is booked for {{4}}. We hold tables for 15 minutes, so do tell us if you are running late.',
        body_examples: ['Asha', '4', 'Indiranagar', 'today at 7:30 pm'],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Get directions' },
          { type: 'QUICK_REPLY', text: 'Cancel booking' },
        ],
        submit: true,
      },
    },
  ],
  flows: [
    {
      key: FLOWS.customize,
      purpose:
        'Portion, spice level, add-ons, quantity and cooking notes for a dish. Navigate flow: the dish is passed as screen data.',
      categories: ['SHOPPING'],
      flowJson: loadFlowJson(new URL('../flows/customize.json', import.meta.url)),
      dataExchange: false,
    },
    {
      key: FLOWS.table,
      purpose:
        'Table booking with live availability: the data endpoint returns free times and reserves the table atomically.',
      categories: ['APPOINTMENT_BOOKING'],
      flowJson: loadFlowJson(new URL('../flows/table.json', import.meta.url)),
      dataExchange: true,
    },
  ],
  webhookEvents: ['payment.captured', 'payment.failed', 'message.failed'],
  requires: { catalog: 'optional', payments: 'optional', addressMessages: true },
  command: { name: 'food', description: 'Order biryani, track the kitchen, book a table' },
  qrPrefill: 'DEMO FOOD',
};
