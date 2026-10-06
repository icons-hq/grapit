/** The parts of an Express request that identify the route that served it. */
export type RoutedRequestLike = {
  /** Set by the Express router to the route that dispatched the request. */
  route?: { path?: unknown };
  originalUrl?: string;
  url?: string;
};

/**
 * The path that names the handler of a request. The Express router accepts
 * several spellings for one handler: it matches case-insensitively by default
 * (Express 5 `case sensitive routing` off) and ignores a trailing slash. The
 * raw URL would let `/Payments/Confirm` or `/auth/LOGIN/` skip a check the
 * handler relies on, so use the template of the route that dispatched the
 * request. Outside a routed request, fall back to the URL with the same
 * folding. The result is lower-case, without query string or trailing slash.
 */
export function resolveRoutePath(request: RoutedRequestLike): string {
  const routePath = request.route?.path;
  return normalizeRoutePath(
    typeof routePath === 'string' && routePath.length > 0
      ? routePath
      : (request.originalUrl ?? request.url ?? ''),
  );
}

export function normalizeRoutePath(path: string): string {
  const withoutQuery = (path.split('?')[0] ?? path).toLowerCase();
  if (!withoutQuery) {
    return '/';
  }

  return withoutQuery.replace(/\/+$/, '') || '/';
}
