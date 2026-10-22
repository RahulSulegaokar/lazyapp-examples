/**
 * Every failure the client can raise. Branch on the class (or on `code`, which
 * LazyApp keeps stable) and never on `message`, which is display-only.
 *
 * @see https://lazyapp.in/docs/concepts/errors
 */

/** Stable refusal codes LazyApp returns on `422` / `402` sends. New ones may appear. */
export type LazyAppRefusalCode =
  | 'customer_service_window_closed'
  | 'contact_suppressed'
  | 'marketing_opt_out'
  | 'no_connection'
  | 'send_burst_limit'
  | 'recipient_rate_limit'
  | 'failure_rate_paused'
  | 'insufficient_credits'
  | 'service_credits_exhausted'
  | 'plan_message_allowance_exhausted'
  | 'brand_paused'
  | (string & {});

export interface LazyAppErrorDetails {
  readonly status: number;
  readonly code?: string | undefined;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly requestId?: string | undefined;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** Base class: an HTTP response LazyApp answered with a non-2xx status. */
export class LazyAppError extends Error {
  readonly status: number;
  readonly code: LazyAppRefusalCode | undefined;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly requestId: string | undefined;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(message: string, details: LazyAppErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.status = details.status;
    this.code = details.code;
    this.fieldErrors = details.fieldErrors ?? {};
    this.requestId = details.requestId;
    this.method = details.method;
    this.path = details.path;
    this.body = details.body;
  }

  /** True when retrying the identical request can succeed (with the same Idempotency-Key). */
  get retryable(): boolean {
    return false;
  }
}

/** 401 / 403: bad key, missing scope, or a key restricted from this number. */
export class LazyAppAuthError extends LazyAppError {}

/** 404: not found in this workspace. */
export class LazyAppNotFoundError extends LazyAppError {}

/** 409: an idempotent request with the same key is still running. */
export class LazyAppConflictError extends LazyAppError {
  override get retryable(): boolean {
    return true;
  }
}

/** 422 without a refusal `code`: the request body failed validation. See `fieldErrors`. */
export class LazyAppValidationError extends LazyAppError {}

/**
 * 402 / 422 with a stable `code`: LazyApp refused the send on policy grounds
 * (closed 24h window, opt-out, velocity guard, empty wallet…). Never retry blindly.
 */
export class LazyAppRefusalError extends LazyAppError {
  get isWindowClosed(): boolean {
    return this.code === 'customer_service_window_closed';
  }

  get isOptOut(): boolean {
    return this.code === 'contact_suppressed' || this.code === 'marketing_opt_out';
  }

  get isVelocityLimit(): boolean {
    return (
      this.code === 'send_burst_limit' ||
      this.code === 'recipient_rate_limit' ||
      this.code === 'failure_rate_paused'
    );
  }
}

/** 429: the per-key request budget is spent. `retryAfterMs` comes from `Retry-After`. */
export class LazyAppRateLimitError extends LazyAppError {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, details: LazyAppErrorDetails & { retryAfterMs?: number | undefined }) {
    super(message, details);
    this.retryAfterMs = details.retryAfterMs;
  }

  override get retryable(): boolean {
    return true;
  }
}

/** 5xx: LazyApp or the provider is unhealthy. */
export class LazyAppServerError extends LazyAppError {
  override get retryable(): boolean {
    return true;
  }
}

/** The request never got an HTTP answer: DNS, TLS, reset, or the client-side timeout. */
export class LazyAppNetworkError extends Error {
  readonly method: string;
  readonly path: string;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: { method: string; path: string; timedOut: boolean; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'LazyAppNetworkError';
    this.method = options.method;
    this.path = options.path;
    this.timedOut = options.timedOut;
  }

  get retryable(): boolean {
    return true;
  }
}

/** Maps an HTTP status and decoded body onto the right error class. */
export function errorFromResponse(
  status: number,
  body: unknown,
  context: {
    method: string;
    path: string;
    requestId?: string | undefined;
    retryAfterMs?: number | undefined;
  },
): LazyAppError {
  const record = isRecord(body) ? body : {};
  const message =
    typeof record.message === 'string' && record.message !== '' ? record.message : `HTTP ${status}`;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const fieldErrors = parseFieldErrors(record.errors);
  const details: LazyAppErrorDetails = {
    status,
    code,
    fieldErrors,
    requestId: context.requestId,
    method: context.method,
    path: context.path,
    body,
  };

  if (status === 401 || status === 403) {
    return new LazyAppAuthError(message, details);
  }
  if (status === 404) {
    return new LazyAppNotFoundError(message, details);
  }
  if (status === 409) {
    return new LazyAppConflictError(message, details);
  }
  if (status === 429) {
    return new LazyAppRateLimitError(message, { ...details, retryAfterMs: context.retryAfterMs });
  }
  if (status === 402 || (status === 422 && code !== undefined)) {
    return new LazyAppRefusalError(message, details);
  }
  if (status === 422 || status === 400) {
    return new LazyAppValidationError(message, details);
  }
  if (status >= 500) {
    return new LazyAppServerError(message, details);
  }
  return new LazyAppError(message, details);
}

function parseFieldErrors(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(value)) {
    if (Array.isArray(messages)) {
      result[field] = messages.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
