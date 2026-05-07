'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AutomaticTranslationLabel } from '@/components/i18n/automatic-translation-label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ReviewTranslationDraftInput } from '@/hooks/use-admin';
import type { TranslationQueueRow } from './translation-review-table';

interface TranslationReviewDetailPanelProps {
  draft: TranslationQueueRow | null;
  onReviewDraft: (input: ReviewTranslationDraftInput) => Promise<unknown>;
  onPublishDraft: (draftId: string) => Promise<unknown>;
  isReviewing: boolean;
  isPublishing: boolean;
}

export function TranslationReviewDetailPanel({
  draft,
  onReviewDraft,
  onPublishDraft,
  isReviewing,
  isPublishing,
}: TranslationReviewDetailPanelProps) {
  const [translatedText, setTranslatedText] = useState('');
  const [reviewedDraftId, setReviewedDraftId] = useState<string | null>(null);

  useEffect(() => {
    setTranslatedText(draft?.translatedText ?? '');
    setReviewedDraftId(null);
  }, [draft?.id, draft?.translatedText]);

  if (!draft) {
    return (
      <aside className="rounded-lg bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-900">
          검수할 번역 행을 선택하세요.
        </p>
        <p className="mt-1 text-sm text-gray-600">
          원문과 번역 초안을 나란히 확인한 뒤 검수 완료 및 게시를 진행합니다.
        </p>
      </aside>
    );
  }

  const isBlocked = draft.status === 'legal_blocked';
  const isStale = draft.status === 'stale';
  const sourceText =
    typeof draft.sourceText === 'string' ? draft.sourceText.trim() : '';
  const isMissingSourceText = sourceText.length === 0;
  const canReview =
    draft.status === 'draft' &&
    !isBlocked &&
    !isStale &&
    !isMissingSourceText &&
    translatedText.trim().length > 0;
  const canPublish =
    !isBlocked &&
    !isStale &&
    !isMissingSourceText &&
    (draft.status === 'review' ||
      draft.status === 'published' ||
      reviewedDraftId === draft.id);

  async function handleReview() {
    if (!draft || !canReview) return;
    await onReviewDraft({
      draftId: draft.id,
      translatedText: translatedText.trim(),
    });
    setReviewedDraftId(draft.id);
  }

  return (
    <aside className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-heading font-semibold leading-[1.2]">
            번역 검수
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {draft.contentType} · {draft.field ?? 'content'} · {draft.locale}
          </p>
        </div>
        {(draft.automaticTranslationLabel ||
          draft.isMachineTranslated ||
          draft.translatedBy) && (
          <AutomaticTranslationLabel locale={draft.locale} />
        )}
      </div>

      {isBlocked && (
        <div
          role="alert"
          className="mt-4 flex gap-2 rounded-lg bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          법적 고지와 안내성 정책 문구는 자동 번역할 수 없습니다.
        </div>
      )}

      {isStale && (
        <div className="mt-4 rounded-lg bg-[#FFFBEB] p-3 text-sm font-semibold text-[#8B6306]">
          원문 변경됨 상태입니다. 다시 초안을 생성한 뒤 검수하세요.
        </div>
      )}

      {isMissingSourceText && (
        <div
          role="alert"
          className="mt-4 rounded-lg bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]"
        >
          한국어 원문 정보를 불러오지 못했습니다. 원문을 확인한 뒤 다시 시도하세요.
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">한국어 원문</h3>
            <Badge
              variant="outline"
              className="border-transparent bg-[#F5F5F7] text-gray-700"
            >
              ko
            </Badge>
          </div>
          <div className="min-h-[180px] whitespace-pre-wrap rounded-lg border bg-[#F5F5F7] p-3 text-sm text-gray-900">
            {sourceText || '원문 정보를 불러오지 못했습니다.'}
          </div>
        </section>

        <section className="space-y-2">
          <Label htmlFor="translation-reviewed-text">번역 검수문</Label>
          <Textarea
            id="translation-reviewed-text"
            value={translatedText}
            onChange={(event) => setTranslatedText(event.target.value)}
            rows={8}
            disabled={isBlocked || isStale}
          />
        </section>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={!canReview || isReviewing}
          onClick={() => void handleReview()}
        >
          검수 완료
        </Button>
        <Button
          type="button"
          disabled={!canPublish || isPublishing}
          onClick={() => void onPublishDraft(draft.id)}
        >
          게시
        </Button>
      </div>
    </aside>
  );
}
