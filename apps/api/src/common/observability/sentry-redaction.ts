// This module is imported from `instrument.ts`, which must run before any
// `@nestjs/*` module is loaded so OpenTelemetry can patch it. Keep it free of
// runtime imports (type-only imports are erased at build time).
//
// apps/web/lib/sentry-redaction.ts keeps the same contract for the web
// runtimes; sentry-redaction.parity.spec.ts checks both give the same result.
import type { Breadcrumb, Event } from '@sentry/nestjs';

export const SENTRY_FILTERED_VALUE = '[Filtered]';

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
// (e.g. `?tossWebhookSecret=...`). Only the query/fragment is removed.
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

// Headers whose value is a URL of the page that made the request; a
// password-reset or payment-return page keeps its token in the query.
const URL_HEADER_NAMES = new Set(['referer', 'referrer']);

const HEADER_ATTRIBUTE_PREFIXES = [
  'http.request.header.',
  'http.response.header.',
];

// Span attributes that hold bound SQL parameter values. drizzle-orm 0.45 does
// not emit its own spans, but its tracer sets `drizzle.query.params` when it
// does; OpenTelemetry semantic conventions use `db.query.parameter.<key>`.
const QUERY_PARAMETER_KEYS = new Set(['drizzle.query.params']);
const QUERY_PARAMETER_PREFIXES = ['db.query.parameter.'];

// drizzle-orm wraps every failed query in `DrizzleQueryError` whose message is
// `Failed query: <sql>\nparams: <bound values>`. The values carry emails, phone
// numbers, password hashes, refresh token hashes and paymentKey; keep the SQL
// text (placeholders only) and drop the values.
const DRIZZLE_QUERY_PARAMS_PATTERN = /(Failed query: [\s\S]*?\n)params: [\s\S]*$/;

// A URL or path (`https://host/p?x`, `/p?x`) followed by a query string or
// fragment inside free text such as an error message or a span name.
const URL_QUERY_IN_TEXT_PATTERN = /(\/[^\s?#]*)[?#]\S*/g;

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

/**
 * Redacts bound SQL parameter values (`DrizzleQueryError` messages) and URL
 * query strings from free text: exception values, messages, span names and
 * log lines.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(DRIZZLE_QUERY_PARAMS_PATTERN, `$1params: ${SENTRY_FILTERED_VALUE}`)
    .replace(URL_QUERY_IN_TEXT_PATTERN, '$1');
}

function isQueryParameterKey(key: string): boolean {
  return (
    QUERY_PARAMETER_KEYS.has(key)
    || QUERY_PARAMETER_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
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
    if (isQueryParameterKey(key)) {
      data[key] = SENTRY_FILTERED_VALUE;
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

  // Request bodies (phone numbers, password-reset tokens, paymentKey),
  // cookies (refreshToken) and query strings (webhook secrets) never leave
  // the process.
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

// Console breadcrumbs keep the raw `console.*` arguments next to the joined
// message; an Error argument would be serialized with its own properties
// (`DrizzleQueryError.params`).
function scrubConsoleArguments(data: Breadcrumb['data']): void {
  const args: unknown = data?.['arguments'];
  if (!data || !Array.isArray(args)) return;

  data['arguments'] = args.map((arg: unknown) => {
    if (typeof arg === 'string') return redactSensitiveText(arg);
    if (arg instanceof Error) return redactSensitiveText(`${arg.name}: ${arg.message}`);
    return arg;
  });
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = redactSensitiveText(breadcrumb.message);
  }
  scrubAttributes(breadcrumb.data);
  scrubConsoleArguments(breadcrumb.data);
  return breadcrumb;
}

function scrubMessages(event: Event): void {
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === 'string') {
      exception.value = redactSensitiveText(exception.value);
    }
  }
  if (typeof event.message === 'string') {
    event.message = redactSensitiveText(event.message);
  }
  if (typeof event.logentry?.message === 'string') {
    event.logentry.message = redactSensitiveText(event.logentry.message);
  }
  if (typeof event.transaction === 'string') {
    event.transaction = redactSensitiveText(event.transaction);
  }
}

/**
 * Removes credentials, request payloads, bound SQL parameter values and URL
 * query strings from an error or transaction event before it is sent to
 * Sentry. Mutates and returns the same event.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  scrubRequest(event.request);
  scrubMessages(event);

  for (const breadcrumb of event.breadcrumbs ?? []) {
    scrubSentryBreadcrumb(breadcrumb);
  }

  for (const span of event.spans ?? []) {
    if (typeof span.description === 'string') {
      span.description = redactSensitiveText(span.description);
    }
    scrubAttributes(span.data);
  }

  scrubAttributes(event.contexts?.trace?.data);

  return event;
}
