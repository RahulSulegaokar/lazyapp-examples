import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const TEMPLATES = {
  /** The day before: what, when, where. */
  reminder: 'demo_event_tickets_reminder',
  /** An hour before, with the venue as a location header. */
  startingSoon: 'demo_event_tickets_starting',
  /** Organiser updates to ticket holders (gate changes, weather, line-up). */
  update: 'demo_event_tickets_update',
  /** After the event: rate it. */
  feedback: 'demo_event_tickets_feedback',
} as const;

export const FLOWS = {
  attendee: 'attendee',
} as const;

export interface EventTicketsConfig {
  /** PIN door staff type on the check-in page. Shown in the chat, because the tester is also the staff. */
  readonly staffPin: string;
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): EventTicketsConfig {
  const pin = env.EVENT_TICKETS_STAFF_PIN?.trim();
  return { staffPin: pin === undefined || pin === '' ? '2468' : pin };
}

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose: 'Day-before reminder the buyer opted into ("Remind me" or the Flow checkbox).',
      input: {
        name: TEMPLATES.reminder,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, see you tomorrow at {{2}}! Doors open at {{3}}; the venue is {{4}}. Your ticket is saved in this chat, so there is nothing to print.',
        body_examples: ['Asha', 'Monsoon Indie Nights', '6:00 pm', 'Bandstand Amphitheatre, Bandra West'],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        buttons: [{ type: 'QUICK_REPLY', text: 'Show my ticket' }],
        submit: true,
      },
    },
    {
      kind: 'standard',
      purpose: 'One hour before the start, with a map of the venue (location header).',
      input: {
        name: TEMPLATES.startingSoon,
        language: 'en',
        category: 'UTILITY',
        header: { format: 'LOCATION' },
        body_text:
          'Starting in an hour: {{1}}. Doors are open, so keep the QR code of booking {{2}} ready at the gate. Tap the map for directions.',
        body_examples: ['Monsoon Indie Nights', 'MIN-24051'],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        buttons: [{ type: 'QUICK_REPLY', text: 'Show my ticket' }],
        submit: true,
      },
    },
    {
      kind: 'standard',
      purpose: 'Live update to everyone holding a ticket (in production a broadcast to the event segment).',
      input: {
        name: TEMPLATES.update,
        language: 'en',
        category: 'UTILITY',
        body_text: 'Update for {{1}} ticket holders: {{2}} Reply MENU for your ticket and the venue map.',
        body_examples: [
          'Monsoon Indie Nights',
          'Because of the rain, gates open at 6:30 pm and the first band starts at 7:30 pm.',
        ],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        submit: true,
      },
    },
    {
      kind: 'standard',
      purpose: 'Rate-the-event message after it ends (quick replies answer in the chat).',
      input: {
        name: TEMPLATES.feedback,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Thanks for coming to {{1}}! How was it, {{2}}? Your rating goes straight to the organisers.',
        body_examples: ['Monsoon Indie Nights', 'Asha'],
        footer_text: 'LazyApp demo · reply STOP to opt out',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Loved it' },
          { type: 'QUICK_REPLY', text: 'It was OK' },
          { type: 'QUICK_REPLY', text: 'Not great' },
        ],
        submit: true,
      },
    },
  ],
  flows: [
    {
      key: FLOWS.attendee,
      purpose: 'Attendee details, quantity and promo code, priced live by the data endpoint before payment.',
      categories: ['OTHER'],
      flowJson: loadFlowJson(new URL('../flows/attendee.json', import.meta.url)),
      dataExchange: true,
    },
  ],
  webhookEvents: ['payment.captured', 'payment.failed', 'message.failed'],
  requires: { catalog: 'none', payments: 'optional' },
  command: { name: 'events', description: 'Event tickets: discover, book, pay and check in on WhatsApp' },
  qrPrefill: 'DEMO EVENTS',
};
