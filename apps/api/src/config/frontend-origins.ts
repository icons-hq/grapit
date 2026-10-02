/**
 * Single interpretation of `FRONTEND_URL` for every consumer (audit #93).
 *
 * `FRONTEND_URL` may hold one origin or a comma-separated list, for example
 * `https://heygrabit.com,https://www.heygrabit.com`:
 * - CORS checks (REST and Socket.IO) accept any listed origin.
 * - Places that need one absolute URL (redirects, email links) use the first
 *   entry, the primary frontend URL.
 */
export const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

/** Trimmed, non-empty entries exactly as configured. */
export function parseFrontendUrlList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toBrowserOrigin(entry: string): string | null {
  try {
    const origin = new URL(entry).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Origins a browser may send for the configured frontend(s). Each entry is
 * normalized to its URL origin, so a trailing slash in the configuration does
 * not reject the browser's `Origin` header. Falls back to the local web origin
 * when nothing is configured (production bootstrap refuses that case).
 */
export function getFrontendOrigins(raw: string | null | undefined = process.env['FRONTEND_URL']): string[] {
  const origins = new Set<string>();
  for (const entry of parseFrontendUrlList(raw)) {
    origins.add(toBrowserOrigin(entry) ?? entry);
  }
  return origins.size > 0 ? [...origins] : [DEFAULT_FRONTEND_ORIGIN];
}

/** First configured frontend URL without a trailing slash. */
export function getPrimaryFrontendUrl(raw: string | null | undefined = process.env['FRONTEND_URL']): string {
  const [primary] = parseFrontendUrlList(raw);
  return (primary ?? DEFAULT_FRONTEND_ORIGIN).replace(/\/+$/, '');
}

export function isAllowedFrontendOrigin(
  origin: string,
  raw: string | null | undefined = process.env['FRONTEND_URL'],
): boolean {
  return getFrontendOrigins(raw).includes(origin);
}

/**
 * Socket.IO (engine.io) CORS origin callback shared by the booking and queue
 * gateways. Outside production every origin is allowed; requests without an
 * Origin header (non-browser clients) are allowed as before.
 */
export function allowSocketIoFrontendOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (
    process.env['NODE_ENV'] !== 'production'
    || !origin
    || isAllowedFrontendOrigin(origin)
  ) {
    callback(null, true);
    return;
  }

  callback(new Error('CORS not allowed'));
}
