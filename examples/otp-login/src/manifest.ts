import type { ExampleManifest, TemplateSpec } from '@lazyapp-examples/demo-kit';

/**
 * Authentication templates. LazyApp's `POST /v1/otp` sends them in the language set by the
 * workspace's OTP configuration (`en_US` by default), so they are created in `en_US`.
 */
export const TEMPLATES = {
  copyCode: 'demo_otp_login_code',
  oneTap: 'demo_otp_login_one_tap',
} as const;

export const OTP_LANGUAGE = 'en_US';

/** How long a code lives. Mirrors the template's `code_expiration_minutes` and LazyApp's OTP TTL. */
export const CODE_TTL_MINUTES = 10;

export interface OtpLoginConfig {
  /** Android package that receives one-tap autofill, e.g. `in.lazyapp.demo`. */
  readonly androidPackage: string | undefined;
  /** 11-character app signing key hash (see the README). */
  readonly androidSignatureHash: string | undefined;
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): OtpLoginConfig {
  const value = (key: string): string | undefined => {
    const raw = env[key]?.trim();
    return raw === undefined || raw === '' ? undefined : raw;
  };
  return {
    androidPackage: value('OTP_LOGIN_ANDROID_PACKAGE'),
    androidSignatureHash: value('OTP_LOGIN_ANDROID_SIGNATURE_HASH'),
  };
}

/** One-tap autofill needs both the Android package and its signature hash. */
export function oneTapEnabled(config: OtpLoginConfig): boolean {
  return config.androidPackage !== undefined && config.androidSignatureHash?.length === 11;
}

/** The template `POST /v1/otp` should use. */
export function otpTemplateName(config: OtpLoginConfig): string {
  return oneTapEnabled(config) ? TEMPLATES.oneTap : TEMPLATES.copyCode;
}

export function buildManifest(config: OtpLoginConfig): ExampleManifest {
  const templates: TemplateSpec[] = [
    {
      kind: 'authentication',
      purpose: 'Copy-code login code: the body, security note and expiry line are fixed by Meta.',
      input: {
        name: TEMPLATES.copyCode,
        languages: [OTP_LANGUAGE],
        otp_type: 'COPY_CODE',
        add_security_recommendation: true,
        code_expiration_minutes: CODE_TTL_MINUTES,
        // A login code that arrives after 10 minutes is useless: let Meta drop it instead of billing it.
        message_send_ttl_seconds: CODE_TTL_MINUTES * 60,
      },
    },
  ];
  if (oneTapEnabled(config) && config.androidPackage !== undefined) {
    templates.push({
      kind: 'authentication',
      purpose: 'One-tap autofill for the Android app (falls back to a copy-code button on other devices).',
      input: {
        name: TEMPLATES.oneTap,
        languages: [OTP_LANGUAGE],
        otp_type: 'ONE_TAP',
        package_name: config.androidPackage,
        ...(config.androidSignatureHash === undefined ? {} : { signature_hash: config.androidSignatureHash }),
        add_security_recommendation: true,
        code_expiration_minutes: CODE_TTL_MINUTES,
        message_send_ttl_seconds: CODE_TTL_MINUTES * 60,
      },
    });
  }
  return {
    templates,
    webhookEvents: ['otp.verified', 'otp.failed'],
    requires: { catalog: 'none', payments: 'none' },
    command: { name: 'otp', description: 'WhatsApp login codes: verify in chat or sign in on the web' },
    qrPrefill: 'DEMO OTP',
  };
}
