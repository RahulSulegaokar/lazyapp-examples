import { randomUUID } from 'node:crypto';
import { errorFromResponse, LazyAppError, LazyAppNetworkError, LazyAppRateLimitError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** Query string parameters (an object of `QueryValue`s). `undefined` and `null` values are dropped. */
  readonly query?: object | undefined;
  /** JSON body. */
  readonly body?: unknown;
  /**
   * Makes the write safe to retry: LazyApp replays the first response for the same key.
   * Writes without one get a random key, so the client's own retries never double-send.
   * Pass a deterministic key (e.g. derived from the inbound event id) to make replays safe too.
   */
  readonly idempotencyKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  /**
   * Extra request headers, e.g. `X-LazyApp-Customer` to act for a platform customer.
   * `Authorization`, `Idempotency-Key` and the content headers cannot be overridden.
   */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Overrides the client's default timeout for this call. */
  readonly timeoutMs?: number | undefined;
}

export interface TransportOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  readonly userAgent: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
  readonly onRequest?: ((event: RequestEvent) => void) | undefined;
}

/** Emitted once per HTTP attempt; wire it to your logger or metrics. */
export interface RequestEvent {
  readonly method: HttpMethod;
  readonly path: string;
  readonly attempt: number;
  readonly status: number | undefined;
  readonly durationMs: number;
  readonly requestId: string | undefined;
  readonly error?: Error | undefined;
}

const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'PUT', 'DELETE']);

/**
 * The single place HTTP happens. Retries 409/429/5xx and network failures with
 * exponential backoff and full jitter, honouring `Retry-After`.
 */
export class HttpTransport {
  constructor(private readonly options: TransportOptions) {}

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const idempotencyKey =
      options.idempotencyKey ?? (IDEMPOTENT_METHODS.has(method) ? undefined : randomUUID());
    const headers: Record<string, string> = {
      ...extraHeaders(options.headers),
      Authorization: `Bearer ${this.options.apiKey}`,
      Accept: 'application/json',
      'User-Agent': this.options.userAgent,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        const response = await this.send(url, method, headers, body, options);
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const payload = await decodeBody(response);
        this.emit({ method, path, attempt, status: response.status, startedAt, requestId });

        if (response.ok) {
          return payload as T;
        }

        const error = errorFromResponse(response.status, payload, {
          method,
          path,
          requestId,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        });
        if (!this.shouldRetry(error, attempt)) {
          throw error;
        }
        await this.options.sleep(this.backoff(attempt, error));
      } catch (caught) {
        if (caught instanceof LazyAppError) {
          throw caught;
        }
        const error = toNetworkError(caught, method, path, options.signal);
        this.emit({ method, path, attempt, status: undefined, startedAt, requestId: undefined, error });
        if (options.signal?.aborted === true || !this.shouldRetry(error, attempt)) {
          throw error;
        }
        await this.options.sleep(this.backoff(attempt, error));
      }
    }
  }

  private async send(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | undefined,
    options: RequestOptions,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.options.timeoutMs);
    const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
    return this.options.fetch(url, { method, headers, body: body ?? null, signal });
  }

  /**
   * Every write carries an Idempotency-Key (caller's or generated), so repeating a
   * retryable failure can never act twice; the only question is the budget.
   */
  private shouldRetry(error: LazyAppError | LazyAppNetworkError, attempt: number): boolean {
    return attempt <= this.options.maxRetries && error.retryable;
  }

  /** Full-jitter exponential backoff, capped at 20s; `Retry-After` wins when present. */
  private backoff(attempt: number, error: LazyAppError | LazyAppNetworkError): number {
    if (error instanceof LazyAppRateLimitError && error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, 60_000);
    }
    const ceiling = Math.min(20_000, 250 * 2 ** attempt);
    return Math.round(this.options.random() * ceiling);
  }

  private buildUrl(path: string, query: RequestOptions['query']): string {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(query ?? {}) as [string, QueryValue][]) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private emit(event: {
    method: HttpMethod;
    path: string;
    attempt: number;
    status: number | undefined;
    startedAt: number;
    requestId: string | undefined;
    error?: Error;
  }): void {
    this.options.onRequest?.({
      method: event.method,
      path: event.path,
      attempt: event.attempt,
      status: event.status,
      durationMs: Date.now() - event.startedAt,
      requestId: event.requestId,
      error: event.error,
    });
  }
}

const RESERVED_HEADERS = new Set([
  'authorization',
  'idempotency-key',
  'content-type',
  'accept',
  'user-agent',
]);

/** Caller-supplied headers minus the ones the transport owns (compared case-insensitively). */
function extraHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => !RESERVED_HEADERS.has(name.toLowerCase())),
  );
}

async function decodeBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null || header.trim() === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function toNetworkError(
  caught: unknown,
  method: string,
  path: string,
  signal: AbortSignal | undefined,
): LazyAppNetworkError {
  const timedOut =
    caught instanceof DOMException && caught.name === 'TimeoutError' && signal?.aborted !== true;
  const message = timedOut
    ? `LazyApp did not answer ${method} ${path} in time`
    : `Could not reach LazyApp for ${method} ${path}: ${caught instanceof Error ? caught.message : String(caught)}`;
  return new LazyAppNetworkError(message, { method, path, timedOut, cause: caught });
}
