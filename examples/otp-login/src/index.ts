import { randomBytes } from 'node:crypto';
import { DEMO_FOOTER, defineExample, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import type { DemoEvent, ExampleContext } from '@lazyapp-examples/demo-kit';
import { LoginCodes } from './codes.js';
import { failureText } from './copy.js';
import { buildManifest, CODE_TTL_MINUTES, otpTemplateName, readConfig } from './manifest.js';
import { extractCode, formatIstTime, maskPhone } from './otp.js';
import { initialOtpState, otpStateSchema } from './state.js';
import type { OtpState } from './state.js';
import { SignInStore, TICKET_TTL_MS, webRoutes } from './web.js';

type Ctx = ExampleContext<OtpState>;

const config = readConfig(process.env);
const template = otpTemplateName(config);

/** Codes one chat session may request, and wrong codes per challenge before chat verification pauses. */
const MAX_CODES_PER_SESSION = 3;
const MAX_WRONG_CODES = 3;
const CHAT_LOCK_MS = 15 * 60_000;

const IDS = {
  chat: 'otp:chat',
  resend: 'otp:resend',
  web: 'otp:web',
  how: 'otp:how',
  notMe: 'otp:not-me',
} as const;

const codesFor = (ctx: Ctx): LoginCodes =>
  new LoginCodes({
    api: ctx.api,
    kv: ctx.kv,
    now: ctx.now,
    template,
    phoneNumberId: ctx.config.phoneNumberId,
  });

/**
 * WhatsApp login, end to end: LazyApp's managed OTP (`POST /v1/otp` + `/v1/otp/verify`) with an
 * authentication template, used two ways: verifying inside the chat, and a real web sign-in page
 * served by the demo server. The `otp.verified` / `otp.failed` webhooks drive "new sign-in" alerts.
 */
export default defineExample<OtpState>({
  id: 'otp-login',
  title: 'Login with WhatsApp',
  startCode: 'DEMO OTP',
  manifest: buildManifest(config),
  stateSchema: otpStateSchema,
  initialState: initialOtpState,
  describe: () => ({
    summary: 'One-time codes on WhatsApp: verify in chat or sign in on a web page, with fraud guards.',
    metaFeatures: [
      'Authentication template (copy code)',
      'One-tap autofill (Android)',
      'OTP send + verify',
      'CTA URL button',
      'Reply buttons',
      'Reactions',
      'Typing indicator',
      'Webhooks (otp.verified, otp.failed)',
    ],
    emoji: '🔐',
  }),

  async onStart(ctx) {
    const name = ctx.user.displayName === null ? '' : ` ${ctx.user.displayName}`;
    await menu(
      ctx,
      `Hi${name}! This demo signs you in with a one-time code on WhatsApp, the way banks and delivery apps do.\n\n` +
        '• *Verify in chat*: get a code here and type it back.\n' +
        '• *Sign in on web*: open a login page, get the code on WhatsApp, enter it there.\n\n' +
        "Codes come from LazyApp's managed OTP: it generates, hashes, sends and expires them for you.",
    );
  },

  async onMenu(ctx) {
    await menu(ctx, 'What would you like to try?');
  },

  async onMessage(ctx, inbound) {
    switch (inbound.kind) {
      case 'button':
      case 'list':
        return onChoice(ctx, inbound.id);
      case 'text':
        return onText(ctx, inbound.text);
      default:
        return nudge(ctx);
    }
  },

  async onEvent(ctx, event) {
    if (event.type === 'otp.verified') {
      return onWebSignIn(ctx, event);
    }
    if (event.type === 'otp.failed') {
      return onWebWrongCode(ctx, event);
    }
  },

  web: webRoutes(template),
});

async function menu(ctx: Ctx, body: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: state.step === 'awaiting_code' ? 'awaiting_code' : 'menu' }));
  await ctx.send.buttons({
    header: '🔐 Login with WhatsApp',
    body,
    footer: DEMO_FOOTER,
    buttons: [
      { id: IDS.chat, title: 'Verify in chat' },
      { id: IDS.web, title: 'Sign in on web' },
      { id: IDS.how, title: 'How it works' },
    ],
  });
}

async function onChoice(ctx: Ctx, id: string): Promise<void> {
  switch (id) {
    case IDS.chat:
    case IDS.resend:
      return requestChatCode(ctx);
    case IDS.web:
      return sendWebLink(ctx);
    case IDS.how:
      return explain(ctx);
    case IDS.notMe:
      return signOutEverywhere(ctx);
    default:
      return menu(ctx, 'That button is from an older message. Here is the menu:');
  }
}

