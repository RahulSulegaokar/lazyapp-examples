import { randomBytes } from 'node:crypto';
import { htmlResponse, jsonResponse } from '@lazyapp-examples/demo-kit';
import type { KeyValueStore, WebContext, WebRoute } from '@lazyapp-examples/demo-kit';
import { z } from 'zod';
import { LoginCodes } from './codes.js';
import type { IssuedChallenge } from './codes.js';
import { webFailure } from './copy.js';
import { LIMITS, RateGuard } from './guard.js';
import { maskPhone, parsePhone } from './otp.js';
import { renderSignInPage } from './page.js';
import type { OtpState } from './state.js';

/** How long the chat's "Open login page" link works. */
export const TICKET_TTL_MS = 15 * 60_000;
/** How long one sign-in attempt (identify → send → verify) may take. */
const ATTEMPT_TTL_MS = 15 * 60_000;
/** Web session lifetime after a successful sign-in. */
const SESSION_TTL_MS = 12 * 60 * 60_000;
const COOKIE = 'lz_otp_demo';

interface Expiring {
  readonly expiresAt: string;
}
interface TicketRecord extends Expiring {
  readonly address: string;
}
interface AttemptRecord extends Expiring {
  readonly address: string;
  readonly sends: number;
  readonly challenge: IssuedChallenge | null;
}
interface WebChallengeRecord {
  readonly address: string;
  readonly attemptId: string;
}
interface WebSessionRecord extends Expiring {
  readonly address: string;
  readonly createdAt: string;
}

/**
 * Everything the sign-in page keeps, in the example's key-value store. Tokens are random
 * 144-bit values: the URL ticket and the cookie carry no personal data.
 */
export class SignInStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => Date,
  ) {}

  saveTicket(ticket: string, address: string): void {
    this.kv.set(`ticket:${ticket}`, { address, expiresAt: this.later(TICKET_TTL_MS) } satisfies TicketRecord);
  }

  ticket(ticket: string): TicketRecord | undefined {
    return this.live<TicketRecord>(`ticket:${ticket}`);
  }

  createAttempt(address: string): string {
    const id = token();
    this.kv.set(`attempt:${id}`, {
      address,
      sends: 0,
      challenge: null,
      expiresAt: this.later(ATTEMPT_TTL_MS),
    } satisfies AttemptRecord);
    return id;
  }

  attempt(id: string): AttemptRecord | undefined {
    return this.live<AttemptRecord>(`attempt:${id}`);
  }

  saveAttempt(id: string, attempt: AttemptRecord): void {
    this.kv.set(`attempt:${id}`, attempt);
    if (attempt.challenge !== null) {
      this.kv.set(`web-challenge:${attempt.challenge.id}`, {
        address: attempt.address,
        attemptId: id,
      } satisfies WebChallengeRecord);
    }
  }

  deleteAttempt(id: string): void {
    this.kv.delete(`attempt:${id}`);
  }

  /** The web attempt that created challenge `uuid`, if any (chat challenges are not recorded here). */
  webChallenge(uuid: string): WebChallengeRecord | undefined {
    return this.kv.get<WebChallengeRecord>(`web-challenge:${uuid}`);
  }

  createSession(address: string): string {
    const id = token();
    this.kv.set(`session:${id}`, {
      address,
      createdAt: this.now().toISOString(),
      expiresAt: this.later(SESSION_TTL_MS),
    } satisfies WebSessionRecord);
    const index = this.kv.get<string[]>(`sessions:${address}`) ?? [];
    this.kv.set(`sessions:${address}`, [...index.slice(-9), id]);
    return id;
  }

  session(id: string): WebSessionRecord | undefined {
    return this.live<WebSessionRecord>(`session:${id}`);
  }

  revoke(id: string): void {
    this.kv.delete(`session:${id}`);
  }

  /** Signs out every web session of `address`. Returns how many were still live. */
  revokeAll(address: string): number {
    const ids = this.kv.get<string[]>(`sessions:${address}`) ?? [];
    const live = ids.filter((id) => this.session(id) !== undefined).length;
    for (const id of ids) {
      this.revoke(id);
    }
    this.kv.delete(`sessions:${address}`);
    return live;
  }

  private live<T extends Expiring>(key: string): T | undefined {
    const value = this.kv.get<T>(key);
    if (value !== undefined && new Date(value.expiresAt) <= this.now()) {
      this.kv.delete(key);
      return undefined;
    }
    return value;
  }

  private later(ms: number): string {
    return new Date(this.now().getTime() + ms).toISOString();
  }
}

