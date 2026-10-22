import type { AnyExample, WebRoute } from './example.js';

/** URL prefix every example's web pages live under: `/x/<exampleId>/…`. */
export const WEB_PREFIX = '/x';

export interface WebRouteMatch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly route: WebRoute<any>;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Finds the route for `method` and `path` (relative to `/x/<exampleId>`). `:name` segments match one
 * non-empty path segment; a trailing slash is ignored, so `/` and `` are the same page.
 */
export function matchWebRoute(example: AnyExample, method: string, path: string): WebRouteMatch | null {
  const wanted = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const segments = split(path);
  for (const route of example.web ?? []) {
    if (route.method !== wanted) {
      continue;
    }
    const pattern = split(route.path);
    if (pattern.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    const matched = pattern.every((part, index) => {
      const actual = segments[index] ?? '';
      if (part.startsWith(':')) {
        params[part.slice(1)] = safeDecode(actual);
        return actual !== '';
      }
      return part === actual;
    });
    if (matched) {
      return { route, params };
    }
  }
  return null;
}

/** True when some route serves `path` with another method (for a 405 instead of a 404). */
export function hasWebPath(example: AnyExample, path: string): boolean {
  return ['GET', 'POST'].some((method) => matchWebRoute(example, method, path) !== null);
}

function split(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Security headers for example pages: no framing, no sniffing, no referrer leaks of capability URLs. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

/**
 * Content-Security-Policy for self-contained pages: inline styles and scripts only, `fetch` to this
 * origin only, images from this origin and data URLs. Pages that need more pass their own.
 */
export const SELF_CONTAINED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; " +
  "img-src 'self' data: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** An HTML page response with the standard security headers (and a self-contained CSP by default). */
export function htmlResponse(
  html: string,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(html, {
    status,
    headers: { ...PAGE_HEADERS, 'content-security-policy': SELF_CONTAINED_CSP, ...headers },
  });
}

/** A JSON response for a page's fetch calls. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}