async function requestChatCode(ctx: Ctx): Promise<void> {
  const phone = ctx.user.phone;
  if (phone === null) {
    await ctx.send.text(
      'Login codes go to a phone number, and your WhatsApp account only shares a username with businesses. ' +
        'Real apps ask for the number first; try *Sign in on web* from a number-visible account.',
    );
    return;
  }
  const lockedUntil = ctx.state.lockedUntil === null ? null : new Date(ctx.state.lockedUntil);
  if (lockedUntil !== null && lockedUntil > ctx.now()) {
    await ctx.send.text(
      `🔒 Verification is paused until ${formatIstTime(lockedUntil)} after too many wrong codes. ` +
        'That pause is the fraud guard: it stops anyone guessing a code by brute force.',
    );
    return;
  }
  if (ctx.state.codesSent >= MAX_CODES_PER_SESSION) {
    await ctx.send.text(
      `You've had ${MAX_CODES_PER_SESSION} codes in this demo already. Every code costs the business an ` +
        'authentication message, so real apps cap them too. Type *EXIT* and start again later.',
    );
    return;
  }

  await ctx.send.typing();
  const outcome = await codesFor(ctx).send({
    to: phone,
    ip: null,
    idempotencyKey: ctx.idempotencyKey('otp-send'),
  });
  if (!outcome.ok) {
    await ctx.send.buttons({
      body: failureText(outcome.failure),
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.resend, title: 'Try again' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  ctx.setState((state) => ({
    ...state,
    step: 'awaiting_code',
    challenge: outcome.challenge,
    codesSent: state.codesSent + 1,
    wrongCodes: 0,
  }));
  await ctx.send.buttons({
    body:
      '📨 Your code is on its way: a separate message with a *Copy code* button.\n\n' +
      `Paste the digits here to verify. The code works once, for ${CODE_TTL_MINUTES} minutes.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: IDS.resend, title: 'Send a new code' },
      { id: RESERVED_IDS.menu, title: 'Cancel' },
    ],
  });
}

async function onText(ctx: Ctx, text: string): Promise<void> {
  const code = extractCode(text);
  if (ctx.state.step !== 'awaiting_code' || ctx.state.challenge === null) {
    if (code !== null) {
      await menu(ctx, 'There is no code waiting for you. Tap *Verify in chat* to get one.');
      return;
    }
    return nudge(ctx);
  }
  if (code === null) {
    await ctx.send.buttons({
      body: "That doesn't look like a code. Paste the digits from the message with the *Copy code* button.",
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.resend, title: 'Send a new code' },
        { id: RESERVED_IDS.menu, title: 'Cancel' },
      ],
    });
    return;
  }
  return verifyChatCode(ctx, code, ctx.state.challenge);
}

async function verifyChatCode(
  ctx: Ctx,
  code: string,
  challenge: NonNullable<OtpState['challenge']>,
): Promise<void> {
  const phone = ctx.user.phone ?? '';
  await ctx.send.typing();
  const outcome = await codesFor(ctx).verify({ id: challenge.id, to: phone, code });
  if (outcome.ok) {
    const seconds = Math.round((ctx.now().getTime() - new Date(challenge.sentAt).getTime()) / 1000);
    ctx.setState((state) => ({
      ...state,
      step: 'verified',
      challenge: null,
      wrongCodes: 0,
      verifiedAt: outcome.verifiedAt,
    }));
    await ctx.send.react('✅');
    await ctx.send.buttons({
      body:
        `Verified! You proved you own ${maskPhone(phone)} in ${seconds} seconds.\n\n` +
        "That's the whole flow: `POST /v1/otp` sends, `POST /v1/otp/verify` checks. " +
        'Next, try the web sign-in: the same API behind a real login page.',
      footer: DEMO_FOOTER,
      buttons: [
        { id: IDS.web, title: 'Sign in on web' },
        { id: IDS.how, title: 'How it works' },
      ],
    });
    return;
  }

  const failure = outcome.failure;
  if (failure.kind === 'invalid') {
    const wrong = ctx.state.wrongCodes + 1;
    if (wrong < MAX_WRONG_CODES) {
      ctx.setState((state) => ({ ...state, wrongCodes: wrong }));
      await ctx.send.react('❌');
      await ctx.send.text(
        `That code didn't match. ${MAX_WRONG_CODES - wrong} ${MAX_WRONG_CODES - wrong === 1 ? 'try' : 'tries'} ` +
          'left before verification pauses. Check you are using the newest code.',
      );
      return;
    }
  }
  if (failure.kind === 'invalid' || failure.kind === 'locked') {
    const until = new Date(ctx.now().getTime() + CHAT_LOCK_MS);
    ctx.setState((state) => ({
      ...state,
      step: 'menu',
      challenge: null,
      wrongCodes: 0,
      lockedUntil: until.toISOString(),
    }));
    await ctx.send.text(
      `🔒 Too many wrong codes, so verification is paused until ${formatIstTime(until)}. ` +
        'This is the fraud guard: guessing a 6-digit code by brute force needs many tries, and it never gets them.',
    );
    return;
  }
  if (failure.kind === 'expired' || failure.kind === 'no_challenge') {
    ctx.setState((state) => ({ ...state, step: 'menu', challenge: null }));
  }
  await ctx.send.buttons({
    body: failureText(failure),
    footer: DEMO_FOOTER,
    buttons: [
      { id: IDS.resend, title: 'Send a new code' },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

async function sendWebLink(ctx: Ctx): Promise<void> {
  const phone = ctx.user.phone;
  if (phone === null) {
    await ctx.send.text(
      'The web sign-in sends a code to your phone number, which your account does not share.',
    );
    return;
  }
  const ticket = randomBytes(18).toString('base64url');
  new SignInStore(ctx.kv, ctx.now).saveTicket(ticket, phone);
  await ctx.send.cta({
    header: 'Sign in on the web',
    body:
      `Open the demo login page. This link already knows your number (${maskPhone(phone)}) and works for ` +
      `${TICKET_TTL_MS / 60_000} minutes, so you only tap *Send code* and enter what arrives here.\n\n` +
      "When you sign in, I'll post a sign-in alert in this chat, like your bank does.",
    displayText: 'Open login page',
    url: `${ctx.config.publicBaseUrl}/x/otp-login/?t=${ticket}`,
    footer: DEMO_FOOTER,
  });
}

async function explain(ctx: Ctx): Promise<void> {
  await ctx.send.text(
    '*How WhatsApp login works*\n\n' +
      '1. Your server calls `POST /v1/otp` with the number. LazyApp creates the code, stores only a hash, and ' +
      'sends it with an approved *authentication template* (copy-code button, security note, expiry line).\n' +
      '2. The person pastes the code. You call `POST /v1/otp/verify` with the challenge id.\n' +
      '3. LazyApp answers `verified` and fires the `otp.verified` webhook (failures fire `otp.failed`).\n\n' +
      '*Guards in this demo*: 30-second resend cool-off · 5 codes per number per hour · 10 codes and 3 numbers ' +
      'per IP per hour · 5 wrong codes lock the number · codes expire in 10 minutes and work once.\n\n' +
      '*Android apps* can use one-tap autofill: an authentication template with `otp_type: ONE_TAP` fills the ' +
      'code straight into the app.',
  );
  await menu(ctx, 'Try it yourself:');
}

async function signOutEverywhere(ctx: Ctx): Promise<void> {
  const phone = ctx.user.phone;
  const revoked = phone === null ? 0 : new SignInStore(ctx.kv, ctx.now).revokeAll(phone);
  await ctx.send.react('🔒');
  await menu(
    ctx,
    `Done: ${revoked === 1 ? '1 web session was' : `${revoked} web sessions were`} signed out. ` +
      'In a real app this is also where you would reset trusted devices and alert the security team.',
  );
}

async function nudge(ctx: Ctx): Promise<void> {
  if (ctx.state.step === 'awaiting_code') {
    await ctx.send.text('Paste the code from the message with the *Copy code* button, or type *MENU*.');
    return;
  }
  await menu(ctx, "I didn't catch that. Pick one of these:");
}

/** `otp.verified` for a challenge the web page created: post a "new sign-in" alert. */
async function onWebSignIn(ctx: Ctx, event: DemoEvent): Promise<void> {
  const verification = verificationOf(event);
  const store = new SignInStore(ctx.kv, ctx.now);
  const challenge = verification === null ? undefined : store.webChallenge(verification.uuid);
  if (challenge?.address !== ctx.user.address) {
    return; // A chat verification (already answered) or someone else's code.
  }
  await ctx.send.buttons({
    header: '🔔 New sign-in',
    body:
      `Your number was just used to sign in to the *LazyApp demo* on the web (${formatIstTime(ctx.now())} IST).\n\n` +
      "If this was you, there's nothing to do. If not, sign that session out now.",
    footer: DEMO_FOOTER,
    buttons: [
      { id: IDS.notMe, title: "It wasn't me" },
      { id: RESERVED_IDS.menu, title: 'Main menu' },
    ],
  });
}

/** `otp.failed` on the web page: warn once per challenge after repeated wrong codes. */
async function onWebWrongCode(ctx: Ctx, event: DemoEvent): Promise<void> {
  const verification = verificationOf(event);
  if (verification === null || ctx.state.warnedChallenges.includes(verification.uuid)) {
    return;
  }
  const challenge = new SignInStore(ctx.kv, ctx.now).webChallenge(verification.uuid);
  if (challenge?.address !== ctx.user.address || verification.attempts < 2) {
    return;
  }
  ctx.setState((state) => ({
    ...state,
    warnedChallenges: [...state.warnedChallenges.slice(-19), verification.uuid],
  }));
  await ctx.send.text(
    `⚠️ Someone entered a wrong code for your number on the demo login page ` +
      `(${verification.attempts} of ${verification.maxAttempts} attempts). ` +
      "If that wasn't you, never share the code you receive: no real support team will ask for it.",
  );
}

function verificationOf(
  event: DemoEvent,
): { readonly uuid: string; readonly attempts: number; readonly maxAttempts: number } | null {
  const data = event.data.verification;
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  return typeof record.uuid === 'string'
    ? {
        uuid: record.uuid,
        attempts: typeof record.attempts === 'number' ? record.attempts : 0,
        maxAttempts: typeof record.max_attempts === 'number' ? record.max_attempts : 5,
      }
    : null;
}
