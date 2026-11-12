import { afterEach, describe, expect, it, vi } from 'vitest';

const resetConfirmPath = '/api/v1/auth/password-reset/confirm' as const;

async function loadApiUrl() {
  vi.resetModules();
  return import('../api-url');
}

describe('apiUrl', () => {
  it('routes analytics ingestion and individual administrator views directly while preserving ordinary API routing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.heygrabit.com');
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_API_URL', 'https://seoul-api.run.app');
    const { apiUrl } = await loadApiUrl();
    expect(apiUrl('/api/v1/analytics/replay')).toBe('https://seoul-api.run.app/api/v1/analytics/replay');
    expect(apiUrl('/api/v1/admin/analytics/sessions/123')).toBe('https://seoul-api.run.app/api/v1/admin/analytics/sessions/123');
    expect(apiUrl('/api/v1/booking')).toBe('https://api.heygrabit.com/api/v1/booking');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns a relative API path when no public API URL is configured outside production', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    const { apiUrl } = await loadApiUrl();

    expect(apiUrl(resetConfirmPath)).toBe(resetConfirmPath);
  });

  it('joins a configured public API origin and strips trailing slashes', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.heygrabit.com/');
    vi.stubEnv('NODE_ENV', 'production');
    const { apiUrl } = await loadApiUrl();

    expect(apiUrl(resetConfirmPath)).toBe(
      'https://api.heygrabit.com/api/v1/auth/password-reset/confirm',
    );
  });

  it('throws in production when the public API URL is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    const { apiUrl } = await loadApiUrl();

    expect(() => apiUrl(resetConfirmPath)).toThrow(
      'NEXT_PUBLIC_API_URL must be set in production',
    );
  });

  it.each([
    'http://localhost:8080',
    'http://localhost:8080/api',
    'http://127.0.0.1:8080',
    'http://0.0.0.0:8080',
    'http://[::1]:8080',
  ])('throws in production when the public API URL is local: %s', async (baseUrl) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', baseUrl);
    vi.stubEnv('NODE_ENV', 'production');
    const { apiUrl } = await loadApiUrl();

    expect(() => apiUrl(resetConfirmPath)).toThrow(
      'NEXT_PUBLIC_API_URL must not point to localhost in production',
    );
  });

  it('throws in production when the public API URL is not HTTPS', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.heygrabit.com');
    vi.stubEnv('NODE_ENV', 'production');
    const { apiUrl } = await loadApiUrl();

    expect(() => apiUrl(resetConfirmPath)).toThrow(
      'NEXT_PUBLIC_API_URL must be an https URL in production',
    );
  });

  it.each([
    'https://api.heygrabit.com/base',
    'https://api.heygrabit.com?x=1',
    'https://api.heygrabit.com#fragment',
  ])('throws in production when the public API URL is not origin-only: %s', async (baseUrl) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', baseUrl);
    vi.stubEnv('NODE_ENV', 'production');
    const { apiUrl } = await loadApiUrl();

    expect(() => apiUrl(resetConfirmPath)).toThrow(
      'NEXT_PUBLIC_API_URL must be an origin URL in production',
    );
  });
});
