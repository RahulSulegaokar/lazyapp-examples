import { DEMO_FOOTER, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { ContactCard } from '@lazyapp-examples/sdk';
import { startSlotPick } from './booking.js';
import { BRANCHES, EMERGENCY, findDoctor } from './clinic.js';
import type { Branch } from './clinic.js';
import type { Ctx } from './context.js';
import { assetUrl } from './context.js';
import { MENU_IDS, showMenu } from './menu.js';
import { dayLabel, istDate } from './schedule.js';

export const INFO_IDS = {
  allBranches: 'branches:all',
  followUp: 'followup:book',
} as const;

// --- Branches -------------------------------------------------------------------------

export async function askLocation(ctx: Ctx): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'branches' }));
  await ctx.send.locationRequest(
    'Share your location and I will point you to the nearest Aarogya branch, with directions and opening hours. (Or type MENU.)',
  );
}

export async function onLocation(ctx: Ctx, latitude: number, longitude: number): Promise<void> {
  const ranked = BRANCHES.map((branch) => ({
    branch,
    km: distanceKm(latitude, longitude, branch.latitude, branch.longitude),
  })).sort((a, b) => a.km - b.km);
  const nearest = ranked[0];
  if (nearest === undefined) {
    return showMenu(ctx);
  }
  await ctx.send.location({
    latitude: nearest.branch.latitude,
    longitude: nearest.branch.longitude,
    name: nearest.branch.name,
    address: nearest.branch.address,
  });
  await ctx.send.buttons({
    body: `*${nearest.branch.name}* is the closest, about ${formatKm(nearest.km)} away.\n🕘 ${nearest.branch.hours}\n🅿️ Parking and wheelchair access available.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: MENU_IDS.book, title: 'Book appointment' },
      { id: INFO_IDS.allBranches, title: 'All branches' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

export async function showAllBranches(ctx: Ctx): Promise<void> {
  await ctx.send.buttons({
    header: 'Our branches',
    body: BRANCHES.map((branch: Branch) => `*${branch.name}*\n${branch.address}\n🕘 ${branch.hours}`).join(
      '\n\n',
    ),
    footer: DEMO_FOOTER,
    buttons: [
      { id: MENU_IDS.book, title: 'Book appointment' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

// --- Emergency and privacy ------------------------------------------------------------------

export async function showEmergency(ctx: Ctx): Promise<void> {
  const cards: ContactCard[] = [
    {
      name: { formatted_name: 'Ambulance (India)', first_name: 'Ambulance' },
      phones: [{ phone: EMERGENCY.ambulance, type: 'WORK' }],
    },
  ];
  const desk = ctx.state.businessNumber;
  if (desk !== null) {
    cards.unshift({
      name: { formatted_name: 'Aarogya Clinics 24x7 Desk', first_name: 'Aarogya', last_name: 'Clinics' },
      org: { company: 'Aarogya Clinics', title: '24x7 front desk' },
      phones: [{ phone: desk, type: 'WORK', wa_id: desk.replace(/\D/g, '') }],
      addresses: [
        {
          street: '80 Feet Road, Koramangala 4th Block',
          city: 'Bengaluru',
          zip: '560034',
          country: 'India',
          type: 'WORK',
        },
      ],
    });
  }
  await ctx.send.text(
    '🚑 *If this is a medical emergency, call 108 now* or go to the nearest hospital emergency room. Do not wait for a chat reply.\n\nSave these contacts:',
  );
  await ctx.send.contacts(cards);
}

export async function showPrivacy(ctx: Ctx): Promise<void> {
  await ctx.send.document(
    assetUrl(ctx, 'privacy-notice.pdf'),
    'Aarogya-Clinics-Privacy-Notice.pdf',
    'How we use your data: only to book and manage your care, never for marketing. Under the DPDP Act, 2023 you can ask us to access, correct or erase it. Send STOP any time to stop all messages.',
  );
}

// --- Reports, prescriptions and follow-ups ---------------------------------------------------

/**
 * In a real clinic the EMR posts the prescription after the consultation. The demo
 * fast-forwards past the visit: the booking becomes a completed visit and the PDFs arrive.
 */
export async function showReports(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  const doctor = booking === null ? undefined : findDoctor(booking.doctorId);
  if (
    booking === null ||
    doctor === undefined ||
    (booking.status !== 'confirmed' && booking.status !== 'completed')
  ) {
    await ctx.send.buttons({
      body: 'Prescriptions and lab reports arrive here as PDFs right after your visit. Book an appointment to see how it works.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.book, title: 'Book now' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  if (booking.status === 'confirmed') {
    await completeVisit(ctx);
  }
  const visitDate = dayLabel(booking.date);
  const datePart = booking.date.replace(/-/g, '');
  await ctx.send.document(
    assetUrl(ctx, 'prescription-sample.pdf'),
    `Prescription-${doctor.name.replace(/[^A-Za-z]+/g, '-')}-${datePart}.pdf`,
    `Prescription from ${doctor.name} · visit on ${visitDate} · ${booking.patient.name}`,
  );
  await ctx.send.buttons({
    header: { document: assetUrl(ctx, 'lab-report-sample.pdf'), filename: `CBC-Report-${datePart}.pdf` },
    body: `(Demo: we fast-forwarded past your visit.)\n\nYour CBC report is ready too. ${doctor.name} advised a review in 5 days: follow-ups within 14 days are half price.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: INFO_IDS.followUp, title: 'Book follow-up' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

async function completeVisit(ctx: Ctx): Promise<void> {
  const booking = ctx.state.booking;
  if (booking === null) {
    return;
  }
  for (const key of ['reminder-24h', 'reminder-1h']) {
    await ctx.followUps.cancel(key);
  }
  if (booking.paid && booking.paymentId !== null) {
    try {
      await ctx.api.payments.updateStatus(
        booking.paymentId,
        { status: 'completed', description: 'Consultation completed. Prescription shared on WhatsApp.' },
        { idempotencyKey: ctx.idempotencyKey(`order-status:${booking.id}:completed`) },
      );
    } catch (error) {
      ctx.log.warn('order status update failed', { error });
    }
  }
  ctx.setState((state) => ({
    ...state,
    booking: { ...booking, status: 'completed', remindersOn: false },
    lastVisit: { bookingId: booking.id, doctorId: booking.doctorId, date: istDate(ctx.now()) },
  }));
}

export async function onFollowUp(ctx: Ctx): Promise<void> {
  const visit = ctx.state.lastVisit;
  if (visit === null) {
    return showReports(ctx);
  }
  return startSlotPick(ctx, visit.doctorId, 'follow-up');
}

/** Great-circle distance (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatKm(km: number): string {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
}
