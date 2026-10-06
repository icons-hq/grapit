import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api-client';
import { useArchivePerformance, usePublishPerformance } from '@/hooks/use-admin';
import {
  EventPublishConfirmationDialog,
  type EventPublishReviewSummary,
} from '../event-publish-confirmation-dialog';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const reviewSummary: EventPublishReviewSummary = {
  title: '2026 Girl Rules Fanmeeting',
  changedFields: ['title', 'venueName', 'transportSummary', 'salesInfo'],
  localeStates: [
    { locale: 'ko', label: 'ko', required: true, ready: true },
    { locale: 'en', label: 'en', required: true, ready: true },
    { locale: 'th', label: 'th', required: false, ready: false },
    { locale: 'zh-CN', label: 'zh-CN', required: false, ready: false },
  ],
  venue: {
    name: '동해문화예술관 대극장',
    address: '서울 성북구 화랑로13길 60',
    accessNotes: 'B 게이트에서 휠체어석 안내',
  },
  transportSummary: '6호선 고려대역 하차 후 도보 10분',
  saleSummary: {
    salesInfo: '팬클럽 선예매 후 일반 예매',
    paymentMethods: ['CARD', 'FOREIGN_EASY_PAY'],
    maxTicketsPerUser: 1,
    seatMapCount: 2,
    totalSeats: 1200,
  },
  contentChecklist: {
    ko: { title: true, description: true },
    en: { title: true, description: true },
  },
};

describe('EventPublishConfirmationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders exact publish copy, venue, transport, sale summary, and locale order', () => {
    render(
      <EventPublishConfirmationDialog
        open
        onOpenChange={vi.fn()}
        summary={reviewSummary}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('이 이벤트를 게시하시겠습니까?')).toBeInTheDocument();
    expect(
      screen.getByText(
        '게시 후 공개 화면과 판매 설정이 운영 기준으로 반영됩니다. 변경된 필드와 판매 일정을 확인한 뒤 진행하세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('동해문화예술관 대극장')).toBeInTheDocument();
    expect(
      screen.getByText('6호선 고려대역 하차 후 도보 10분'),
    ).toBeInTheDocument();
    expect(screen.getByText('팬클럽 선예매 후 일반 예매')).toBeInTheDocument();
    expect(screen.getByText('CARD, FOREIGN_EASY_PAY')).toBeInTheDocument();
    expect(screen.getByText('1인 1매')).toBeInTheDocument();
    expect(screen.getByText('2개 층 / 1,200석')).toBeInTheDocument();

    const localeTabs = screen.getAllByTestId('publish-locale-tab');
    expect(localeTabs.map((tab) => tab.textContent)).toEqual([
      'ko필수 준비됨',
      'en필수 준비됨',
      'th검수 필요',
      'zh-CN검수 필요',
    ]);
  });

  it('keeps confirm disabled until reason and confirmation are present', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <EventPublishConfirmationDialog
        open
        onOpenChange={vi.fn()}
        summary={reviewSummary}
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', {
      name: '이벤트 게시하기',
    });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('게시 사유'), '운영 기준 확인 완료');
    expect(confirmButton).toBeDisabled();

    await user.click(
      screen.getByRole('checkbox', {
        name: '변경된 필드와 판매 일정을 확인했습니다',
      }),
    );
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledWith({
      reason: '운영 기준 확인 완료',
      confirmed: true,
      confirmedChangedFields: reviewSummary.changedFields,
      contentChecklist: reviewSummary.contentChecklist,
    });
  });
});

describe('EventPublishConfirmationDialog sale opening', () => {
  it('shows that a published-upcoming performance will not open sales on its own', () => {
    render(<EventPublishConfirmationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()}
      summary={{ ...reviewSummary, saleOpening: { mode: 'manual', at: null, startElapsed: false } }} />);

    expect(screen.getByText('실제 판매 개시 · 한국 시간')).toBeInTheDocument();
    expect(screen.getByText('자동 오픈 안 됨 · 판매 상태를 판매 중으로 바꿀 때 판매 시작')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '공개 즉시 판매가 시작되는 것을 확인했습니다' })).not.toBeInTheDocument();
  });

  it('shows the scheduled KST opening computed by the server', () => {
    render(<EventPublishConfirmationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()}
      summary={{ ...reviewSummary, saleOpening: { mode: 'scheduled', at: '2026-10-08T11:00:00.000Z', startElapsed: false } }} />);

    expect(screen.getByText('2026-10-08 20:00 KST 자동 오픈')).toBeInTheDocument();
  });

  it('requires an explicit immediate-sale acknowledgement before publishing an open sale', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<EventPublishConfirmationDialog open onOpenChange={vi.fn()} onConfirm={onConfirm}
      summary={{ ...reviewSummary, saleOpening: { mode: 'immediate', at: null, startElapsed: false } }} />);
    const confirmButton = screen.getByRole('button', { name: '이벤트 게시하기' });

    expect(screen.getByText('공개 즉시 판매 · 판매 중 상태이며 시작 시각 미지정')).toBeInTheDocument();
    await user.type(screen.getByLabelText('게시 사유'), '오픈 공지 완료');
    await user.click(screen.getByRole('checkbox', { name: '변경된 필드와 판매 일정을 확인했습니다' }));
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: '공개 즉시 판매가 시작되는 것을 확인했습니다' }));
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ reason: '오픈 공지 완료', immediateSaleConfirmed: true }));
  });
});

describe('usePublishPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts publish payload and invalidates admin performance queries', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'perf-1',
      publishState: 'published',
    });

    const publishMutation = renderHook(
      () => usePublishPerformance('perf-1'),
      { wrapper: createWrapper() },
    );

    await publishMutation.result.current.mutateAsync({
      expectedUpdatedAt: '2026-09-21T00:00:00.000Z',
      reason: '운영 기준 확인 완료',
      confirmed: true,
      confirmedChangedFields: ['title', 'venueName'],
      contentChecklist: reviewSummary.contentChecklist,
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/performances/perf-1/publish',
        {
          expectedUpdatedAt: '2026-09-21T00:00:00.000Z',
          reason: '운영 기준 확인 완료',
          confirmed: true,
          confirmedChangedFields: ['title', 'venueName'],
          contentChecklist: reviewSummary.contentChecklist,
        },
        { showErrorToast: false },
      );
    });
  });
});

describe('useArchivePerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a performance as ended without calling the hard-delete endpoint', async () => {
    (apiClient.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'perf-1',
      status: 'ended',
    });

    const archiveMutation = renderHook(
      () => useArchivePerformance(),
      { wrapper: createWrapper() },
    );

    await archiveMutation.result.current.mutateAsync('perf-1');

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/v1/admin/performances/perf-1',
        { status: 'ended' },
        { showErrorToast: false },
      );
    });
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});
