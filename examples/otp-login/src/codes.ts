import type { KeyValueStore } from '@lazyapp-examples/demo-kit';
import type { LazyAppClient } from '@lazyapp-examples/sdk';
import { LIMITS, RateGuard, RESEND_COOLDOWN_SECONDS } from './guard.js';
import { CODE_TTL_MINUTES } from './manifest.js';
import type { OtpFailure } from './otp.js';
import { classifyOtpError, secondsUntil } from './otp.js';

export interface IssuedChallenge {
  readonly id: string;
  readonly sentAt: string;
  readonly expiresAt: string;
}

export type SendOutcome =
  | { readonly ok: true; readonly challenge: IssuedChallenge }
  | { readonly ok: false; readonly failure: OtpFailure };

export type VerifyOutcome =
  { readonly ok: true; readonly verifiedAt: string } | { readonly ok: false; readonly failure: OtpFailure };

export interface LoginCodesDeps {
  readonly api: LazyAppClient;
  readonly kv: KeyValueStore;
  readonly now: () => Date;
  /** Approved authentication template for `POST /v1/otp`. */
  readonly template: string;
  readonly phoneNumberId: string | null;
}

/**
 * Sends and checks login codes through LazyApp's managed OTP (`POST /v1/otp`, `POST /v1/otp/verify`):
 * LazyApp generates, hashes, sends and expires the code; this class only adds the demo's own
 * guards and keeps both the chat and the web page on the same per-number limits.
 */
export class LoginCodes {
  private readonly guard: RateGuard;

  constructor(private readonly deps: LoginCodesDeps) {
    this.guard = new RateGuard(deps.kv, deps.now);
  }

  /** Time left before `to` may get another code (0 = now). */
  cooldownSeconds(to: string): number {
    const last = this.deps.kv.get<string>(`last-sent:${to}`);
    return last === undefined
      ? 0
      : secondsUntil(
          new Date(new Date(last).getTime() + RESEND_COOLDOWN_SECONDS * 1000).toISOString(),
          this.deps.now(),
        );
  }

  /** True while `to` has used up its wrong-code allowance. */
  isLocked(to: string): boolean {
    return !this.guard.check(`wrong:${to}`, LIMITS.wrongCodesPerNumber).allowed;
  }

  async send(input: {
    readonly to: string;
    readonly ip: string | null;
    readonly idempotencyKey: string;
  }): Promise<SendOutcome> {
    const { to, ip } = input;
    if (this.isLocked(to)) {
      return { ok: false, failure: { kind: 'locked' } };
    }
    const cooldown = this.cooldownSeconds(to);
    if (cooldown > 0) {
      return { ok: false, failure: { kind: 'cooldown', retryAfterSeconds: cooldown } };
    }
    if (ip !== null) {
      const numbers = this.guard.hitDistinct(`ip-numbers:${ip}`, to, LIMITS.numbersPerIp);
      const perIp = numbers.allowed ? this.guard.hit(`ip-codes:${ip}`, LIMITS.codesPerIp) : numbers;
      if (!perIp.allowed) {
        return {
          ok: false,
          failure: { kind: 'too_many_requests', retryAfterSeconds: perIp.retryAfterSeconds },
        };
      }
    }
    const perNumber = this.guard.hit(`codes:${to}`, LIMITS.codesPerNumber);
    if (!perNumber.allowed) {
      return {
        ok: false,
        failure: { kind: 'too_many_requests', retryAfterSeconds: perNumber.retryAfterSeconds },
      };
    }
    try {
      const challenge = await this.deps.api.otp.send(
        {
          to,
          mode: 'managed',
          template_name: this.deps.template,
          ...(this.deps.phoneNumberId === null ? {} : { phone_number_id: this.deps.phoneNumberId }),
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (challenge.id === null) {
        return { ok: false, failure: { kind: 'unavailable' } };
      }
      const sentAt = this.deps.now();
      this.deps.kv.set(`last-sent:${to}`, sentAt.toISOString());
      return {
        ok: true,
        challenge: {
          id: challenge.id,
          sentAt: sentAt.toISOString(),
          expiresAt:
            challenge.expires_at ?? new Date(sentAt.getTime() + CODE_TTL_MINUTES * 60_000).toISOString(),
        },
      };
    } catch (error) {
      const failure = classifyOtpError(error);
      if (failure.kind === 'cooldown') {
        this.deps.kv.set(
          `last-sent:${to}`,
          new Date(
            this.deps.now().getTime() - (RESEND_COOLDOWN_SECONDS - failure.retryAfterSeconds) * 1000,
          ).toISOString(),
        );
      }
      return { ok: false, failure };
    }
  }

  /** Checks `code` against challenge `id`. Wrong codes count towards the per-number lock-out. */
  async verify(input: {
    readonly id: string;
    readonly to: string;
    readonly code: string;
  }): Promise<VerifyOutcome> {
    if (this.isLocked(input.to)) {
      return { ok: false, failure: { kind: 'locked' } };
    }
    try {
      const result = await this.deps.api.otp.verify({ id: input.id, code: input.code });
      if (result.status !== 'verified') {
        return { ok: false, failure: { kind: 'unavailable' } };
      }
      return { ok: true, verifiedAt: result.verified_at ?? this.deps.now().toISOString() };
    } catch (error) {
      const failure = classifyOtpError(error);
      if (failure.kind === 'invalid') {
        this.guard.hit(`wrong:${input.to}`, LIMITS.wrongCodesPerNumber);
        if (this.isLocked(input.to)) {
          return { ok: false, failure: { kind: 'locked' } };
        }
      }
      return { ok: false, failure };
    }
  }
}
