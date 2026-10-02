import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminPerformancesPage from '../page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  archiveMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/use-admin', () => ({
  useAdminPerformances: () => ({
    data: {
      data: [
        {
          id: 'perf-girl-rules',
          title: '2026 걸룰스 팬미팅',
          genre: 'artist_celebrity',
          posterUrl: null,
          status: 'selling',
          publishState: 'published',
          startDate: '2026-07-18T05:00:00.000Z',
          endDate: '2026-07-18T07:00:00.000Z',
          venueName: '동해문화예술관',
        },
        {
          id: 'perf-draft',
          title: '준비 중인 공연',
          genre: 'artist_celebrity',
          posterUrl: null,
          status: 'upcoming',
          publishState: 'draft',
          startDate: '2026-12-18T05:00:00.000Z',
          endDate: '2026-12-18T07:00:00.000Z',
          venueName: '동해문화예술관',
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
    isLoading: false,
    isError: false,
  }),
  useArchivePerformance: () => ({
    mutate: mocks.archiveMutate,
    isPending: false,
  }),
  useDeletePerformance: () => ({
    mutate: mocks.deleteMutate,
  }),
}));

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe('AdminPerformancesPage archive action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('archives a selling performance through status=ended instead of hard delete', async () => {
    const user = userEvent.setup();

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminPerformancesPage /></QueryClientProvider>);

    await user.click(
      screen.getByRole('button', {
        name: '2026 걸룰스 팬미팅 판매종료 처리',
      }),
    );

    expect(
      screen.getByText('공연을 판매종료 처리하시겠습니까?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '공개 목록과 예매 진입에서는 숨기고, 기존 예매·결제·입장 이력은 그대로 보존합니다.',
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: '판매종료 처리' }),
    );

    expect(mocks.archiveMutate).toHaveBeenCalledWith(
      'perf-girl-rules',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(mocks.deleteMutate).not.toHaveBeenCalled();
  });

  it('offers hard delete only for performances that were never published', async () => {
    const user = userEvent.setup();

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminPerformancesPage /></QueryClientProvider>);

    expect(screen.queryByRole('button', { name: '2026 걸룰스 팬미팅 삭제' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '준비 중인 공연 삭제' }));
    expect(screen.getByText(/삭제한 관리자와 시각은 감사 기록에 남습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(mocks.deleteMutate).toHaveBeenCalledWith('perf-draft', expect.objectContaining({ onError: expect.any(Function) }));
  });
});
