'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  useCreateTranslationSource,
  useGenerateTranslationDrafts,
  usePublishTranslationDraft,
  useReviewTranslationDraft,
  useTranslationQueue,
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

const STATUS_OPTIONS: Array<{ value: TranslationQueueFilterStatus | ''; label: string }> = [
  { value: '', label: '전체 상태' },
  { value: 'draft', label: '초안' },
  { value: 'review', label: '검수 필요' },
  { value: 'published', label: '게시됨' },
  { value: 'stale', label: '원문 변경됨' },
];

const LOCALE_OPTIONS: Array<{ value: TranslationTargetLocale | ''; label: string }> = [
  { value: '', label: '전체 언어' },
  { value: 'en', label: 'English' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh-CN', label: '简体中文' },
];

export default function AdminTranslationsPage() {
  const [filters, setFilters] = useState<TranslationQueueFilters>({});
  const [selectedDraft, setSelectedDraft] = useState<TranslationQueueRow | null>(
    null,
  );

  const queue = useTranslationQueue(filters);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">번역 검수</h1>
        <p className="mt-2 text-sm text-gray-600">
          한국어 원문 저장 후 자동 번역 초안을 생성하고 검수 및 게시합니다.
        </p>
      </div>

      <TranslationSourceForm
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
      />

      <section className="space-y-3">
        <div className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="translation-filter-type">콘텐츠 유형</Label>
            <Input
              id="translation-filter-type"
              value={filters.contentType ?? ''}
              placeholder="performance"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  contentType: event.target.value || undefined,
                }))
              }
            />
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
          <TranslationReviewTable
            rows={rows}
            isLoading={queue.isLoading}
            selectedDraftId={selectedDraft?.id ?? null}
            onSelectRow={setSelectedDraft}
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
          />
        </div>
      </section>
    </div>
  );
}
