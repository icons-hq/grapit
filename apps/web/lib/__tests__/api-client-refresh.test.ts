import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { UserProfile } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@/lib/i18n/locale-navigation', () => ({ navigateToLocalizedPath: navigation.navigate }));

import { ApiClientError, apiClient, refreshAccessToken } from '@/lib/api-client';

const buyer = { id: 'buyer-1', email: 'buyer@example.test' } as UserProfile;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function respondByPath(handlers: Record<string, Array<() => Response | Promise<Response>>>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(handlers).find((path) => url.endsWith(path));
    const queue = key ? handlers[key]! : [];
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (!next) throw new Error(`unexpected request ${url}`);
    return next();
  });
}

async function settle<T>(promise: Promise<T>) {
  const result = promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: 'expired-access', user: buyer, isInitialized: true });
  window.history.replaceState(null, '', '/booking/show-1/confirm?resumeOrderId=GRP-1');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session refresh on 401', () => {
  it.each([
    ['503 responses', () => json({ message: 'unavailable' }, 503)],
    ['429 responses', () => json({ message: 'slow down' }, 429)],
    ['network failures', () => { throw new TypeError('Failed to fetch'); }],
  ])('keeps the buyer signed in and on the page when refresh keeps failing with %s', async (_label, failure) => {
    const fetchMock = respondByPath({
      '/api/v1/reservations': [() => json({ message: 'expired' }, 401)],
      '/api/v1/auth/refresh': [failure],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(apiClient.get('/api/v1/reservations'));

    expect(result.status).toBe('rejected');
    const error = (result as { reason: unknown }).reason;
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).statusCode).toBe(503);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'expired-access', user: buyer });
    expect(navigation.navigate).not.toHaveBeenCalled();
    // One attempt plus two backoff retries before giving up.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(3);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('treats a hung refresh request as temporary and does not sign the buyer out', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/auth/refresh')) return Promise.resolve(json({}, 401));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));

    const result = await settle(apiClient.get('/api/v1/reservations'));

    expect((result as { reason: ApiClientError }).reason.statusCode).toBe(503);
    expect(useAuthStore.getState().accessToken).toBe('expired-access');
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('recovers when the API comes back during the refresh backoff', async () => {
    const fetchMock = respondByPath({
      '/api/v1/reservations': [() => json({ message: 'expired' }, 401), () => json([{ id: 'r-1' }])],
      '/api/v1/auth/refresh': [() => json({}, 503), () => json({ accessToken: 'fresh-access' })],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(apiClient.get('/api/v1/reservations'));

    expect(result).toEqual({ status: 'fulfilled', value: [{ id: 'r-1' }] });
    expect(useAuthStore.getState().accessToken).toBe('fresh-access');
    const retried = fetchMock.mock.calls.at(-1)!;
    expect((retried[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer fresh-access' });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('signs out only when the refresh session itself is rejected', async () => {
    vi.stubGlobal('fetch', respondByPath({
      '/api/v1/reservations': [() => json({}, 401)],
      '/api/v1/auth/refresh': [() => json({}, 401)],
    }));

    const result = await settle(apiClient.get('/api/v1/reservations'));

    expect((result as { reason: ApiClientError }).reason.statusCode).toBe(401);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(navigation.navigate).toHaveBeenCalledWith(
      '/auth?returnTo=%2Fbooking%2Fshow-1%2Fconfirm%3FresumeOrderId%3DGRP-1',
    );
  });

  it('rechecks once when another tab rotated the shared cookie during this refresh', async () => {
    vi.stubGlobal('fetch', respondByPath({
      '/api/v1/auth/refresh': [() => json({}, 401), () => json({ accessToken: 'rotated-by-other-tab' })],
    }));

    const result = await settle(refreshAccessToken());

    expect(result).toEqual({ status: 'fulfilled', value: { status: 'refreshed', accessToken: 'rotated-by-other-tab' } });
  });

  it('serializes refreshes across tabs through a Web Lock', async () => {
    const request = vi.fn(async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal('navigator', { ...window.navigator, locks: { request } });
    vi.stubGlobal('fetch', respondByPath({
      '/api/v1/auth/refresh': [() => json({ accessToken: 'locked-refresh' })],
    }));

    const [first, second] = await Promise.all([refreshAccessToken(), refreshAccessToken()]);

    expect(first).toEqual({ status: 'refreshed', accessToken: 'locked-refresh' });
    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('grabit-auth-refresh', expect.objectContaining({ signal: expect.any(AbortSignal) }), expect.any(Function));
  });

  it('still refreshes when the Web Lock cannot be acquired in time', async () => {
    const request = vi.fn((_name: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('navigator', { ...window.navigator, locks: { request } });
    vi.stubGlobal('fetch', respondByPath({
      '/api/v1/auth/refresh': [() => json({ accessToken: 'after-lock-timeout' })],
    }));

    const result = await settle(refreshAccessToken());

    expect(result).toEqual({ status: 'fulfilled', value: { status: 'refreshed', accessToken: 'after-lock-timeout' } });
  });
});

describe('raw downloads (CSV exports)', () => {
  it('refreshes an expired access token and retries the export once', async () => {
    const fetchMock = respondByPath({
      '/api/v1/admin/bookings/export': [
        () => json({ message: 'expired' }, 401),
        () => new Response('"seat"\n"A-1"', { status: 200, headers: { 'content-disposition': 'attachment; filename="manifest.csv"' } }),
      ],
      '/api/v1/auth/refresh': [() => json({ accessToken: 'fresh-admin-access' })],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await settle(apiClient.raw('POST', '/api/v1/admin/bookings/export', { exportType: 'active_ticket_manifest' }));

    expect(result.status).toBe('fulfilled');
    const response = (result as { value: Response }).value;
    expect(await response.text()).toBe('"seat"\n"A-1"');
    const exportCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/admin/bookings/export'));
    expect(exportCalls).toHaveLength(2);
    expect((exportCalls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer fresh-admin-access' });
    expect((exportCalls[1]![1] as RequestInit).body).toBe(JSON.stringify({ exportType: 'active_ticket_manifest' }));
  });
});
