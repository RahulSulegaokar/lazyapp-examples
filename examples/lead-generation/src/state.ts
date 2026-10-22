import { z } from 'zod';
import { BUDGETS, ids, NEEDS, ROLES, SIZES, TIMELINES } from './product.js';

/** Where the lead came from: a Click-to-WhatsApp ad, a QR code, a link, or straight in. */
export const attributionSchema = z.object({
  channel: z.enum(['ad', 'qr', 'link', 'direct']),
  /** `utm_source`/`src`, or `facebook`/`instagram` for ads. */
  source: z.string().nullable(),
  medium: z.string().nullable(),
  campaign: z.string().nullable(),
  adId: z.string().nullable(),
  headline: z.string().nullable(),
  /** Click id Meta attaches to ad chats: what a conversion is reported against. */
  ctwaClid: z.string().nullable(),
});

export const answersSchema = z.object({
  needs: z.array(z.enum(ids(NEEDS))),
  size: z.enum(ids(SIZES)).nullable(),
  role: z.enum(ids(ROLES)).nullable(),
  budget: z.enum(ids(BUDGETS)).nullable(),
  timeline: z.enum(ids(TIMELINES)).nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
});

export const scoreSchema = z.object({
  value: z.number().int().min(0).max(100),
  grade: z.enum(['hot', 'warm', 'cold']),
  reasons: z.array(z.string()),
});

export const meetingSchema = z.object({
  /** `M-7KQ2M9`. */
  id: z.string(),
  at: z.string(),
  repId: z.string(),
  status: z.enum(['booked', 'cancelled']),
  agenda: z.string().nullable(),
  confirmed: z.boolean(),
  confirmationUuid: z.string().nullable(),
});

export const leadStateSchema = z.object({
  step: z.enum(['menu', 'qualify', 'qualified', 'meeting', 'nurture']),
  leadId: z.string(),
  attribution: attributionSchema,
  answers: answersSchema,
  score: scoreSchema.nullable(),
  /** True while the meeting flow is open to move `meeting` rather than book a new one. */
  rescheduling: z.boolean(),
  meeting: meetingSchema.nullable(),
  guideSent: z.boolean(),
  nurture: z.enum(['none', 'subscribed', 'declined', 'stopped']),
  tags: z.array(z.string()),
});

export type Attribution = z.infer<typeof attributionSchema>;
export type Answers = z.infer<typeof answersSchema>;
export type LeadScore = z.infer<typeof scoreSchema>;
export type Meeting = z.infer<typeof meetingSchema>;
export type LeadState = z.infer<typeof leadStateSchema>;

export const DIRECT: Attribution = {
  channel: 'direct',
  source: null,
  medium: null,
  campaign: null,
  adId: null,
  headline: null,
  ctwaClid: null,
};

export const EMPTY_ANSWERS: Answers = {
  needs: [],
  size: null,
  role: null,
  budget: null,
  timeline: null,
  company: null,
  email: null,
};

export const initialLeadState = (): LeadState => ({
  step: 'menu',
  leadId: '',
  attribution: DIRECT,
  answers: EMPTY_ANSWERS,
  score: null,
  rescheduling: false,
  meeting: null,
  guideSent: false,
  nurture: 'none',
  tags: [],
});
