import { z } from 'zod';

const patientSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(120),
  gender: z.enum(['female', 'male', 'other']).nullable(),
});

export type Patient = z.infer<typeof patientSchema>;

/** A slot picked and held, not yet a booking (from the Flow endpoint or the list fallback). */
const draftSchema = z.object({
  bookingId: z.string(),
  doctorId: z.string(),
  date: z.string(),
  time: z.string(),
  heldUntil: z.string(),
  patient: patientSchema.nullable(),
  reason: z.string().max(500).nullable(),
});

export type Draft = z.infer<typeof draftSchema>;

const bookingSchema = z.object({
  id: z.string(),
  doctorId: z.string(),
  date: z.string(),
  time: z.string(),
  kind: z.enum(['new', 'follow-up']),
  patient: patientSchema,
  reason: z.string().nullable(),
  /** Paise. */
  fee: z.number().int().nonnegative(),
  status: z.enum(['held', 'awaiting_payment', 'confirmed', 'completed', 'cancelled']),
  heldUntil: z.string().nullable(),
  payMode: z.enum(['online', 'clinic']).nullable(),
  paymentId: z.string().nullable(),
  paymentAttempts: z.number().int().nonnegative(),
  paid: z.boolean(),
  remindersOn: z.boolean(),
  previsitDone: z.boolean(),
  files: z.number().int().nonnegative(),
});

export type Booking = z.infer<typeof bookingSchema>;

export const clinicStateSchema = z.object({
  step: z.enum([
    'menu',
    'specialty',
    'doctor',
    'consent',
    'slot',
    'patient-details',
    'review',
    'manage',
    'cancel-confirm',
    'previsit-text',
    'branches',
  ]),
  /** The demo number, from the first inbound message: the "front desk" contact card. */
  businessNumber: z.string().nullable(),
  specialtyId: z.string().nullable(),
  doctorId: z.string().nullable(),
  /** What the next slot pick is for. */
  intent: z.enum(['new', 'follow-up', 'reschedule']),
  /** DPDP consent to process health data, given with an explicit tap. */
  consent: z.boolean(),
  /** Fallback slot picking: the date chosen from the list, and the page of times shown. */
  pickedDate: z.string().nullable(),
  timesOffset: z.number().int().nonnegative(),
  draft: draftSchema.nullable(),
  booking: bookingSchema.nullable(),
  /** The last completed visit, for follow-up pricing. */
  lastVisit: z.object({ bookingId: z.string(), doctorId: z.string(), date: z.string() }).nullable(),
});

export type ClinicState = z.infer<typeof clinicStateSchema>;

export const initialClinicState = (): ClinicState => ({
  step: 'menu',
  businessNumber: null,
  specialtyId: null,
  doctorId: null,
  intent: 'new',
  consent: false,
  pickedDate: null,
  timesOffset: 0,
  draft: null,
  booking: null,
  lastVisit: null,
});
