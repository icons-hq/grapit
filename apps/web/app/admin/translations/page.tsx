'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  useCreateTranslationSource,
  useGenerateTranslationDrafts,
  usePublishTranslationDraft,
  useReviewTranslationDraft,
  useTranslationQueue,
  useAdminPerformanceDetail,
  type TranslationQueueFilters,
  type TranslationQueueFilterStatus,
  type TranslationTargetLocale,
} from '@/hooks/use-admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TranslationReviewDetailPanel } from '@/components/admin/translation-review-detail-panel';
import {
  TranslationReviewTable,
  type TranslationQueueRow,
} from '@/components/admin/translation-review-table';
import { TranslationSourceForm } from '@/components/admin/translation-source-form';
import { useAdminEventContext } from '@/components/admin/admin-event-context';
import { resolveAdminCapabilitySnapshot } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';

const STATUS_OPTIONS: Array<{ value: TranslationQueueFilterStatus | ''; label: string }> = [
  { value: '', label: '전체 상태' },
  { value: 'draft', label: '초안' },
  { value: 'review', label: '게시 승인 대기' },
  { value: 'published', label: '게시됨' },
  { value: 'stale', label: '원문 변경됨' },
];

const LOCALE_OPTIONS: Array<{ value: TranslationTargetLocale | ''; label: string }> = [
  { value: '', label: '전체 언어' },
  { value: 'en', label: '영어' },
  { value: 'th', label: '태국어' },
  { value: 'zh-CN', label: '중국어' },
];

export default function AdminTranslationsPage() {
  const [filters, setFilters] = useState<TranslationQueueFilters>({});
  const context = useAdminEventContext();
  const performance = useAdminPerformanceDetail(context?.performanceId ?? '');
  const user = useAuthStore((state) => state.user);
  const capabilities = resolveAdminCapabilitySnapshot(user);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    null,
  );

  const queue = useTranslationQueue({ ...filters, ...(context?.performanceId ? { contentType: 'performance', entityId: context.performanceId } : {}) });
  const createSource = useCreateTranslationSource();
  const generateDrafts = useGenerateTranslationDrafts();
  const reviewDraft = useReviewTranslationDraft();
  const publishDraft = usePublishTranslationDraft();

  const rows = useMemo<TranslationQueueRow[]>(
    () =>
      (queue.data ?? []).map((row) => ({
        ...row,
        sourceTitle: row.sourceTitle ?? row.sourceText ?? row.sourceId,
      })),
    [queue.data],
  );
  const selectedDraft = rows.find((row) => row.id === selectedDraftId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">번역 검수</h1>
        <p className="mt-2 text-sm text-gray-600">
          한국어 원문 저장 후 자동 번역 초안을 생성하고 검수 및 게시합니다.
        </p>
      </div>

      {!context?.performanceId && <p className="rounded-sm border border-border bg-white p-4 text-sm text-muted-foreground">상단에서 공연을 선택하면 저장된 한국어 안내를 불러와 번역할 수 있습니다.</p>}
      <details className="admin-disclosure" key={context?.performanceId ?? 'general-source'} open={Boolean(context?.performanceId)}><summary>{context?.performanceId ? '선택한 공연의 번역 초안 만들기' : '기타 콘텐츠 원문 직접 등록'}</summary><div className="admin-disclosure-body">
      {context?.performanceId && (performance.isLoading || performance.isError) ? <p role={performance.isError ? 'alert' : 'status'}>{performance.isError ? '공연 원문을 조회하지 못했습니다.' : '공연 원문을 불러오고 있습니다.'}</p> : <TranslationSourceForm
        key={context?.performanceId ?? 'general'}
        performance={performance.data}
        onCreateSource={(input) =>
          createSource.mutateAsync(input, {
            onSuccess: () => toast.success('원문이 저장되었습니다.'),
            onError: () => toast.error('원문 저장에 실패했습니다.'),
          })
        }
        onGenerateDrafts={(sourceId) =>
          generateDrafts.mutateAsync(sourceId, {
            onSuccess: () => toast.success('번역 초안이 생성되었습니다.'),
            onError: () => toast.error('번역 초안 생성에 실패했습니다.'),
          })
        }
        isCreating={createSource.isPending}
        isGenerating={generateDrafts.isPending}
      />}
      </div></details>

      <section className="space-y-3">
        <div className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="translation-filter-type">콘텐츠 유형</Label>
            <select id="translation-filter-type" value={context?.performanceId ? 'performance' : filters.contentType ?? ''} disabled={Boolean(context?.performanceId)} className="h-11 w-full rounded-sm border border-input bg-white px-3 text-sm"
              onChange={(event) => setFilters((current) => ({ ...current, contentType: event.target.value || undefined }))}>
              <option value="">전체 콘텐츠</option><option value="performance">공연</option><option value="banner">배너</option><option value="notice">공지</option><option value="legal">약관·정책</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="translation-filter-locale">언어</Label>
            <select
              id="translation-filter-locale"
              value={filters.locale ?? ''}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  locale: event.target.value as TranslationTargetLocale | '',
                }))
              }
              className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="translation-filter-status">상태</Label>
            <select
              id="translation-filter-status"
              value={filters.status ?? ''}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as TranslationQueueFilterStatus | '',
                }))
              }
              className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="translation-filter-from">업데이트 시작</Label>
            <Input
              id="translation-filter-from"
              type="date"
              value={filters.updatedFrom ?? ''}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  updatedFrom: event.target.value || undefined,
                }))
              }
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setFilters({})}
            >
              초기화
            </Button>
          </div>
        </div>

        {queue.isError && (
          <div
            role="alert"
            className="rounded-lg bg-[#FEF2F2] p-4 text-sm font-semibold text-[#C62828]"
          >
            정보를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 운영자에게 문의하세요.
          </div>
        )}

        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_460px]">
          <TranslationReviewTable
            rows={rows}
            isLoading={queue.isLoading}
            selectedDraftId={selectedDraft?.id ?? null}
            onSelectRow={(row) => setSelectedDraftId(row.id)}
          />
          <TranslationReviewDetailPanel
            draft={selectedDraft}
            onReviewDraft={(input) =>
              reviewDraft.mutateAsync(input, {
                onSuccess: () => toast.success('검수가 완료되었습니다.'),
                onError: () => toast.error('검수 저장에 실패했습니다.'),
              })
            }
            onPublishDraft={(draftId) =>
              publishDraft.mutateAsync(draftId, {
                onSuccess: () => toast.success('번역이 게시되었습니다.'),
                onError: () => toast.error('게시할 수 없습니다.'),
              })
            }
            isReviewing={reviewDraft.isPending}
            isPublishing={publishDraft.isPending}
            canPublish={capabilities.superuser || capabilities.capabilities.includes('event.publish')}
          />
        </div>
      </section>
    </div>
  );
}
