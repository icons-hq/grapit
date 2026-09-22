import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from '../page';

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
    render(<AdminDashboardPage />);
    expect(screen.getByRole('heading', { name: '운영 현황' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '업데이트 내역' })).toHaveAttribute('href', '/admin/patch-notes');
    expect(screen.queryByText(/PR #/)).not.toBeInTheDocument();
    expect(hooks.genre).not.toHaveBeenCalled();
    expect(hooks.payment).not.toHaveBeenCalled();
    expect(hooks.top10).not.toHaveBeenCalled();
  });
});
