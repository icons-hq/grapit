// Shared by the browser, Node.js and edge Sentry configs. Keep it free of
// runtime imports so it is safe in every runtime.
//
// Mirrors apps/api/src/common/observability/sentry-redaction.ts; keep the
// two redaction contracts aligned (checked by
// apps/api/src/common/observability/sentry-redaction.parity.spec.ts).
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

// Client IP headers. The Cloudflare edge and Cloud Run forward the visitor IP
// in these; an IP is personal data and never needed to debug an error.
const CLIENT_IP_HEADER_NAMES = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-grabit-client-ip',
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'true-client-ip',
  'fastly-client-ip',
  'forwarded',
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

// Span attributes that hold bound SQL parameter values.
const QUERY_PARAMETER_KEYS = new Set(['drizzle.query.params']);
const QUERY_PARAMETER_PREFIXES = ['db.query.parameter.'];

// drizzle-orm `DrizzleQueryError` messages: `Failed query: <sql>\nparams: <values>`.
const DRIZZLE_QUERY_PARAMS_PATTERN = /(Failed query: [\s\S]*?\n)params: [\s\S]*$/;

// A URL or path followed by a query string or fragment inside free text.
const NON_WHITESPACE_RUN_PATTERN = /\S+/g;
const QUERY_OR_FRAGMENT_START_PATTERN = /[?#]/;

export function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(normalized)
    || CLIENT_IP_HEADER_NAMES.has(normalized)
    || SENSITIVE_NAME_PATTERN.test(normalized)
  );
}

/** Removes the query string and fragment, keeping scheme, host and path. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Redacts bound SQL parameter values and URL query strings from free text:
 * exception values, messages, span names and console breadcrumbs.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(DRIZZLE_QUERY_PARAMS_PATTERN, `$1params: ${SENTRY_FILTERED_VALUE}`)
    .replace(NON_WHITESPACE_RUN_PATTERN, stripQueryFromTextToken);
}

/**
 * Within one whitespace-free run, drops the query/fragment that follows the
 * first `/` (`https://host/p?x` and `/p?x` both become their path). Linear in
 * the token length; a backtracking regex over the whole text was quadratic on
 * long slash-only input (u18b review).
 */
function stripQueryFromTextToken(token: string): string {
  const slash = token.indexOf('/');
  if (slash === -1) return token;
  const cut = token.slice(slash).search(QUERY_OR_FRAGMENT_START_PATTERN);
  return cut === -1 ? token : token.slice(0, slash + cut);
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
// message; an Error argument would be serialized with its own properties.
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

  // Next.js `onRequestError` records the request path including its query.
  const nextjsContext = event.contexts?.['nextjs'];
  if (nextjsContext && typeof nextjsContext['request_path'] === 'string') {
    nextjsContext['request_path'] = stripUrlQuery(nextjsContext['request_path']);
  }

  return event;
}
