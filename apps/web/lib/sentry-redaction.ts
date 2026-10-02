// Shared by the browser, Node.js and edge Sentry configs. Keep it free of
// runtime imports so it is safe in every runtime.
//
// Mirrors apps/api/src/common/observability/sentry-redaction.ts; keep the
// two redaction contracts aligned.
import type { Breadcrumb, Event } from '@sentry/nextjs';

export const SENTRY_FILTERED_VALUE = '[Filtered]';

/** `requestDataIntegration` include flags for server and edge runtimes. */
export const SENTRY_REQUEST_DATA_INCLUDE = {
  cookies: false,
  data: false,
  query_string: false,
  ip: false,
} as const;

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-toss-webhook-secret',
  'x-grabit-toss-webhook-secret',
]);

// Header or cookie names that carry credentials, sessions or webhook secrets.
const SENSITIVE_NAME_PATTERN =
  /auth|token|secret|session|cookie|passw|api[-_]?key|signature|csrf|xsrf/i;

// Attributes whose value is a URL that may carry a query string
// (password-reset `?token=`, Toss return `?paymentKey=&orderId=`).
const URL_VALUE_KEYS = new Set([
  'url',
  'http.url',
  'url.full',
  'http.target',
  'from',
  'to',
]);

// Attributes that only hold the query string or fragment.
const QUERY_ONLY_KEYS = new Set([
  'url.query',
  'http.query',
  'url.fragment',
  'http.fragment',
]);

// Headers whose value is the URL of the page that made the request.
const URL_HEADER_NAMES = new Set(['referer', 'referrer']);

const HEADER_ATTRIBUTE_PREFIXES = [
  'http.request.header.',
  'http.response.header.',
];

export function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(normalized)
    || SENSITIVE_NAME_PATTERN.test(normalized)
  );
}

/** Removes the query string and fragment, keeping scheme, host and path. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function scrubHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeaderName(name)) {
      scrubbed[name] = SENTRY_FILTERED_VALUE;
    } else if (URL_HEADER_NAMES.has(name.toLowerCase()) && typeof value === 'string') {
      scrubbed[name] = stripUrlQuery(value);
    } else {
      scrubbed[name] = value;
    }
  }
  return scrubbed;
}

function scrubAttributes(data: Record<string, unknown> | undefined): void {
  if (!data) return;

  for (const key of Object.keys(data)) {
    if (QUERY_ONLY_KEYS.has(key)) {
      delete data[key];
      continue;
    }

    const value = data[key];
    if (URL_VALUE_KEYS.has(key)) {
      if (typeof value === 'string') data[key] = stripUrlQuery(value);
      continue;
    }

    const prefix = HEADER_ATTRIBUTE_PREFIXES.find((candidate) => key.startsWith(candidate));
    if (!prefix) continue;
    const headerName = key.slice(prefix.length);
    if (isSensitiveHeaderName(headerName)) {
      data[key] = SENTRY_FILTERED_VALUE;
    } else if (URL_HEADER_NAMES.has(headerName.toLowerCase()) && typeof value === 'string') {
      data[key] = stripUrlQuery(value);
    }
  }
}

function scrubRequest(request: Event['request']): void {
  if (!request) return;

  delete request.data;
  delete request.cookies;
  delete request.query_string;

  if (typeof request.url === 'string') {
    request.url = stripUrlQuery(request.url);
  }
  if (request.headers) {
    request.headers = scrubHeaders(request.headers);
  }
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  scrubAttributes(breadcrumb.data);
  return breadcrumb;
}

/**
 * Removes credentials, request payloads and URL query strings from an error
 * or transaction event before it is sent to Sentry. Mutates and returns the
 * same event.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  scrubRequest(event.request);

  for (const breadcrumb of event.breadcrumbs ?? []) {
    scrubSentryBreadcrumb(breadcrumb);
  }

  for (const span of event.spans ?? []) {
    scrubAttributes(span.data);
  }

  scrubAttributes(event.contexts?.trace?.data);

  // Next.js `onRequestError` records the request path including its query.
  const nextjsContext = event.contexts?.['nextjs'];
  if (nextjsContext && typeof nextjsContext['request_path'] === 'string') {
    nextjsContext['request_path'] = stripUrlQuery(nextjsContext['request_path']);
  }

  return event;
}
