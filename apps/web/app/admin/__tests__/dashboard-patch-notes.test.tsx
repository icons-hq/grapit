import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import AdminDashboardPage from '../page';

vi.mock('@/hooks/use-admin-dashboard', () => ({
  useDashboardSummary: () => ({
    isLoading: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  }),
  useDashboardRevenue: () => ({
    isLoading: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  }),
  useDashboardGenre: () => ({
    isLoading: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  }),
  useDashboardPayment: () => ({
    isLoading: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  }),
  useDashboardTop10: () => ({
    isLoading: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  }),
}));

describe('AdminDashboardPage patch notes', () => {
  it('surfaces the latest PR patch notes below the KPI row', () => {
    render(<AdminDashboardPage />);

    expect(
      screen.getByRole('heading', { name: '최근 패치노트' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('전체예매 취소 수수료 정책 적용'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '패치노트 전체 보기' }),
    ).toHaveAttribute('href', '/admin/patch-notes');
  });
});
