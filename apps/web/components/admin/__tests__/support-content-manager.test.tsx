import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
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
    expect(screen.getByRole('link', { name: '고객 문의에서 보기' }))
      .toHaveAttribute('href', '/admin/operations');

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
    await user.selectOptions(screen.getByLabelText('분류'), 'booking');
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

function noticeRow(overrides: Record<string, unknown>) {
  return {
    ...supportContentResponse.notices[0],
    translationGroupId: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe('SupportContentManager edit safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'created',
      canPublish: true,
    });
    (apiClient.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('keeps the edit target and selection when a refetch puts another notice first (audit #141)', async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const noticeX = noticeRow({
      id: 'notice-x',
      title: 'Notice X',
      body: 'Body X',
      updatedAt: '2026-09-30T01:00:00.000Z',
    });
    const noticeY = noticeRow({
      id: 'notice-y',
      title: 'Notice Y',
      body: 'Body Y',
      reviewState: 'published',
      status: 'published',
    });
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [],
      notices: [noticeX],
    });

    render(<SupportContentManager />, { wrapper: createWrapper(queryClient) });
    await user.click(await screen.findByRole('tab', { name: '공지' }));
    await user.click(screen.getByRole('button', { name: 'Notice X 수정' }));
    await user.clear(screen.getByLabelText('내용'));
    await user.type(screen.getByLabelText('내용'), 'Body X edited');

    // Another operator publishes Y; the list refetches with Y on top.
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [],
      notices: [noticeY, noticeX],
    });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'support-content'] });
    });
    expect(await screen.findByText('Notice Y')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/notices/notice-x',
        {
          body: 'Body X edited',
          expectedUpdatedAt: '2026-09-30T01:00:00.000Z',
        },
      );
    });
    expect(apiClient.patch).not.toHaveBeenCalledWith(
      '/api/v1/admin/support-content/notices/notice-y',
      expect.anything(),
    );
    expect(await screen.findByText('Body X')).toBeInTheDocument();
  });

  it('shows a conflict message and keeps the form open when the server rejects a stale save', async () => {
    const user = userEvent.setup();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      supportContentResponse,
    );
    (apiClient.patch as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(
        new Error('다른 운영자가 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요'),
        { statusCode: 409 },
      ),
    );

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await user.click(
      await screen.findByRole('button', { name: '예매는 어떻게 하나요? 수정' }),
    );
    await user.type(screen.getByLabelText('내용'), ' 추가');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(
      await screen.findByText(
        '다른 운영자가 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '최신 내용 다시 불러오기' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('내용')).toHaveValue(
      '좌석을 선택하고 결제하면 예매됩니다. 추가',
    );
  });

  it('warns that reloading after a conflict discards the draft before replacing it', async () => {
    const user = userEvent.setup();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      supportContentResponse,
    );
    (apiClient.patch as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('다른 운영자가 먼저 수정했습니다.'), { statusCode: 409 }),
    );

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await user.click(
      await screen.findByRole('button', { name: '예매는 어떻게 하나요? 수정' }),
    );
    await user.type(screen.getByLabelText('내용'), ' 추가');
    await user.click(screen.getByRole('button', { name: '저장' }));
    const getCalls = (apiClient.get as ReturnType<typeof vi.fn>).mock.calls.length;

    await user.click(await screen.findByRole('button', { name: '최신 내용 다시 불러오기' }));
    const dialog = await screen.findByRole('alertdialog', { name: '최신 내용을 다시 불러올까요?' });
    expect(dialog).toHaveTextContent('작성 중인 내용은 버려집니다');
    await user.click(screen.getByRole('button', { name: '계속 수정' }));
    expect(screen.getByLabelText('내용')).toHaveValue('좌석을 선택하고 결제하면 예매됩니다. 추가');
    expect((apiClient.get as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(getCalls);

    await user.click(screen.getByRole('button', { name: '최신 내용 다시 불러오기' }));
    await user.click(await screen.findByRole('button', { name: '작성 내용 버리고 불러오기' }));
    await waitFor(() => {
      expect(screen.getByLabelText('내용')).toHaveValue('좌석을 선택하고 결제하면 예매됩니다.');
    });
  });

  it('restores archived content with 보관 해제 and then allows publishing (audit #133)', async () => {
    const user = userEvent.setup();
    const archivedFaq = {
      ...supportContentResponse.faqs[0],
      reviewState: 'archived',
      canPublish: false,
      archivedAt: '2026-05-15T01:00:00.000Z',
    };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [archivedFaq],
      notices: [],
    });
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...archivedFaq,
      reviewState: 'approved',
      canPublish: true,
      archivedAt: null,
    });

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await screen.findByText('예매는 어떻게 하나요?');
    expect(screen.queryByRole('button', { name: /검수 완료/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /게시$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^보관$/ })).toBeDisabled();

    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [{ ...archivedFaq, reviewState: 'approved', canPublish: true, archivedAt: null }],
      notices: [],
    });
    await user.click(screen.getByRole('button', { name: /보관 해제/ }));

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/admin/support-content/faqs/faq-ko/review',
      {},
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /게시$/ })).toBeEnabled();
    });
    // Back to an approved row: the button returns to its normal label.
    expect(screen.getByRole('button', { name: /검수 완료/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /보관 해제/ })).not.toBeInTheDocument();
  });

  it('warns that a separately registered fallback-category notice shows next to its original', async () => {
    const user = userEvent.setup();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      supportContentResponse,
    );
    const warning = '기존 공지의 번역이면 원문 공지에서 번역본 등록을 사용하세요. 따로 등록하면 원문이 함께 노출됩니다.';

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await screen.findByText('예매는 어떻게 하나요?');
    await user.click(screen.getByRole('button', { name: '공지 등록' }));
    await user.selectOptions(screen.getByLabelText('분류'), 'urgent');
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('언어'), 'en');
    expect(screen.getByRole('note')).toHaveTextContent(warning);

    await user.selectOptions(screen.getByLabelText('분류'), 'general');
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });

  it('enables review only for content waiting for review and confirms before unpublishing an assisted edit (audit #48)', async () => {
    const user = userEvent.setup();
    const publishedThai = noticeRow({
      id: 'notice-th',
      locale: 'th',
      title: 'ประกาศ',
      body: 'เนื้อหาเดิม',
      status: 'published',
      reviewState: 'published',
      translationUse: 'assisted',
      translationUseLabel: '자동 번역 검수본',
    });
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [],
      notices: [publishedThai],
    });

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole('tab', { name: '공지' }));
    await user.click(screen.getByRole('button', { name: 'ประกาศ' }));
    expect(screen.getByRole('button', { name: '검수 완료' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'ประกาศ 수정' }));
    await user.type(screen.getByLabelText('내용'), ' ใหม่');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(
      await screen.findByRole('alertdialog', { name: '저장하면 게시가 내려갑니다' }),
    ).toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '저장하고 게시 내리기' }));
    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/notices/notice-th',
        expect.objectContaining({ body: 'เนื้อหาเดิม ใหม่' }),
      );
    });
  });

  it('saves a published Korean FAQ edit without a confirmation and sends only changed fields', async () => {
    const user = userEvent.setup();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [
        {
          ...supportContentResponse.faqs[0],
          reviewState: 'published',
          publishedAt: '2026-05-14T02:00:00.000Z',
        },
      ],
      notices: [],
    });

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await user.click(
      await screen.findByRole('button', { name: '예매는 어떻게 하나요? 수정' }),
    );
    expect(
      screen.getByText('게시 중인 콘텐츠입니다. 저장하면 공개 화면에 반영됩니다(최대 1분 지연).'),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('분류'), 'event_info');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/faqs/faq-ko',
        {
          category: 'event_info',
          expectedUpdatedAt: '2026-05-14T01:00:00.000Z',
        },
      );
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('creates urgent notices with urgent priority and an exposure window (audit #134)', async () => {
    const user = userEvent.setup();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      supportContentResponse,
    );

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await screen.findByText('예매는 어떻게 하나요?');
    await user.click(screen.getByRole('button', { name: '공지 등록' }));
    await user.selectOptions(screen.getByLabelText('분류'), 'urgent');
    expect(screen.getByLabelText('중요도')).toHaveValue('urgent');
    await user.type(screen.getByLabelText('노출 종료'), '2026-10-01T23:00');
    await user.type(screen.getByLabelText('제목'), '결제 지연');
    await user.type(screen.getByLabelText('내용'), '결제가 지연되고 있습니다.');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/notices',
        {
          category: 'urgent',
          locale: 'ko',
          title: '결제 지연',
          body: '결제가 지연되고 있습니다.',
          priority: 'urgent',
          translationUse: 'manual',
          endsAt: new Date('2026-10-01T23:00').toISOString(),
        },
      );
    });
  });

  it('registers a linked translation for a Korean urgent notice (audit #168)', async () => {
    const user = userEvent.setup();
    const urgentKo = noticeRow({
      id: 'notice-ko-urgent',
      locale: 'ko',
      category: 'urgent',
      priority: 'urgent',
      title: '결제 장애',
      body: '결제가 지연되고 있습니다.',
      status: 'published',
      reviewState: 'published',
      translationGroupId: 'notice-ko-urgent',
    });
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      faqs: [],
      notices: [urgentKo],
    });

    render(<SupportContentManager />, { wrapper: createWrapper() });
    await user.click(await screen.findByRole('tab', { name: '공지' }));
    expect(
      screen.getByText(
        '게시된 번역본이 없는 언어에는 영어 공지가, 영어도 없으면 한국어 공지가 대신 노출됩니다.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '번역본 등록' }));
    expect(screen.getByLabelText('언어')).toHaveValue('en');
    await user.type(screen.getByLabelText('제목'), 'Payment delay');
    await user.type(screen.getByLabelText('내용'), 'Payments are delayed.');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/support-content/notices',
        expect.objectContaining({
          locale: 'en',
          category: 'urgent',
          priority: 'urgent',
          translationOfNoticeId: 'notice-ko-urgent',
        }),
      );
    });
  });
});
