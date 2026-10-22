import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const EXAMPLE_ID = 'lead-generation';
export const START_CODE = 'DEMO LEADS';

/** Workspace-wide names: always `demo_lead_generation_<what>`. */
export const TEMPLATES = {
  meetingBooked: 'demo_lead_generation_meeting_booked',
  meetingReminder: 'demo_lead_generation_meeting_reminder',
  nurtureTip: 'demo_lead_generation_nurture_tip',
  comebackOffer: 'demo_lead_generation_comeback_offer',
} as const;

export const FLOWS = {
  qualify: 'qualify',
  meeting: 'meeting',
} as const;

export const COUPON_CODE = 'LEDGER30';

const FOOTER = 'Ledgerly · LazyApp demo';

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose: 'Confirms a booked demo; quick replies move or cancel it.',
      input: {
        name: TEMPLATES.meetingBooked,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Your Ledgerly demo is booked for {{1}} with {{2}}. We will share the joining link in this chat 15 minutes before the call, so keep WhatsApp handy.',
        body_examples: ['Mon, 26 Oct at 11:30 AM', 'Ananya Iyer'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Reschedule' },
          { type: 'QUICK_REPLY', text: 'Cancel' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose: 'Reminder before the demo the lead booked.',
      input: {
        name: TEMPLATES.meetingReminder,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Your Ledgerly demo with {{1}} starts at {{2}}. Keep a recent GST invoice handy so we can walk through your own numbers.',
        body_examples: ['Ananya Iyer', 'Mon, 26 Oct at 11:30 AM'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'I will join' },
          { type: 'QUICK_REPLY', text: 'Reschedule' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose: 'Nurture tip, only after the lead tapped "Yes, send tips" (marketing consent).',
      input: {
        name: TEMPLATES.nurtureTip,
        language: 'en',
        category: 'MARKETING',
        header: { format: 'TEXT', text: 'A quick GST tip from Ledgerly' },
        body_text:
          'Hi {{1}}, here is the tip we promised: reconcile purchase invoices with GSTR-2B every month before you file GSTR-3B, so input tax credit is never lost. Want us to show how {{2}} can automate it?',
        body_examples: ['Asha', 'Sharma Traders'],
        footer_text: 'Tap Stop tips to opt out',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Book a demo' },
          { type: 'QUICK_REPLY', text: 'Stop tips' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose: 'Re-engagement coupon (copy-code button), only for leads who opted in to tips.',
      input: {
        name: TEMPLATES.comebackOffer,
        language: 'en',
        category: 'MARKETING',
        body_text:
          'Still comparing GST tools, {{1}}? Start any Ledgerly plan this week and get 30 extra days free with the code below.',
        body_examples: ['Asha'],
        footer_text: 'Tap Stop offers to opt out',
        buttons: [
          { type: 'COPY_CODE', example: COUPON_CODE },
          { type: 'QUICK_REPLY', text: 'Book a demo' },
          { type: 'QUICK_REPLY', text: 'Stop offers' },
        ],
      },
    },
  ],
  flows: [
    {
      key: FLOWS.qualify,
      purpose: 'Two-screen qualification (needs, team size, role, budget, timeline, email). Navigate only.',
      categories: ['LEAD_GENERATION'],
      flowJson: loadFlowJson(new URL('../flows/qualify.json', import.meta.url)),
      dataExchange: false,
    },
    {
      key: FLOWS.meeting,
      purpose: "Demo booking against the assigned rep's live calendar; the endpoint holds the slot.",
      categories: ['APPOINTMENT_BOOKING'],
      flowJson: loadFlowJson(new URL('../flows/meeting.json', import.meta.url)),
      dataExchange: true,
    },
  ],
  webhookEvents: ['message.failed', 'contact.opted_out'],
  requires: { catalog: 'none', payments: 'none' },
  command: { name: 'leads', description: 'See a WhatsApp lead machine: qualify, score, book a demo' },
  qrPrefill: `${START_CODE} src=qr cmp=demo-booth`,
  iceBreaker: `${START_CODE} I want a demo of Ledgerly`,
};
