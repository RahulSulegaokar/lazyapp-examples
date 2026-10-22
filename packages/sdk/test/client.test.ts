import { describe, expect, it } from 'vitest';
import {
  LazyAppAuthError,
  LazyAppClient,
  LazyAppNetworkError,
  LazyAppNotFoundError,
  LazyAppRateLimitError,
  LazyAppRefusalError,
  LazyAppServerError,
  LazyAppValidationError,
  paginate,
  parseRetryAfter,
} from '../src/index.js';

interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

function fakeFetch(responses: (Response | Error)[]) {
  const calls: Recorded[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error('fakeFetch: no response queued');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(responses: (Response | Error)[], overrides: { maxRetries?: number } = {}) {
  const { fetchImpl, calls } = fakeFetch(responses);
  const sleeps: number[] = [];
  const lazyapp = new LazyAppClient({
    apiKey: 'sk_test_123',
    baseUrl: 'https://lazyapp.test',
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  });
  return { lazyapp, calls, sleeps };
}

const sent = { uuid: 'msg-1', status: 'sent', type: 'text' };

describe('LazyAppClient requests', () => {
  it('sends JSON with bearer auth and a generated Idempotency-Key on writes', async () => {
    const { lazyapp, calls } = client([json(201, sent)]);

    const result = await lazyapp.messages.text('+919812345670', 'Hello');

    expect(result.uuid).toBe('msg-1');
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.href).toBe('https://lazyapp.test/v1/messages');
    expect(call.headers.get('authorization')).toBe('Bearer sk_test_123');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.body).toEqual({ type: 'text', to: '+919812345670', body: 'Hello' });
  });

  it('uses the caller idempotency key and omits one on reads', async () => {
    const { lazyapp, calls } = client([json(201, sent), json(200, { data: [], next_cursor: null })]);

    await lazyapp.messages.text('+919812345670', 'Hi', {}, { idempotencyKey: 'evt_1:0' });
    await lazyapp.templates.list({ q: 'shop', limit: 5, cursor: undefined });

    expect(calls[0]!.headers.get('idempotency-key')).toBe('evt_1:0');
    expect(calls[1]!.headers.get('idempotency-key')).toBeNull();
    expect(calls[1]!.url.search).toBe('?q=shop&limit=5');
  });

  it('retries 429 honouring Retry-After with the same Idempotency-Key', async () => {
    const { lazyapp, calls, sleeps } = client([
      json(429, { message: 'Too Many Attempts.' }, { 'retry-after': '2' }),
      json(201, sent),
    ]);

    await lazyapp.messages.text('+919812345670', 'Hello');

    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
    expect(calls[1]!.headers.get('idempotency-key')).toBe(calls[0]!.headers.get('idempotency-key'));
  });

  it('retries 5xx and network failures with jittered exponential backoff', async () => {
    const { lazyapp, calls, sleeps } = client([
      json(503, { message: 'Provider unreachable' }),
      new TypeError('fetch failed'),
      json(201, sent),
    ]);

    await lazyapp.messages.text('+919812345670', 'Hello');

    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it('gives up after maxRetries and surfaces the last error', async () => {
    const { lazyapp, calls } = client(
      [json(500, { message: 'boom' }), json(500, { message: 'boom' }), json(500, { message: 'boom' })],
      { maxRetries: 2 },
    );

    await expect(lazyapp.messages.text('+919812345670', 'Hello')).rejects.toBeInstanceOf(LazyAppServerError);
    expect(calls).toHaveLength(3);
  });

  it('never retries policy refusals and exposes the stable code', async () => {
    const { lazyapp, calls } = client([
      json(422, {
        message: 'The customer service window is closed for this recipient.',
        code: 'customer_service_window_closed',
      }),
    ]);

    const error = await lazyapp.messages.text('+919812345670', 'Hello').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LazyAppRefusalError);
    expect((error as LazyAppRefusalError).isWindowClosed).toBe(true);
    expect((error as LazyAppRefusalError).retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('maps statuses onto typed errors', async () => {
    const cases: [Response, new (...args: never[]) => Error][] = [
      [json(401, { message: 'Unauthenticated.' }), LazyAppAuthError],
      [json(404, { message: 'Not found' }), LazyAppNotFoundError],
      [
        json(422, { message: 'Invalid', errors: { to: ['The to field format is invalid.'] } }),
        LazyAppValidationError,
      ],
      [json(402, { message: 'Top up', code: 'insufficient_credits' }), LazyAppRefusalError],
    ];
    for (const [response, type] of cases) {
      const { lazyapp } = client([response]);
      await expect(lazyapp.messages.text('+91', 'x')).rejects.toBeInstanceOf(type);
    }

    const { lazyapp } = client([json(422, { message: 'Invalid', errors: { to: ['bad'] } })]);
    const error = (await lazyapp.messages
      .text('+91', 'x')
      .catch((caught: unknown) => caught)) as LazyAppValidationError;
    expect(error.fieldErrors).toEqual({ to: ['bad'] });
  });

  it('exhausts retries on a persistent 429 as a rate-limit error', async () => {
    const { lazyapp } = client(
      [json(429, { message: 'slow down' }, { 'retry-after': '1' }), json(429, { message: 'slow down' })],
      { maxRetries: 1 },
    );

    await expect(lazyapp.messages.text('+91', 'x')).rejects.toBeInstanceOf(LazyAppRateLimitError);
  });

  it('wraps transport failures in LazyAppNetworkError', async () => {
    const { lazyapp } = client([new TypeError('ECONNRESET')], { maxRetries: 0 });

    const error = (await lazyapp.flows.list().catch((caught: unknown) => caught)) as LazyAppNetworkError;

    expect(error).toBeInstanceOf(LazyAppNetworkError);
    expect(error.timedOut).toBe(false);
    expect(error.message).toContain('ECONNRESET');
  });

  it('returns undefined for 204 responses', async () => {
    const { lazyapp, calls } = client([new Response(null, { status: 204 })]);

    await expect(lazyapp.messages.cancelScheduled('sch_1')).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url.pathname).toBe('/v1/messages/scheduled/sch_1');
  });

  it('encodes path segments', async () => {
    const { lazyapp, calls } = client([json(200, { uuid: 'x', read: true, typing: true })]);

    await lazyapp.messages.markRead('a/b', { typing: true });

    expect(calls[0]!.url.pathname).toBe('/v1/messages/a%2Fb/read');
    expect(calls[0]!.body).toEqual({ typing: true });
  });

  it('rejects an empty API key up front', () => {
    expect(() => new LazyAppClient({ apiKey: ' ' })).toThrow(/API key/);
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    const now = Date.parse('2026-10-23T10:00:00Z');
    expect(parseRetryAfter('Fri, 23 Oct 2026 10:00:05 GMT', now)).toBe(5000);
  });
});

describe('paginate', () => {
  it('walks every cursor page', async () => {
    const pages = new Map<string | undefined, { data: number[]; next_cursor: string | null }>([
      [undefined, { data: [1, 2], next_cursor: 'b' }],
      ['b', { data: [3], next_cursor: null }],
    ]);
    const items: number[] = [];
    for await (const item of paginate((cursor) => Promise.resolve(pages.get(cursor)!))) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);
  });
});
