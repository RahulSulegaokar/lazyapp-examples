import type { OtpFailure } from './otp.js';
import { humanSeconds } from './otp.js';

/** What to tell a person in the chat when a code could not be sent or checked. */
export function failureText(failure: OtpFailure): string {
  switch (failure.kind) {
    case 'cooldown':
      return `⏳ A code was sent moments ago. You can ask for a new one in ${humanSeconds(failure.retryAfterSeconds)}: the cool-off stops anyone flooding your phone with codes.`;
    case 'too_many_requests':
      return `⏳ That's a lot of codes for one number. Try again in ${humanSeconds(failure.retryAfterSeconds)}.`;
    case 'daily_limit':
      return "This number has had today's quota of codes. Try again tomorrow.";
    case 'invalid':
      return "That code didn't match. Check you are using the newest code.";
    case 'expired':
      return '⌛ That code has expired (codes last 10 minutes). Ask for a new one.';
    case 'locked':
      return '🔒 Too many wrong codes for this number, so verification is paused for a while.';
    case 'no_challenge':
      return 'That code was already used, or a newer code replaced it. Ask for a new one.';
    case 'opted_out':
      return 'This number has opted out of messages from this business, so no code can be sent.';
    case 'unavailable':
      return "LazyApp couldn't handle the code just now. Try again in a moment.";
  }
}

/** The same, for the web page (no WhatsApp formatting). Includes an HTTP status for the API response. */
export function webFailure(failure: OtpFailure): { readonly status: number; readonly message: string } {
  switch (failure.kind) {
    case 'cooldown':
      return {
        status: 429,
        message: `A code was just sent. You can resend in ${humanSeconds(failure.retryAfterSeconds)}.`,
      };
    case 'too_many_requests':
      return {
        status: 429,
        message: `Too many codes requested. Try again in ${humanSeconds(failure.retryAfterSeconds)}.`,
      };
    case 'daily_limit':
      return { status: 429, message: 'This number has reached its daily limit of codes.' };
    case 'invalid':
      return { status: 422, message: "That code didn't match. Check the newest message on WhatsApp." };
    case 'expired':
      return { status: 410, message: 'That code has expired. Send a new one.' };
    case 'locked':
      return { status: 423, message: 'Too many wrong codes. Sign-in is paused for this number for a while.' };
    case 'no_challenge':
      return { status: 410, message: 'That code was already used or replaced. Send a new one.' };
    case 'opted_out':
      return { status: 403, message: 'This number has opted out of WhatsApp messages from this business.' };
    case 'unavailable':
      return { status: 503, message: 'The code service is busy. Try again in a moment.' };
  }
}
