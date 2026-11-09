import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { usePerformanceDetail } from '../use-performances';

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));

const id = '11111111-1111-4111-8111-111111111111';
const publicPath = `/api/v1/performances/${id}?locale=ko`;
const privatePath = `/api/v1/admin/performances/${id}`;
const hiddenPerformance = { id, title: 'Private fan meeting', status: 'upcoming' };
const admin = {
  id: 'admin-a', role: 'admin', adminCapabilityBundle: null, adminCapabilities: [],
} as unknown as UserProfile;
const get = vi.mocked(apiClient.get);
let client: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
  get.mockImplementation(async (path) => {
    if (path === privatePath) return hiddenPerformance;
    throw Object.assign(new Error('공연을 찾을 수 없습니다'), { statusCode: 404 });
  });
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
});
afterEach(() => { client.clear(); useAuthStore.getState().clearAuth(); });

describe('private performance preview', () => {
  it('lets a signed-in full admin load a draft through the existing authenticated admin endpoint', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    const { result } = renderHook(() => usePerformanceDetail(id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(hiddenPerformance);
    expect(get.mock.calls.map(([path]) => path)).toEqual([publicPath, privatePath]);
  });

  it.each([
    ['anonymous', null],
    ['buyer', { id: 'buyer', role: 'user' }],
    ['scanner', { ...admin, adminCapabilityBundle: 'scanner' }],
    ['operator', { ...admin, adminCapabilityBundle: 'operator' }],
    ['missing claims', { id: 'legacy', role: 'admin' }],
  ])('never requests hidden data for %s', async (_name, user) => {
    if (user) useAuthStore.getState().setAuth('test-token', user as UserProfile);
    const { result } = renderHook(() => usePerformanceDetail(id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get.mock.calls.map(([path]) => path)).toEqual([publicPath]);
  });

  it('does not carry a cached private performance into a signed-out or buyer session', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    const { result } = renderHook(() => usePerformanceDetail(id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual(hiddenPerformance));
    act(() => useAuthStore.getState().clearAuth());
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('preserves the public localized response for published performances', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    get.mockResolvedValue({ id, title: 'Public Korean copy' });
    const { result } = renderHook(() => usePerformanceDetail(id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get.mock.calls.map(([path]) => path)).toEqual([publicPath]);
  });

  it('does not turn authentication failures or server failures into preview requests', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    get.mockRejectedValue(Object.assign(new Error('Unavailable'), { statusCode: 503 }));
    const { result } = renderHook(() => usePerformanceDetail(id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get.mock.calls.map(([path]) => path)).toEqual([publicPath]);
  });
});
