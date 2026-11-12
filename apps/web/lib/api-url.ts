const LOCALHOST_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
}

function getHostname(baseUrl: string): string {
  return new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

export function apiUrl(path: `/${string}`): string {
  // Personal analytics and administrator replay responses go directly to the
  // existing Seoul API, without passing their contents through the CDN.
  const analytics = /^\/api\/v1\/(?:admin\/)?analytics(?:[/?]|$)/.test(path);
  const analyticsOrigin = (process.env.NEXT_PUBLIC_ANALYTICS_API_URL ?? '').trim().replace(/\/+$/, '');
  const baseUrl = analytics && analyticsOrigin ? analyticsOrigin : getApiBaseUrl();

  // NEXT_PUBLIC_* values are inlined into browser bundles at next build, so production misconfiguration must fail loudly.
  if (process.env.NODE_ENV === 'production') {
    if (analytics && !analyticsOrigin) throw new Error('NEXT_PUBLIC_ANALYTICS_API_URL must be set in production');
    if (baseUrl === '') {
      throw new Error('NEXT_PUBLIC_API_URL must be set in production');
    }

    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('NEXT_PUBLIC_API_URL must be an absolute URL in production');
    }

    const hostname = getHostname(baseUrl);
    if (LOCALHOST_HOSTNAMES.has(hostname)) {
      throw new Error(
        'NEXT_PUBLIC_API_URL must not point to localhost in production',
      );
    }

    if (url.protocol !== 'https:') {
      throw new Error('NEXT_PUBLIC_API_URL must be an https URL in production');
    }

    if (url.origin !== baseUrl) {
      throw new Error('NEXT_PUBLIC_API_URL must be an origin URL in production');
    }
  }

  if (baseUrl === '') {
    return path;
  }

  return `${baseUrl}${path}`;
}
