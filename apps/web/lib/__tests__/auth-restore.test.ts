import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { initializeAuth, resetAuthInitializationForTests } from '@/lib/auth';

const buyer = { id: 'buyer-1', email: 'buyer@example.test', isEmailVerified: true } as UserProfile;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function respondByPath(handlers: Record<string, Array<() => Response>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(handlers).find((path) => url.endsWith(path));
    const queue = key ? handlers[key]! : [];
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (!next) throw new Error(`unexpected request ${url}`);
    return next();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAuthInitializationForTests();
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: false });
});

afterEach(() => {
  resetAuthInitializationForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session restore on page load', () => {
  it('waits through a short API outage instead of treating the visitor as signed out', async () => {
    vi.stubGlobal('fetch', respondByPath({
      '/api/v1/auth/refresh': [() => json({}, 503), () => json({}, 502), () => json({ accessToken: 'restored-access' })],
      '/api/v1/users/me': [() => json(buyer)],
    }));

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(0);
    // Protected pages keep their loading state while the retries run.
    expect(useAuthStore.getState().isInitialized).toBe(false);

    await vi.runAllTimersAsync();
    await restoring;

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'restored-access', user: buyer, isInitialized: true });
  });

  it('keeps the rotated session when only the profile request fails briefly', async () => {
    const fetchMock = respondByPath({
      '/api/v1/auth/refresh': [() => json({ accessToken: 'restored-access' })],
      '/api/v1/users/me': [() => json({}, 503), () => json(buyer)],
    });
    vi.stubGlobal('fetch', fetchMock);

    const restoring = initializeAuth();
    await vi.runAllTimersAsync();
    await restoring;

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'restored-access', user: buyer });
    // The refresh cookie is rotated only once; the profile read is retried with the same token.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('continues signed out during a long outage and signs the buyer back in when the API recovers', async () => {
    let apiDown = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (apiDown) return json({}, 503);
      if (url.endsWith('/api/v1/auth/refresh')) return json({ accessToken: 'recovered-access' });
      return json(buyer);
    }));

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(10_000);
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ isInitialized: true, accessToken: null });

    apiDown = false;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'recovered-access', user: buyer });
  });

  it('does not retry when the refresh session is rejected', async () => {
    const fetchMock = respondByPath({ '/api/v1/auth/refresh': [() => json({}, 401)] });
    vi.stubGlobal('fetch', fetchMock);

    const restoring = initializeAuth();
    await vi.runAllTimersAsync();
    await restoring;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(useAuthStore.getState()).toMatchObject({ isInitialized: true, accessToken: null });
    // Initial attempt plus the single cross-tab recheck; no background retries.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
