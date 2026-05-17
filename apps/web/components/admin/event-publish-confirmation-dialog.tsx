'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

export interface EventPublishLocaleState {
  locale: 'ko' | 'en' | 'th' | 'zh-CN';
  label: string;
  required: boolean;
  ready: boolean;
}

export interface EventPublishReviewSummary {
  title: string;
  changedFields: string[];
  localeStates: EventPublishLocaleState[];
  venue: {
    name: string;
    address?: string | null;
    accessNotes?: string | null;
  };
  transportSummary?: string | null;
  saleSummary: {
    salesInfo?: string | null;
    paymentMethods: string[];
    maxTicketsPerUser: number;
    seatMapCount: number;
    totalSeats: number;
  };
  contentChecklist: {
    ko: { title: boolean; description: boolean };
    en: { title: boolean; description: boolean };
  };
}

export interface EventPublishConfirmInput {
  reason: string;
  confirmed: true;
  confirmedChangedFields: string[];
  contentChecklist: EventPublishReviewSummary['contentChecklist'];
}

interface EventPublishConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: EventPublishReviewSummary;
  onConfirm: (input: EventPublishConfirmInput) => void | Promise<void>;
  isPublishing?: boolean;
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
      <dt className="text-sm font-semibold text-gray-600">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

export function EventPublishConfirmationDialog({
  open,
  onOpenChange,
  summary,
  onConfirm,
  isPublishing = false,
}: EventPublishConfirmationDialogProps) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason('');
      setConfirmed(false);
    }
  }, [open]);

  const canConfirm = reason.trim().length > 0 && confirmed && !isPublishing;

  async function handleConfirm() {
    if (!canConfirm) return;
    await onConfirm({
      reason: reason.trim(),
      confirmed: true,
      confirmedChangedFields: summary.changedFields,
      contentChecklist: summary.contentChecklist,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] w-full max-w-[640px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>이 이벤트를 게시하시겠습니까?</DialogTitle>
          <DialogDescription>
            게시 후 공개 화면과 판매 설정이 운영 기준으로 반영됩니다. 변경된 필드와 판매 일정을 확인한 뒤 진행하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3 rounded-lg border border-gray-200 bg-[#F5F5F7] p-4">
            <h3 className="text-base font-semibold text-gray-900">
              {summary.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              {summary.changedFields.map((field) => (
                <Badge
                  key={field}
                  className="border-transparent bg-[#F3EFFF] text-[#6C3CE0]"
                >
                  {field}
                </Badge>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-gray-900">
              언어 게시 상태
            </h3>
            <div className="grid gap-2 sm:grid-cols-5">
              {summary.localeStates.map((state) => (
                <div
                  key={state.locale}
                  data-testid="publish-locale-tab"
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                >
                  {state.label}
                  {state.required ? '필수 ' : ''}
                  {state.ready ? '준비됨' : '검수 필요'}
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <dl className="space-y-3">
            <SummaryRow label="장소" value={summary.venue.name || '미입력'} />
            <SummaryRow
              label="주소"
              value={summary.venue.address || '미입력'}
            />
            <SummaryRow
              label="입장 안내"
              value={summary.venue.accessNotes || '미입력'}
            />
            <SummaryRow
              label="교통 안내"
              value={summary.transportSummary || '미입력'}
            />
            <SummaryRow
              label="판매 안내"
              value={summary.saleSummary.salesInfo || '미입력'}
            />
            <SummaryRow
              label="결제 수단"
              value={summary.saleSummary.paymentMethods.join(', ') || '미입력'}
            />
            <SummaryRow
              label="예매 제한"
              value={`1인 ${summary.saleSummary.maxTicketsPerUser}매`}
            />
            <SummaryRow
              label="좌석맵"
              value={`${summary.saleSummary.seatMapCount.toLocaleString('ko-KR')}개 층 / ${summary.saleSummary.totalSeats.toLocaleString('ko-KR')}석`}
            />
          </dl>

          <div className="space-y-2">
            <label
              htmlFor="publish-reason"
              className="block text-sm font-semibold text-gray-700"
            >
              게시 사유
            </label>
            <Textarea
              id="publish-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="게시 사유를 입력하세요"
            />
          </div>

          <label
            htmlFor="publish-confirmation"
            className="flex min-h-11 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
          >
            <Checkbox
              id="publish-confirmation"
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            변경된 필드와 판매 일정을 확인했습니다
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={handleConfirm}>
            {isPublishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                게시 중...
              </>
            ) : (
              '이벤트 게시하기'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
