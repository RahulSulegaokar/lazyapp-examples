import { LazyAppRateLimitError, LazyAppServerError, LazyAppValidationError } from '@lazyapp-examples/sdk';
import { describe, expect, it } from 'vitest';
import { buildManifest, otpTemplateName, readConfig, TEMPLATES } from '../src/manifest.js';
import { classifyOtpError, extractCode, maskPhone, parsePhone } from '../src/otp.js';

const refusal = (message: string, status = 422) =>
  new LazyAppValidationError(message, { status, method: 'POST', path: '/v1/otp' });

describe('otp helpers', () => {
  it.each([
    ['482913', '482913'],
    [' 482 913 ', '482913'],
    ['482-913', '482913'],
    ['1234', '1234'],
    ['123', null],
    ['12345678901', null],
    ['code 482913', null],
    ['', null],
  ])('extractCode(%j) → %j', (input, expected) => {
    expect(extractCode(input)).toBe(expected);
  });

  it.each([
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+44 7700 900123', '+447700900123'],
    ['+91 12345 67890', null],
    ['55555', null],
    ['hello', null],
  ])('parsePhone(%j) → %j', (input, expected) => {
    expect(parsePhone(input)).toBe(expected);
  });

  it('masks all but the country code and last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91 •••••• 3210');
    expect(maskPhone('+14155550123')).toBe('+1 •••••• 0123');
    expect(maskPhone('+123')).toBe('••••');
  });

  it("classifies LazyApp's OTP refusals", () => {
    expect(classifyOtpError(refusal('Wait 17 more second(s) before requesting another code.'))).toEqual({
      kind: 'cooldown',
      retryAfterSeconds: 17,
    });
    expect(classifyOtpError(refusal('Daily OTP limit reached for this recipient.'))).toEqual({
      kind: 'daily_limit',
    });
    expect(classifyOtpError(refusal('Invalid OTP code.'))).toEqual({ kind: 'invalid' });
    expect(classifyOtpError(refusal('OTP has expired.'))).toEqual({ kind: 'expired' });
    expect(classifyOtpError(refusal('Too many OTP attempts.'))).toEqual({ kind: 'locked' });
    expect(classifyOtpError(refusal('Too many failed attempts for this number. Try again later.'))).toEqual({
      kind: 'locked',
    });
    expect(classifyOtpError(refusal('No pending OTP challenge found.'))).toEqual({ kind: 'no_challenge' });
    expect(
      classifyOtpError(
        new LazyAppRateLimitError('Too Many Attempts.', {
          status: 429,
          method: 'POST',
          path: '/v1/otp',
          retryAfterMs: 4_200,
        }),
      ),
    ).toEqual({ kind: 'too_many_requests', retryAfterSeconds: 5 });
    expect(
      classifyOtpError(new LazyAppServerError('boom', { status: 500, method: 'POST', path: '/v1/otp' })),
    ).toEqual({
      kind: 'unavailable',
    });
    expect(classifyOtpError(new Error('anything'))).toEqual({ kind: 'unavailable' });
  });
});

describe('otp-login manifest', () => {
  it('provisions a copy-code template by default', () => {
    const config = readConfig({});
    const manifest = buildManifest(config);

    expect(otpTemplateName(config)).toBe(TEMPLATES.copyCode);
    expect(manifest.templates).toEqual([
      expect.objectContaining({
        kind: 'authentication',
        input: expect.objectContaining({
          name: 'demo_otp_login_code',
          otp_type: 'COPY_CODE',
          languages: ['en_US'],
        }),
      }),
    ]);
    expect(manifest.webhookEvents).toEqual(['otp.verified', 'otp.failed']);
  });

  it('adds a one-tap template when an Android app is configured', () => {
    const config = readConfig({
      OTP_LOGIN_ANDROID_PACKAGE: 'in.lazyapp.demo',
      OTP_LOGIN_ANDROID_SIGNATURE_HASH: 'K8a/AINcGX7',
    });

    expect(otpTemplateName(config)).toBe(TEMPLATES.oneTap);
    expect(buildManifest(config).templates?.[1]).toMatchObject({
      input: {
        name: 'demo_otp_login_one_tap',
        otp_type: 'ONE_TAP',
        package_name: 'in.lazyapp.demo',
        signature_hash: 'K8a/AINcGX7',
      },
    });
  });

  it('ignores a half-configured Android app', () => {
    expect(otpTemplateName(readConfig({ OTP_LOGIN_ANDROID_PACKAGE: 'in.lazyapp.demo' }))).toBe(
      TEMPLATES.copyCode,
    );
  });
});
