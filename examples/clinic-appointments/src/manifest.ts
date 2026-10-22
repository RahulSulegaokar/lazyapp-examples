import { loadFlowJson } from '@lazyapp-examples/demo-kit';
import type { ExampleManifest } from '@lazyapp-examples/demo-kit';

export const TEMPLATES = {
  reminder: 'demo_clinic_appointments_reminder',
  confirmation: 'demo_clinic_appointments_confirmation',
} as const;

export const FLOWS = {
  book: 'book',
  previsit: 'previsit',
} as const;

/** Quick-reply payloads the templates carry, so a tap on a reminder lands in the right handler. */
export const TEMPLATE_PAYLOADS = {
  attend: 'appt:attend',
  reschedule: 'appt:reschedule',
  manage: 'menu:appointment',
} as const;

const FOOTER = 'Aarogya Clinics · LazyApp demo';

export const manifest: ExampleManifest = {
  templates: [
    {
      kind: 'standard',
      purpose:
        'Appointment reminder 24h and 1h before the visit, scheduled only after the patient taps "Remind me".',
      input: {
        name: TEMPLATES.reminder,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Reminder: your appointment with {{1}} is on {{2}} at {{3}}, at Aarogya Clinics {{4}}. Please arrive 10 minutes early and bring any previous reports.',
        body_examples: ['Dr. Kavita Rao', 'Sat, 24 Oct', '10:30 AM', 'Koramangala'],
        footer_text: FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: "I'll be there" },
          { type: 'QUICK_REPLY', text: 'Reschedule' },
        ],
      },
    },
    {
      kind: 'standard',
      purpose:
        'Booking confirmation when the payment lands after the 24h window closed (inside it, a free-form message is used).',
      input: {
        name: TEMPLATES.confirmation,
        language: 'en',
        category: 'UTILITY',
        body_text:
          'Hi {{1}}, your appointment with {{2}} on {{3}} is confirmed. Your booking ID is {{4}}. Show this message at the front desk.',
        body_examples: ['Asha', 'Dr. Kavita Rao', 'Sat, 24 Oct · 10:30 AM', 'AC7K2Q'],
        footer_text: FOOTER,
        buttons: [{ type: 'QUICK_REPLY', text: 'Manage booking' }],
      },
    },
  ],
  flows: [
    {
      key: FLOWS.book,
      purpose:
        'Slot picker with live availability (data_exchange): dates, then times, then patient details; holds the slot.',
      categories: ['APPOINTMENT_BOOKING'],
      flowJson: loadFlowJson(new URL('../flows/book.json', import.meta.url)),
      dataExchange: true,
    },
    {
      key: FLOWS.previsit,
      purpose: 'Pre-visit intake form (symptoms, conditions, allergies, medicines), navigate only.',
      categories: ['OTHER'],
      flowJson: loadFlowJson(new URL('../flows/previsit.json', import.meta.url)),
      dataExchange: false,
    },
  ],
  webhookEvents: ['payment.captured', 'payment.failed', 'message.failed'],
  requires: { catalog: 'none', payments: 'optional' },
  command: { name: 'clinic', description: 'Book a doctor: live slots, payment, reminders, reports' },
  qrPrefill: 'DEMO CLINIC',
};
