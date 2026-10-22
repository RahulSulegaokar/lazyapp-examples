import {
  LazyAppError,
  LazyAppNetworkError,
  LazyAppRateLimitError,
  LazyAppRefusalError,
} from '@lazyapp-examples/sdk';

/**
 * What went wrong with an OTP call, in terms the conversation and the web page can act on.
 *
 * LazyApp's `/v1/otp` and `/v1/otp/verify` refuse with `422 { message }` and no machine-readable
 * `code` (see the README's platform gaps), so this maps the documented messages. Anything unknown
 * becomes `unavailable`, which is always safe to show.
 */
export type OtpFailure =
  | { readonly kind: 'cooldown'; readonly retryAfterSeconds: number }
  | { readonly kind: 'daily_limit' }
  | { readonly kind: 'too_many_requests'; readonly retryAfterSeconds: number }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'no_challenge' }
  | { readonly kind: 'opted_out' }
  | { readonly kind: 'unavailable' };

export function classifyOtpError(error: unknown): OtpFailure {
  if (error instanceof LazyAppRateLimitError) {
    return { kind: 'too_many_requests', retryAfterSeconds: Math.ceil((error.retryAfterMs ?? 60_000) / 1000) };
  }
  if (error instanceof LazyAppRefusalError && error.isOptOut) {
    return { kind: 'opted_out' };
  }
  if (error instanceof LazyAppNetworkError || !(error instanceof LazyAppError) || error.status !== 422) {
    return { kind: 'unavailable' };
  }
  const message = error.message.toLowerCase();
  const wait = /wait (\d+) more second/.exec(message);
  if (wait !== null) {
    return { kind: 'cooldown', retryAfterSeconds: Number(wait[1]) };
  }
  if (message.includes('daily otp limit')) {
    return { kind: 'daily_limit' };
  }
  if (message.includes('too many verification requests')) {
    return { kind: 'too_many_requests', retryAfterSeconds: 3600 };
  }
  if (message.includes('too many otp attempts') || message.includes('too many failed attempts')) {
    return { kind: 'locked' };
  }
  if (message.includes('expired')) {
    return { kind: 'expired' };
  }
  if (message.includes('invalid otp')) {
    return { kind: 'invalid' };
  }
  if (message.includes('no pending otp')) {
    return { kind: 'no_challenge' };
  }
  if (message.includes('suppress') || message.includes('opted out')) {
    return { kind: 'opted_out' };
  }
  return { kind: 'unavailable' };
}

/**
 * The code in a chat message: 4–10 digits, allowing the spaces or dashes people add when they
 * retype it ("482 913", "482-913"). Anything with letters is not a code.
 */
export function extractCode(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[\d\s-]+$/.test(trimmed)) {
    return null;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 4 && digits.length <= 10 ? digits : null;
}

/**
 * Parses what a visitor types into the phone field into E.164. Ten-digit Indian mobiles
 * (with or without 0 / 91 / +91) get `+91`; other countries need the `+` and country code.
 */
export function parsePhone(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, '');
  if (/^\+\d{8,15}$/.test(compact)) {
    return compact.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(compact) ? null : compact;
  }
  const digits = compact.replace(/^0+/, '');
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  if (/^91[6-9]\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

/** `+919812345670` → `+91 •••••• 5670`. Enough to recognise your own number, useless to anyone else. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 8) {
    return '••••';
  }
  const country =
    digits.startsWith('91') && digits.length === 12 ? '91' : digits.slice(0, digits.length - 10 || 1);
  const hidden = digits.length - country.length - 4;
  return `+${country} ${'•'.repeat(Math.max(hidden, 2))} ${digits.slice(-4)}`;
}

/** Whole seconds from `now` until `iso` (never negative). */
export function secondsUntil(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 1000));
}

const IST_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `4:07 pm` in India time. */
export function formatIstTime(date: Date): string {
  return IST_TIME.format(date).replace(
    /\s?([AP]M)$/i,
    (_match, meridiem: string) => ` ${meridiem.toLowerCase()}`,
  );
}

/** "30 seconds", "1 minute", "5 minutes": for cooldown messages. */
export function humanSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
