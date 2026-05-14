import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { apiClient } from '@/lib/api-client';
import {
  useArchiveSupportFaq,
  useCreateSupportFaq,
  usePublishSupportFaq,
  useReviewSupportFaq,
  useUpdateSupportFaq,
} from '@/hooks/use-admin-support-content';
import { SupportContentManager } from '../support-content-manager';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const supportContentResponse = {
  faqs: [
    {
      id: 'faq-ko',
      category: 'booking',
      locale: 'ko',
      question: '예매는 어떻게 하나요?',
      answer: '좌석을 선택하고 결제하면 예매됩니다.',
      sortOrder: 0,
      isPinned: false,
      reviewState: 'approved',
      translationUse: 'manual',
      translationUseLabel: null,
      canPublish: true,
      reviewedByUserId: 'operator-1',
      reviewedAt: '2026-05-14T01:00:00.000Z',
      publishedAt: null,
      archivedAt: null,
      createdByUserId: 'operator-1',
      updatedByUserId: 'operator-1',
      createdAt: '2026-05-14T01:00:00.000Z',
      updatedAt: '2026-05-14T01:00:00.000Z',
    },
    {
      id: 'faq-th',
      category: 'booking',
      locale: 'th',
      question: 'จองอย่างไร',
      answer: 'เลือกที่นั่งและชำระเงิน',
      sortOrder: 1,
      isPinned: false,
      reviewState: 'review',
      translationUse: 'assisted',
      translationUseLabel: '자동 번역 검수본',
      canPublish: false,
      reviewedByUserId: null,
      reviewedAt: null,
      publishedAt: null,
      archivedAt: null,
      createdByUserId: 'operator-1',
      updatedByUserId: 'operator-1',
      createdAt: '2026-05-14T01:00:00.000Z',
      updatedAt: '2026-05-14T01:00:00.000Z',
    },
  ],
  notices: [
    {
      id: 'notice-en',
      category: 'event',
      locale: 'en',
      title: 'Entry notice',
      body: 'Please bring your QR ticket.',
      status: 'draft',
      priority: 'normal',
      reviewState: 'approved',
      translationUse: 'manual',
      translationUseLabel: null,
      canPublish: true,
      scheduledAt: null,
      reviewedByUserId: 'operator-1',
      reviewedAt: '2026-05-14T01:00:00.000Z',
      publishedAt: null,
      archivedAt: null,
      createdByUserId: 'operator-1',
      updatedByUserId: 'operator-1',
      createdAt: '2026-05-14T01:00:00.000Z',
      updatedAt: '2026-05-14T01:00:00.000Z',
    },
  ],
};

function createWrapper(queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('SupportContentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      supportContentResponse,
    );
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'created',
      canPublish: true,
    });
    (apiClient.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'faq-ko',
    });
  });

  it('renders FAQ and notice tabs with assisted translation indication and operations linkage', async () => {
    render(<SupportContentManager />, { wrapper: createWrapper() });

    expect(await screen.findByRole('tab', { name: 'FAQ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '공지' })).toBeInTheDocument();
    expect(screen.getByText('예매는 어떻게 하나요?')).toBeInTheDocument();
    expect(screen.getByText('자동 번역 검수본')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '운영 인박스에서 보기' }))
      .toHaveAttribute('href', '/admin/operations?source=notice_followup');

    await userEvent.click(screen.getByRole('tab', { name: '공지' }));
    expect(screen.getByText('Entry notice')).toBeInTheDocument();
  });

  it('disables publish for unreviewed assisted content until review action is used', async () => {
    const user = userEvent.setup();
    render(<SupportContentManager />, { wrapper: createWrapper() });

    await user.click(await screen.findByRole('button', { name: 'จองอย่างไร' }));

    expect(screen.getByRole('button', { name: '게시' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '검수 완료' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/faqs/faq-th/review',
        {},
      );
    });
  });

  it('creates FAQ content from the authoring form', async () => {
    const user = userEvent.setup();
    render(<SupportContentManager />, { wrapper: createWrapper() });

    await screen.findByText('예매는 어떻게 하나요?');
    await user.click(screen.getByRole('button', { name: 'FAQ 등록' }));
    await user.selectOptions(screen.getByLabelText('언어'), 'ko');
    await user.selectOptions(screen.getByLabelText('카테고리'), 'booking');
    await user.type(screen.getByLabelText('제목'), '환불은 어디서 하나요?');
    await user.type(screen.getByLabelText('내용'), '예매 내역에서 환불을 요청합니다.');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/faqs',
        {
          category: 'booking',
          locale: 'ko',
          question: '환불은 어디서 하나요?',
          answer: '예매 내역에서 환불을 요청합니다.',
          translationUse: 'manual',
        },
      );
    });
  });

  it('exposes mutation hooks and invalidates support content plus operations inbox query families', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);

    const createFaq = renderHook(() => useCreateSupportFaq(), { wrapper });
    const updateFaq = renderHook(() => useUpdateSupportFaq(), { wrapper });
    const reviewFaq = renderHook(() => useReviewSupportFaq(), { wrapper });
    const publishFaq = renderHook(() => usePublishSupportFaq(), { wrapper });
    const archiveFaq = renderHook(() => useArchiveSupportFaq(), { wrapper });

    await createFaq.result.current.mutateAsync({
      category: 'booking',
      locale: 'ko',
      question: '질문',
      answer: '답변',
      translationUse: 'manual',
    });
    await updateFaq.result.current.mutateAsync({
      id: 'faq-ko',
      input: { question: '수정 질문' },
    });
    await reviewFaq.result.current.mutateAsync('faq-th');
    await publishFaq.result.current.mutateAsync('faq-ko');
    await archiveFaq.result.current.mutateAsync('faq-ko');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/admin/support-content/faqs',
      expect.objectContaining({ question: '질문' }),
    );
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/v1/admin/support-content/faqs/faq-ko',
      { question: '수정 질문' },
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/admin/support-content/faqs/faq-th/review',
      {},
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/admin/support-content/faqs/faq-ko/publish',
      {},
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/admin/support-content/faqs/faq-ko/archive',
      {},
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'support-content'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'operations'],
    });
  });
});
