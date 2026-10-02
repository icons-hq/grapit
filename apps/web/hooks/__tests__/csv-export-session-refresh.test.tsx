import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { useReservationExport } from '../use-reservations';
import { useAdminUserExport } from '../use-admin-users';
import { useAdminFinanceExport } from '../use-admin-settlement';
import { useAdminBenefitExport } from '../use-admin-benefits';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const admin = { id: 'admin-1', email: 'ops@example.test' } as UserProfile;

/** The access token expired while the admin screen stayed open (15 min access TTL). */
function expiredTokenThenCsv(exportPath: string) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/auth/refresh')) {
      return new Response(JSON.stringify({ accessToken: 'fresh-admin-access' }), { status: 200 });
    }
    if (url.includes(exportPath)) {
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
      return auth === 'Bearer fresh-admin-access'
        ? new Response('"col"\n"value"', { status: 200, headers: { 'content-disposition': 'attachment; filename="export.csv"' } })
        : new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'expired-admin-access', user: admin, isInitialized: true });
  // jsdom has no object URLs; the download itself is not under test.
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:export'),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('raw CSV exports after the access token expired', () => {
  it('downloads the entry manifest after refreshing the session instead of failing with 401', async () => {
    const fetchMock = expiredTokenThenCsv('/api/v1/admin/bookings/export');
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReservationExport(), { wrapper: Wrapper });

    let download: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      download = await result.current.mutateAsync({ exportType: 'active_ticket_manifest', reason: '현장 명단 확보' } as never);
    });

    expect(download?.filename).toBe('export.csv');
    expect(await download?.blob.text()).toBe('"col"\n"value"');
    expect(useAuthStore.getState().accessToken).toBe('fresh-admin-access');
  });

  it.each([
    ['user export', '/api/v1/admin/users/export', () => renderHook(() => useAdminUserExport(), { wrapper: Wrapper }), { reason: '회원 대조' }],
    ['finance export', '/api/v1/admin/settlement/ledger/export', () => renderHook(() => useAdminFinanceExport(), { wrapper: Wrapper }), { dataset: 'ledger' }],
    ['benefit export', '/api/v1/admin/benefits/export', () => renderHook(() => useAdminBenefitExport(), { wrapper: Wrapper }), { path: '/api/v1/admin/benefits/export?x=1', fallbackFilename: 'benefit.csv' }],
  ])('refreshes the session for the %s too', async (_label, exportPath, render, payload) => {
    const fetchMock = expiredTokenThenCsv(exportPath);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = render();

    await act(async () => {
      await (result.current.mutateAsync as (input: unknown) => Promise<unknown>)(payload);
    });

    const exportCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes(exportPath));
    expect(exportCalls).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/refresh'))).toHaveLength(1);
  });
});
