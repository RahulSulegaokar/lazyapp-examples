import { z } from 'zod';

const profileSchema = z.object({
  country: z.enum(['uk', 'canada', 'australia', 'germany', 'usa', 'ireland', 'any']).nullable(),
  level: z.enum(['ug', 'pg', 'mba']).nullable(),
  field: z.enum(['cs', 'data', 'business', 'engineering', 'finance', 'any']).nullable(),
  intake: z.string().nullable(),
  budget: z.enum(['b15', 'b25', 'b35', 'bany']).nullable(),
  ielts: z.enum(['none', '6.0', '6.5', '7.0']).nullable(),
});

const documentSchema = z.object({
  mediaId: z.string().nullable(),
  mimeType: z.string().nullable(),
  filename: z.string().nullable(),
  at: z.string(),
});

const mediaSchema = z.object({
  mediaId: z.string().nullable(),
  mimeType: z.string().nullable(),
  filename: z.string().nullable(),
});

export type ReceivedMedia = z.infer<typeof mediaSchema>;

const counsellingSchema = z.object({
  counsellorId: z.string(),
  date: z.string(),
  time: z.string(),
  mode: z.enum(['phone', 'office']).nullable(),
  confirmed: z.boolean(),
  remindersOn: z.boolean(),
});

export type Counselling = z.infer<typeof counsellingSchema>;

const applicationSchema = z.object({
  ref: z.string(),
  programId: z.string(),
  /** `YYYY-MM`. */
  intake: z.string(),
  status: z.enum(['fee_pending', 'awaiting_payment', 'submitted']),
  payMode: z.enum(['online', 'counselling']).nullable(),
  paymentId: z.string().nullable(),
  paymentAttempts: z.number().int().nonnegative(),
  remindersOn: z.boolean(),
});

export type Application = z.infer<typeof applicationSchema>;

export const admissionsStateSchema = z.object({
  role: z.enum(['student', 'guardian']),
  step: z.enum([
    'menu',
    'finder-country',
    'finder-level',
    'finder-budget',
    'finder-ielts',
    'results',
    'counselling',
    'documents',
    'awaiting-document',
    'classify-document',
    'application',
    'guardian-invite',
  ]),
  /** The demo number, from the first inbound message: counsellor card and parent link. */
  businessNumber: z.string().nullable(),
  profile: profileSchema,
  shortlist: z.array(z.string()).max(10),
  counselling: counsellingSchema.nullable(),
  documents: z.record(z.string(), documentSchema),
  awaitingDocument: z.string().nullable(),
  pendingMedia: mediaSchema.nullable(),
  application: applicationSchema.nullable(),
  guardianInvite: z.object({ code: z.string(), name: z.string(), phone: z.string().nullable() }).nullable(),
  /** For a parent: whose application they follow. */
  linkedStudent: z.object({ address: z.string(), name: z.string(), code: z.string() }).nullable(),
});

export type AdmissionsState = z.infer<typeof admissionsStateSchema>;
export type Profile = AdmissionsState['profile'];

export const initialAdmissionsState = (): AdmissionsState => ({
  role: 'student',
  step: 'menu',
  businessNumber: null,
  profile: { country: null, level: null, field: null, intake: null, budget: null, ielts: null },
  shortlist: [],
  counselling: null,
  documents: {},
  awaitingDocument: null,
  pendingMedia: null,
  application: null,
  guardianInvite: null,
  linkedStudent: null,
});
