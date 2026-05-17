import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { apiClient } from '@/lib/api-client';
import {
  useCreateTranslationSource,
  useGenerateTranslationDrafts,
  usePublishTranslationDraft,
  useReviewTranslationDraft,
} from '@/hooks/use-admin';
import {
  TranslationReviewTable,
  type TranslationQueueRow,
} from '../translation-review-table';
import { TranslationSourceForm } from '../translation-source-form';
import { TranslationReviewDetailPanel } from '../translation-review-detail-panel';

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

const draftRow: TranslationQueueRow = {
  id: 'draft-en',
  sourceId: 'source-1',
  sourceTitle: '걸스 룰즈 팬미팅',
  contentType: 'performance',
  field: 'description',
  locale: 'en',
  status: 'draft',
  sourceText: '한국어 원문입니다.',
  translatedText: 'English draft',
  updatedAt: '2026-05-06T07:00:00.000Z',
  reviewerId: null,
  automaticTranslationLabel: true,
};

const legacyLocaleLabel = String.fromCharCode(0x65e5, 0x672c, 0x8a9e);

describe('admin translation review workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes source, generate, review/edit, and publish mutation hooks', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'source-1' })
      .mockResolvedValueOnce([{ id: 'draft-en' }])
      .mockResolvedValueOnce({ id: 'draft-en', status: 'review' })
      .mockResolvedValueOnce({ id: 'draft-en', status: 'published' });

    const wrapper = createWrapper();
    const createSource = renderHook(() => useCreateTranslationSource(), {
      wrapper,
    });
    const generateDrafts = renderHook(() => useGenerateTranslationDrafts(), {
      wrapper,
    });
    const reviewDraft = renderHook(() => useReviewTranslationDraft(), {
      wrapper,
    });
    const publishDraft = renderHook(() => usePublishTranslationDraft(), {
      wrapper,
    });

    await createSource.result.current.mutateAsync({
      entityType: 'performance',
      entityId: '11111111-1111-4111-8111-111111111111',
      field: 'description',
      sourceText: '한국어 원문입니다.',
    });
    await generateDrafts.result.current.mutateAsync('source-1');
    await reviewDraft.result.current.mutateAsync({
      draftId: 'draft-en',
      translatedText: 'Reviewed English draft',
    });
    await publishDraft.result.current.mutateAsync('draft-en');

    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/translations/sources',
      {
        entityType: 'performance',
        entityId: '11111111-1111-4111-8111-111111111111',
        field: 'description',
        sourceText: '한국어 원문입니다.',
      },
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/translations/sources/source-1/drafts',
      {},
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      3,
      '/api/v1/admin/translations/drafts/draft-en/review',
      {
        translatedText: 'Reviewed English draft',
      },
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      4,
      '/api/v1/admin/translations/drafts/draft-en/publish',
      {},
    );
  });

  it('lets an operator create Korean source content and generate launch locale drafts', async () => {
    const user = userEvent.setup();
    const onCreateSource = vi.fn().mockResolvedValue({ id: 'source-1' });
    const onGenerateDrafts = vi.fn().mockResolvedValue([]);

    render(
      <TranslationSourceForm
        onCreateSource={onCreateSource}
        onGenerateDrafts={onGenerateDrafts}
        isCreating={false}
        isGenerating={false}
      />,
    );

    await user.type(screen.getByLabelText('콘텐츠 ID'), 'perf-1');
    await user.type(screen.getByLabelText('원문 제목'), '걸스 룰즈 팬미팅');
    await user.type(screen.getByLabelText('한국어 원문'), '한국어 원문입니다.');
    await user.click(screen.getByRole('button', { name: '원문 저장' }));
    await user.click(
      screen.getByRole('button', { name: 'en/th/zh-CN 초안 생성' }),
    );

    expect(onCreateSource).toHaveBeenCalledWith({
      entityType: 'performance',
      entityId: 'perf-1',
      field: 'description',
      sourceText: '걸스 룰즈 팬미팅\n\n한국어 원문입니다.',
    });
    expect(onGenerateDrafts).toHaveBeenCalledWith('source-1');
  });

  it('catches source creation and draft generation failures without leaking rejected promises', async () => {
    const user = userEvent.setup();
    const onCreateSource = vi
      .fn()
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ id: 'source-1' });
    const onGenerateDrafts = vi.fn().mockRejectedValue(new Error('generate failed'));

    render(
      <TranslationSourceForm
        onCreateSource={onCreateSource}
        onGenerateDrafts={onGenerateDrafts}
        isCreating={false}
        isGenerating={false}
      />,
    );

    await user.type(screen.getByLabelText('콘텐츠 ID'), 'perf-1');
    await user.type(screen.getByLabelText('원문 제목'), '걸스 룰즈 팬미팅');
    await user.type(screen.getByLabelText('한국어 원문'), '한국어 원문입니다.');

    await user.click(screen.getByRole('button', { name: '원문 저장' }));
    expect(
      screen.getByRole('button', { name: 'en/th/zh-CN 초안 생성' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '원문 저장' }));
    await user.click(
      screen.getByRole('button', { name: 'en/th/zh-CN 초안 생성' }),
    );

    await waitFor(() => {
      expect(onGenerateDrafts).toHaveBeenCalledWith('source-1');
    });
  });

  it('covers loading, empty, status, legal-blocked, and keyboard row activation states', async () => {
    const onSelectRow = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <TranslationReviewTable
        rows={[]}
        isLoading
        selectedDraftId={null}
        onSelectRow={onSelectRow}
      />,
    );

    expect(screen.getAllByTestId('translation-row-skeleton')).toHaveLength(5);

    rerender(
      <TranslationReviewTable
        rows={[]}
        isLoading={false}
        selectedDraftId={null}
        onSelectRow={onSelectRow}
      />,
    );

    expect(screen.getByText('검수할 항목이 없습니다')).toBeInTheDocument();
    expect(
      screen.getByText(
        '한국어 원문을 저장하면 번역 초안과 검수 항목이 여기에 표시됩니다.',
      ),
    ).toBeInTheDocument();

    const rows: TranslationQueueRow[] = [
      draftRow,
      { ...draftRow, id: 'draft-review', status: 'review', locale: 'th' },
      { ...draftRow, id: 'draft-published', status: 'published', locale: 'zh-CN' },
      { ...draftRow, id: 'draft-stale', status: 'stale', locale: 'en' },
      {
        ...draftRow,
        id: 'draft-blocked',
        contentType: 'legal',
        status: 'legal_blocked',
      },
    ];

    rerender(
      <TranslationReviewTable
        rows={rows}
        isLoading={false}
        selectedDraftId={null}
        onSelectRow={onSelectRow}
      />,
    );

    expect(screen.getByText('초안')).toBeInTheDocument();
    expect(screen.getByText('검수 필요')).toBeInTheDocument();
    expect(screen.getByText('게시됨')).toBeInTheDocument();
    expect(screen.getByText('원문 변경됨')).toBeInTheDocument();
    expect(screen.getByText('자동 번역 불가')).toBeInTheDocument();
    expect(screen.queryByText(legacyLocaleLabel)).not.toBeInTheDocument();

    await user.keyboard('{Tab}{Enter}');
    expect(onSelectRow).toHaveBeenCalledWith(rows[0]);
  });

  it('lets an operator edit, review, and publish a reviewed draft while previewing the label', async () => {
    const user = userEvent.setup();
    const onReviewDraft = vi.fn().mockResolvedValue({ ...draftRow, status: 'review' });
    const onPublishDraft = vi
      .fn()
      .mockResolvedValue({ ...draftRow, status: 'published' });

    render(
      <TranslationReviewDetailPanel
        draft={draftRow}
        onReviewDraft={onReviewDraft}
        onPublishDraft={onPublishDraft}
        isReviewing={false}
        isPublishing={false}
      />,
    );

    expect(screen.getByText('한국어 원문입니다.')).toBeInTheDocument();
    expect(screen.getByText('자동 번역 검수본')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('번역 검수문'));
    await user.type(screen.getByLabelText('번역 검수문'), 'Reviewed final text');
    await user.click(screen.getByRole('button', { name: '검수 완료' }));

    await waitFor(() => {
      expect(onReviewDraft).toHaveBeenCalledWith({
        draftId: 'draft-en',
        translatedText: 'Reviewed final text',
      });
    });

    await user.click(screen.getByRole('button', { name: '게시' }));
    expect(onPublishDraft).toHaveBeenCalledWith('draft-en');
  });

  it('disables review for already published drafts', () => {
    render(
      <TranslationReviewDetailPanel
        draft={{ ...draftRow, status: 'published' }}
        onReviewDraft={vi.fn()}
        onPublishDraft={vi.fn()}
        isReviewing={false}
        isPublishing={false}
      />,
    );

    expect(screen.getByRole('button', { name: '검수 완료' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '게시' })).toBeEnabled();
  });

  it('shows an error state instead of falling back to translated text when source text is missing', () => {
    render(
      <TranslationReviewDetailPanel
        draft={{ ...draftRow, sourceText: '' }}
        onReviewDraft={vi.fn()}
        onPublishDraft={vi.fn()}
        isReviewing={false}
        isPublishing={false}
      />,
    );

    expect(
      screen.getByText(
        '한국어 원문 정보를 불러오지 못했습니다. 원문을 확인한 뒤 다시 시도하세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('원문 정보를 불러오지 못했습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '검수 완료' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '게시' })).toBeDisabled();
  });
});
