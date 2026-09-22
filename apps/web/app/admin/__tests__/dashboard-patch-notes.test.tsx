import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from '../page';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
vi.mock('@/stores/use-auth-store', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: 'admin', adminCapabilityBundle: null, adminCapabilities: ['support.manage'] } }) }));
vi.mock('@/hooks/use-admin-operations', () => ({ useAdminOperationsInbox: () => ({ data: { totals: { all: 0, overdue: 0 } } }) }));

const hooks = vi.hoisted(() => ({ genre: vi.fn(), payment: vi.fn(), top10: vi.fn() }));
vi.mock('@/hooks/use-admin-dashboard', () => ({
  useDashboardSummary: () => ({ isLoading: true, isError: false, refetch: vi.fn() }),
  useDashboardRevenue: () => ({ isLoading: true, isError: false, refetch: vi.fn() }),
  useDashboardGenre: hooks.genre,
  useDashboardPayment: hooks.payment,
  useDashboardTop10: hooks.top10,
}));

describe('운영 현황의 정보 우선순위', () => {
  it('keeps update history reachable without fetching or rendering secondary reports', () => {
    render(<QueryClientProvider client={new QueryClient()}><AdminDashboardPage /></QueryClientProvider>);
    expect(screen.getByRole('heading', { name: '운영 현황' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '업데이트 내역' })).toHaveAttribute('href', '/admin/patch-notes');
    expect(screen.queryByText(/PR #/)).not.toBeInTheDocument();
    expect(hooks.genre).not.toHaveBeenCalled();
    expect(hooks.payment).not.toHaveBeenCalled();
    expect(hooks.top10).not.toHaveBeenCalled();
  });
  it('refreshes every active dashboard and inquiry query without fetching closed reports', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const active = ['summary', 'revenue', 'genre', 'payment', 'top10'].map((name) => ['admin', 'dashboard', name]);
    active.push(['admin', 'operations']);
    const resources = active.map((queryKey) => {
      const queryFn = vi.fn().mockResolvedValue(1);
      const observer = new QueryObserver(client, { queryKey, queryFn });
      return { queryFn, unsubscribe: observer.subscribe(() => {}) };
    });
    const closedReport = vi.fn().mockResolvedValue(1);
    await client.fetchQuery({ queryKey: ['admin', 'dashboard', 'revenue', '90d'], queryFn: closedReport });
    await waitFor(() => resources.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(1)));
    render(<QueryClientProvider client={client}><AdminDashboardPage /></QueryClientProvider>);
    await userEvent.setup().click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => resources.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(2)));
    expect(closedReport).toHaveBeenCalledTimes(1);
    resources.forEach(({ unsubscribe }) => unsubscribe());
    client.clear();
  });
});
