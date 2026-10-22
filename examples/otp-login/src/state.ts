import { z } from 'zod';

const isoDate = z.iso.datetime({ offset: true });

/** The code currently outstanding in the chat, as LazyApp returned it from `POST /v1/otp`. */
const chatChallengeSchema = z.object({
  /** LazyApp challenge uuid: verify by id, never by phone, so a stale code cannot match a new one. */
  id: z.string().min(1),
  sentAt: isoDate,
  expiresAt: isoDate,
});

export const otpStateSchema = z.object({
  step: z.enum(['menu', 'awaiting_code', 'verified']),
  challenge: chatChallengeSchema.nullable(),
  /** Codes requested in the chat this session (our own cap, on top of LazyApp's). */
  codesSent: z.number().int().min(0),
  /** Wrong codes typed in the chat for the current challenge. */
  wrongCodes: z.number().int().min(0),
  /** Chat verification is paused until then after too many wrong codes. */
  lockedUntil: isoDate.nullable(),
  verifiedAt: isoDate.nullable(),
  /** Web challenges we already warned about (`otp.failed`), so the warning goes out once. */
  warnedChallenges: z.array(z.string()).max(20),
});

export type OtpState = z.infer<typeof otpStateSchema>;
export type ChatChallenge = z.infer<typeof chatChallengeSchema>;

export const initialOtpState = (): OtpState => ({
  step: 'menu',
  challenge: null,
  codesSent: 0,
  wrongCodes: 0,
  lockedUntil: null,
  verifiedAt: null,
  warnedChallenges: [],
});
