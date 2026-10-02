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

  it('reads the profile with the already rotated access token before rotating the cookie again', async () => {
    let profileDown = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) return json({ accessToken: 'rotated-once' });
      if (profileDown) return json({}, 503);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer rotated-once');
      return json(buyer);
    });
    vi.stubGlobal('fetch', fetchMock);

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(10_000);
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ isInitialized: true, accessToken: null });

    profileDown = false;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'rotated-once', user: buyer });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('keeps retrying instead of signing out when the edge answers 403', async () => {
    let edgeBlocking = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (edgeBlocking) return new Response('<html>blocked</html>', { status: 403 });
      if (url.endsWith('/api/v1/auth/refresh')) return json({ accessToken: 'after-edge-block' });
      return json(buyer);
    }));

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(10_000);
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ isInitialized: true, accessToken: null });

    edgeBlocking = false;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'after-edge-block', user: buyer });
  });

  it('treats a 403 profile read as temporary and keeps the rotated token', async () => {
    let profileBlocked = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) return json({ accessToken: 'rotated-once' });
      return profileBlocked ? new Response('blocked', { status: 403 }) : json(buyer);
    });
    vi.stubGlobal('fetch', fetchMock);

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(10_000);
    await restoring;
    expect(useAuthStore.getState().accessToken).toBeNull();

    profileBlocked = false;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'rotated-once', user: buyer });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('does not overwrite a manual login that finished while a restore was running', async () => {
    let releaseRefresh!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) {
        return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
      }
      return Promise.resolve(json(buyer));
    }));
    const manualUser = { ...buyer, id: 'buyer-2', email: 'manual@example.test' } as UserProfile;

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(0);
    useAuthStore.getState().setAuth('manual-access', manualUser);
    releaseRefresh(json({ accessToken: 'stale-restored-access' }));
    await vi.runAllTimersAsync();
    await restoring;

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'manual-access', user: manualUser });
  });

  it('does not sign the buyer back in when they logged out while a restore was running', async () => {
    let releaseProfile!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) return Promise.resolve(json({ accessToken: 'stale-restored-access' }));
      return new Promise<Response>((resolve) => { releaseProfile = resolve; });
    }));

    const restoring = initializeAuth();
    await vi.advanceTimersByTimeAsync(0);
    // Logout clears the (still empty) store while /users/me is in flight.
    useAuthStore.getState().clearAuth();
    releaseProfile(json(buyer));
    await vi.runAllTimersAsync();
    await restoring;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, user: null, isInitialized: true });
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
