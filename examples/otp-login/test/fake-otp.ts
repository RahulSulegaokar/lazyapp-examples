import type { Harness } from '@lazyapp-examples/demo-kit/testing';

/** The code the fake LazyApp generates for every challenge. */
export const CODE = '482913';

interface Challenge {
  id: string;
  to: string;
  status: 'pending' | 'verified' | 'expired' | 'locked';
  attempts: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * LazyApp's managed OTP, faithful to `SendOtpChallenge` / `VerifyOtpChallenge`: a 30s resend
 * cool-off answered as `422 "Wait N more second(s)…"`, 10-minute expiry, 5 attempts, and verify
 * by challenge id. Refusals are `422 { message }` with no code, exactly like the real API.
 */
export function installFakeOtp<S>(h: Harness<S>): { readonly challenges: Challenge[] } {
  const challenges: Challenge[] = [];
  const now = () => h.now().getTime();

  h.api.on('POST', '/v1/otp', (call) => {
    const body = call.body as { to: string };
    const latest = challenges.filter((challenge) => challenge.to === body.to).at(-1);
    const elapsed = latest === undefined ? Infinity : (now() - latest.createdAt) / 1000;
    if (elapsed < 30) {
      return {
        status: 422,
        body: { message: `Wait ${30 - Math.floor(elapsed)} more second(s) before requesting another code.` },
      };
    }
    const challenge: Challenge = {
      id: `0b6f6a2e-0000-4000-8000-${String(challenges.length + 1).padStart(12, '0')}`,
      to: body.to,
      status: 'pending',
      attempts: 0,
      createdAt: now(),
      expiresAt: now() + 10 * 60_000,
    };
    challenges.push(challenge);
    return {
      status: 201,
      body: {
        id: challenge.id,
        to: challenge.to,
        status: 'pending',
        expires_at: new Date(challenge.expiresAt).toISOString(),
        mode: 'managed',
      },
    };
  });

  h.api.on('POST', '/v1/otp/verify', (call) => {
    const body = call.body as { id: string; code: string };
    const challenge = challenges.find((entry) => entry.id === body.id && entry.status === 'pending');
    if (challenge === undefined) {
      return { status: 422, body: { message: 'No pending OTP challenge found.' } };
    }
    if (challenge.expiresAt <= now()) {
      challenge.status = 'expired';
      return { status: 422, body: { message: 'OTP has expired.' } };
    }
    if (challenge.attempts >= 5) {
      challenge.status = 'locked';
      return { status: 422, body: { message: 'Too many OTP attempts.' } };
    }
    challenge.attempts += 1;
    if (body.code !== CODE) {
      return { status: 422, body: { message: 'Invalid OTP code.' } };
    }
    challenge.status = 'verified';
    return {
      status: 200,
      body: { id: challenge.id, status: 'verified', verified_at: new Date(now()).toISOString() },
    };
  });

  return { challenges };
}