const token = (): string => randomBytes(18).toString('base64url');

const identifySchema = z.union([
  z.object({ ticket: z.string().min(10).max(64) }),
  z.object({ phone: z.string().min(6).max(32) }),
]);
const sendSchema = z.object({ attempt: z.string().min(10).max(64) });
const verifySchema = z.object({ attempt: z.string().min(10).max(64), code: z.string().regex(/^\d{4,10}$/) });

type Web = WebContext<OtpState>;

/**
 * The sign-in page and its JSON API. The page is public, so it never sends a code to a number that
 * is not in a live `DEMO OTP` chat: on a shared number, that is what keeps the demo from messaging
 * strangers, and it is a good pattern for any WhatsApp login (prove the chat exists first).
 */
export function webRoutes(template: string): readonly WebRoute<OtpState>[] {
  const services = (web: Web) => ({
    store: new SignInStore(web.kv, web.now),
    guard: new RateGuard(web.kv, web.now),
    codes: new LoginCodes({
      api: web.api,
      kv: web.kv,
      now: web.now,
      template,
      phoneNumberId: web.config.phoneNumberId,
    }),
  });

  return [
    {
      method: 'GET',
      path: '/',
      handler: async (web) =>
        htmlResponse(
          renderSignInPage({ startCode: web.example.startCode, basePath: new URL(web.baseUrl).pathname }),
        ),
    },
    {
      method: 'GET',
      path: '/api/me',
      handler: async (web, request) => {
        const session = sessionFromCookie(web, request);
        return jsonResponse(
          session === undefined
            ? { signedIn: false }
            : { signedIn: true, number: maskPhone(session.address) },
        );
      },
    },
    {
      method: 'POST',
      path: '/api/identify',
      handler: async (web, request) => {
        const body = await readJson(request, identifySchema);
        if (body === null) {
          return jsonResponse({ error: 'bad_request', message: 'Enter a valid phone number.' }, 400);
        }
        const { store, guard } = services(web);
        const lookups = guard.hit(`ip-lookups:${web.clientIp}`, LIMITS.lookupsPerIp);
        if (!lookups.allowed) {
          return tooMany(lookups.retryAfterSeconds);
        }
        const address = 'ticket' in body ? store.ticket(body.ticket)?.address : parsePhone(body.phone);
        if (address === undefined || address === null) {
          return jsonResponse(
            'ticket' in body
              ? {
                  error: 'link_expired',
                  message: 'This sign-in link has expired. Tap Sign in on web in the chat for a new one.',
                }
              : {
                  error: 'bad_phone',
                  message: 'Enter a mobile number, e.g. 98765 43210 or +44 7700 900123.',
                },
            422,
          );
        }
        if (web.session(address) === null) {
          return jsonResponse(
            {
              error: 'not_in_demo',
              message: `For this demo, first send ${web.example.startCode} to the LazyApp demo number on WhatsApp, then try again.`,
              startCode: web.example.startCode,
            },
            403,
          );
        }
        const attempt = store.createAttempt(address);
        return jsonResponse({
          attempt,
          number: maskPhone(address),
          resendAfter: services(web).codes.cooldownSeconds(address),
        });
      },
    },
    {
      method: 'POST',
      path: '/api/send',
      handler: async (web, request) => {
        const body = await readJson(request, sendSchema);
        const { store, codes } = services(web);
        const attempt = body === null ? undefined : store.attempt(body.attempt);
        if (body === null || attempt === undefined) {
          return expiredAttempt();
        }
        if (web.session(attempt.address) === null) {
          return jsonResponse(
            {
              error: 'not_in_demo',
              message: `Your ${web.example.startCode} chat has ended. Send it again to continue.`,
            },
            403,
          );
        }
        const outcome = await codes.send({
          to: attempt.address,
          ip: web.clientIp,
          idempotencyKey: `otp-login:web:${body.attempt}:${attempt.sends + 1}`,
        });
        if (!outcome.ok) {
          const failure = webFailure(outcome.failure);
          const retry =
            'retryAfterSeconds' in outcome.failure ? outcome.failure.retryAfterSeconds : undefined;
          return jsonResponse(
            {
              error: outcome.failure.kind,
              message: failure.message,
              ...(retry === undefined ? {} : { retryAfter: retry }),
            },
            failure.status,
            retry === undefined ? {} : { 'retry-after': String(retry) },
          );
        }
        store.saveAttempt(body.attempt, {
          ...attempt,
          sends: attempt.sends + 1,
          challenge: outcome.challenge,
        });
        web.log.info('web sign-in code sent', { challenge: outcome.challenge.id });
        return jsonResponse({
          expiresAt: outcome.challenge.expiresAt,
          resendAfter: codes.cooldownSeconds(attempt.address),
        });
      },
    },
    {
      method: 'POST',
      path: '/api/verify',
      handler: async (web, request) => {
        const body = await readJson(request, verifySchema);
        if (body === null) {
          return jsonResponse({ error: 'bad_code', message: 'Enter the digits from WhatsApp.' }, 400);
        }
        const { store, codes } = services(web);
        const attempt = store.attempt(body.attempt);
        if (attempt?.challenge === null || attempt === undefined) {
          return expiredAttempt();
        }
        const outcome = await codes.verify({
          id: attempt.challenge.id,
          to: attempt.address,
          code: body.code,
        });
        if (!outcome.ok) {
          const failure = webFailure(outcome.failure);
          return jsonResponse({ error: outcome.failure.kind, message: failure.message }, failure.status);
        }
        store.deleteAttempt(body.attempt);
        const session = store.createSession(attempt.address);
        return jsonResponse({ signedIn: true, number: maskPhone(attempt.address) }, 200, {
          'set-cookie': `${COOKIE}=${session}; Path=/x/otp-login; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
        });
      },
    },
    {
      method: 'POST',
      path: '/api/signout',
      handler: async (web, request) => {
        const id = cookieValue(request, COOKIE);
        if (id !== null) {
          new SignInStore(web.kv, web.now).revoke(id);
        }
        return jsonResponse({ signedIn: false }, 200, {
          'set-cookie': `${COOKIE}=; Path=/x/otp-login; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        });
      },
    },
  ];
}

function sessionFromCookie(web: Web, request: Request): WebSessionRecord | undefined {
  const id = cookieValue(request, COOKIE);
  return id === null ? undefined : new SignInStore(web.kv, web.now).session(id);
}

/** Parses a JSON body. Only `application/json` is accepted, so a cross-site form cannot post here. */
async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return null;
  }
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      const value = rest.join('=');
      return value === '' ? null : value;
    }
  }
  return null;
}

function tooMany(retryAfter: number): Response {
  return jsonResponse(
    {
      error: 'too_many_requests',
      message: 'Too many attempts from this network. Try again later.',
      retryAfter,
    },
    429,
    { 'retry-after': String(retryAfter) },
  );
}

function expiredAttempt(): Response {
  return jsonResponse({ error: 'attempt_expired', message: 'This sign-in timed out. Start again.' }, 410);
}
