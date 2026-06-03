const DEFAULT_QR_PUBLIC_WEB_ORIGIN = 'https://heygrabit.com';
const DOCUMENTED_LOCAL_QR_PUBLIC_WEB_ORIGIN = 'http://localhost:3000';
const FIELD_CHECK_IN_PATH = '/field/check-in';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function hasOriginOnly(url: URL): boolean {
  return (
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isAllowedHttpRehearsalOrigin(url: URL): boolean {
  if (isProduction() || url.protocol !== 'http:') {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || isPrivateIpv4(hostname);
}

function resolveConfiguredQrOrigin(): string | null {
  const configuredOrigin = process.env.NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN?.trim();
  if (!configuredOrigin) {
    return null;
  }

  try {
    const url = new URL(configuredOrigin);
    if (!hasOriginOnly(url)) {
      return null;
    }
    if (url.protocol === 'https:' || isAllowedHttpRehearsalOrigin(url)) {
      return url.origin;
    }
  } catch {
    return null;
  }

  return null;
}

function resolvePlaywrightOrigin(): string | null {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'https:' || isAllowedHttpRehearsalOrigin(url)) {
      return url.origin;
    }
  } catch {
    return null;
  }

  return null;
}

function getAcceptedQrOrigins(): string[] {
  const origins = new Set<string>();
  const configuredOrigin = resolveConfiguredQrOrigin();
  const playwrightOrigin = resolvePlaywrightOrigin();

  if (configuredOrigin) {
    origins.add(configuredOrigin);
  }
  if (playwrightOrigin) {
    origins.add(playwrightOrigin);
  }
  if (!isProduction()) {
    origins.add(DOCUMENTED_LOCAL_QR_PUBLIC_WEB_ORIGIN);
  } else {
    origins.add(DEFAULT_QR_PUBLIC_WEB_ORIGIN);
  }

  return Array.from(origins);
}

function buildQrCheckInUrl(origin: string, token: string): string {
  const url = new URL(FIELD_CHECK_IN_PATH, origin);
  url.searchParams.set('ticket', token);
  return url.toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildQrCheckInUrlPattern(token: string): RegExp {
  return new RegExp(
    `^(?:${getAcceptedQrOrigins()
      .map((origin) => escapeRegExp(buildQrCheckInUrl(origin, token)))
      .join('|')})$`,
  );
}

export function getQrCheckInUrlsForVisibleTextGuard(token: string): string[] {
  return getAcceptedQrOrigins().map((origin) => buildQrCheckInUrl(origin, token));
}
