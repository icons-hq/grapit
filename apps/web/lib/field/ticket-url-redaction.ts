import { FIELD_CHECK_IN_TICKET_PARAM, LEGACY_FIELD_CHECK_IN_TOKEN_PARAM } from '@grabit/shared';

/**
 * A field QR link carries the raw ticket credential in `?ticket=` (or the
 * legacy `?token=`). Anyone who reads it before entry can rebuild the QR, so
 * the value must not linger in the address bar, browser history, the /auth
 * returnTo or client telemetry.
 */
export const SENSITIVE_URL_PARAMS = [
  FIELD_CHECK_IN_TICKET_PARAM,
  LEGACY_FIELD_CHECK_IN_TOKEN_PARAM,
] as const;

const REDACTED = '[Filtered]';
const SENSITIVE_PARAM_PATTERN = SENSITIVE_URL_PARAMS.join('|');
const PLAIN_PARAM_RE = new RegExp(`(^|[?&#;])((?:${SENSITIVE_PARAM_PATTERN})=)[^&#\\s"'<>]*`, 'gi');
// Matches the same parameters inside an encoded URL (e.g. `returnTo=%2Ffield%2Fcheck-in%3Fticket%3D...`).
const ENCODED_PARAM_RE = new RegExp(
  `((?:%3F|%26|%23)(?:${SENSITIVE_PARAM_PATTERN})%3D)(?:[^&#\\s"'<>%]|%(?!26|23)[0-9a-f]{2})*`,
  'gi',
);
const SENSITIVE_KEYS = new Set<string>(SENSITIVE_URL_PARAMS);
const MAX_SCRUB_DEPTH = 12;

interface SearchParamsReader {
  get(name: string): string | null;
}

export function readFieldTicketParam(params: SearchParamsReader): string {
  for (const name of SENSITIVE_URL_PARAMS) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return '';
}

/** Returns `?…` without ticket/token parameters, or '' when nothing remains. */
export function searchWithoutFieldTicketParams(search: string | URLSearchParams): string {
  const params = new URLSearchParams(search);
  for (const name of SENSITIVE_URL_PARAMS) params.delete(name);
  const next = params.toString();
  return next ? `?${next}` : '';
}

/**
 * Removes ticket/token from the current URL in place. Passing `null` as the
 * history state lets the Next.js App Router sync `useSearchParams` with it.
 */
export function scrubFieldTicketFromLocation(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  if (!SENSITIVE_URL_PARAMS.some((name) => params.has(name))) return false;
  window.history.replaceState(null, '', `${pathname}${searchWithoutFieldTicketParams(params)}${hash}`);
  return true;
}

export function redactSensitiveUrlParams(value: string): string {
  if (!value) return value;
  return value
    .replace(PLAIN_PARAM_RE, `$1$2${REDACTED}`)
    .replace(ENCODED_PARAM_RE, `$1${REDACTED}`);
}

/**
 * Deep-redacts ticket/token URL parameters from a Sentry event, breadcrumb or
 * span (request URL, query string, navigation from/to, span names and data).
 */
export function scrubSensitiveUrlParams<T>(payload: T): T {
  return scrubValue(payload, undefined, 0, new WeakSet()) as T;
}

function scrubValue(value: unknown, key: string | undefined, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return key && SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactSensitiveUrlParams(value);
  }
  if (!value || typeof value !== 'object' || depth > MAX_SCRUB_DEPTH || seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    // Sentry may keep a query string as `[name, value]` pairs.
    if (value.length === 2 && typeof value[0] === 'string' && SENSITIVE_KEYS.has(value[0].toLowerCase())) {
      value[1] = REDACTED;
      return value;
    }
    for (let index = 0; index < value.length; index += 1) {
      value[index] = scrubValue(value[index], undefined, depth + 1, seen);
    }
    return value;
  }

  // Only plain JSON-like data is sent. Class instances (Sentry Scope/Client in
  // sdkProcessingMetadata) are SDK internals and must not be walked or mutated.
  if (!isPlainRecord(value)) return value;
  const record = value as Record<string, unknown>;
  for (const entryKey of Object.keys(record)) {
    if (entryKey === 'sdkProcessingMetadata') continue;
    record[entryKey] = scrubValue(record[entryKey], entryKey, depth + 1, seen);
  }
  return record;
}

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
