import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { Ctx } from './context.js';
import { firstName } from './context.js';

export const MENU_IDS = {
  book: 'menu:book',
  appointment: 'menu:appointment',
  reports: 'menu:reports',
  branches: 'menu:branches',
  emergency: 'menu:emergency',
  privacy: 'menu:privacy',
} as const;

/** The front desk: one list message with everything a patient comes for. */
export async function showMenu(ctx: Ctx, intro?: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu', pickedDate: null, timesOffset: 0 }));
  const booking = ctx.state.booking;
  const upcoming = booking !== null && booking.status !== 'cancelled' && booking.status !== 'completed';
  const name = firstName(ctx);
  await ctx.send.list({
    header: 'Aarogya Clinics',
    body:
      intro ??
      `Namaste${name === null ? '' : ` ${name}`} 🙏 Welcome to Aarogya Clinics, Bengaluru.\n\nBook a doctor with live slots, pay the consultation fee in WhatsApp, and get reminders, prescriptions and reports right here.`,
    button: 'How can we help?',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Appointments',
        rows: [
          { id: MENU_IDS.book, title: 'Book an appointment', description: '7 specialties · 3 branches' },
          {
            id: MENU_IDS.appointment,
            title: 'My appointment',
            description: upcoming ? 'Reschedule, cancel, pre-visit form' : 'Nothing booked yet',
          },
          { id: MENU_IDS.reports, title: 'Reports & prescriptions', description: 'PDFs after your visit' },
        ],
      },
      {
        title: 'Clinic',
        rows: [
          {
            id: MENU_IDS.branches,
            title: 'Nearest branch & hours',
            description: 'Koramangala · Indiranagar · HSR',
          },
          { id: MENU_IDS.emergency, title: 'Emergency contacts', description: '24×7 desk and ambulance' },
          { id: MENU_IDS.privacy, title: 'Privacy notice', description: 'How we use your health data' },
        ],
      },
    ],
  });
}

/** Unrecognised input: say so plainly and put the menu back in reach. */
export async function nudge(ctx: Ctx): Promise<void> {
  await showMenu(
    ctx,
    "Sorry, I didn't catch that. I'm the clinic's booking assistant, so pick an option below. (For a medical emergency, call 108.)",
  );
}
