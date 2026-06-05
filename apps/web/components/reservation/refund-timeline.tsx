'use client';

import { AlertCircle, CheckCircle2, Circle, Clock3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type {
  CancelledSeatHold,
  RefundTimeline as RefundTimelineData,
  RefundTimelineState,
} from '@grabit/shared';

const TIMELINE_STEPS: Array<{
  state: RefundTimelineState;
  label: string;
  description: string;
}> = [
  {
    state: 'REQUESTED',
    label: '환불 요청됨',
    description: '예매 취소 요청이 접수되었습니다.',
  },
  {
    state: 'SENT_TO_PG',
    label: '환불 요청 전달됨',
    description: '환불 요청이 결제수단으로 전달되었습니다.',
  },
  {
    state: 'PROCESSING_AT_PG',
    label: '환불 처리 중',
    description: '결제사 또는 카드사에서 환불을 처리하고 있습니다.',
  },
  {
    state: 'COMPLETED',
    label: '환불 완료',
    description: '환불 반영이 완료되었습니다.',
  },
  {
    state: 'FAILED',
    label: '환불 실패',
    description: '수동 확인이 필요한 상태입니다.',
  },
];

const STEP_ORDER: RefundTimelineState[] = [
  'REQUESTED',
  'SENT_TO_PG',
  'PROCESSING_AT_PG',
  'COMPLETED',
];

const REOPEN_NOTICE =
  '취소된 좌석은 즉시 재오픈되지 않을 수 있으며, 잠시 후 다시 판매될 수 있습니다';

function formatDateTime(dateString?: string | null): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const day = days[date.getDay()];
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} (${day}) ${h}:${min}`;
}

function getTimestamp(
  timeline: RefundTimelineData,
  state: RefundTimelineState,
): string | null {
  switch (state) {
    case 'REQUESTED':
      return timeline.requestedAt;
    case 'SENT_TO_PG':
      return timeline.sentToPgAt ?? null;
    case 'PROCESSING_AT_PG':
      return timeline.processedAtPgAt ?? null;
    case 'COMPLETED':
      return timeline.completedAt ?? null;
    case 'FAILED':
      return timeline.failedAt ?? null;
    default:
      return null;
  }
}

function getStepVisualState(
  timeline: RefundTimelineData,
  state: RefundTimelineState,
): 'complete' | 'current' | 'pending' | 'failed' {
  if (state === 'FAILED') {
    return timeline.currentState === 'FAILED' ? 'failed' : 'pending';
  }

  if (timeline.currentState === 'FAILED') {
    return getTimestamp(timeline, state) ? 'complete' : 'pending';
  }

  const currentIndex = STEP_ORDER.indexOf(timeline.currentState);
  const stepIndex = STEP_ORDER.indexOf(state);

  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return 'current';
  return 'pending';
}

function TimelineIcon({
  visualState,
}: {
  visualState: 'complete' | 'current' | 'pending' | 'failed';
}) {
  if (visualState === 'complete') {
    return <CheckCircle2 className="h-5 w-5 text-[#15803D]" aria-hidden="true" />;
  }

  if (visualState === 'current') {
    return <Clock3 className="h-5 w-5 text-[#6C3CE0]" aria-hidden="true" />;
  }

  if (visualState === 'failed') {
    return <AlertCircle className="h-5 w-5 text-[#C62828]" aria-hidden="true" />;
  }

  return <Circle className="h-5 w-5 text-gray-300" aria-hidden="true" />;
}

function renderHoldCopy(cancelledSeatHold: CancelledSeatHold | null) {
  if (!cancelledSeatHold) {
    return REOPEN_NOTICE;
  }

  if (cancelledSeatHold.status === 'MANUAL_OPENED') {
    return '운영자 확인 후 좌석이 다시 판매 가능 상태로 열렸습니다.';
  }

  if (cancelledSeatHold.status === 'RELEASED') {
    return '취소 좌석의 지연 보류가 끝나 다시 판매 가능한 상태가 되었습니다.';
  }

  return REOPEN_NOTICE;
}

export function RefundTimeline({
  timeline,
  cancelledSeatHold,
}: {
  timeline: RefundTimelineData;
  cancelledSeatHold: CancelledSeatHold | null;
}) {
  const expectedDepositAt = formatDateTime(timeline.expectedDepositAt);
  const releaseAt = formatDateTime(cancelledSeatHold?.releaseAt);
  const currentLabel =
    TIMELINE_STEPS.find((step) => step.state === timeline.currentState)?.label ??
    '환불 상태';

  return (
    <Card className="mt-4 border-[#E9DFFF] bg-[#FAF7FF] py-4">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-gray-900">환불 진행 현황</h2>
            <p className="text-sm text-gray-700">
              환불 단계별 상태와 지연 시 후속 조치를 확인하세요.
            </p>
          </div>
          <Badge
            className={cn(
              'border-transparent',
              timeline.currentState === 'FAILED'
                ? 'bg-[#FEF2F2] text-[#C62828]'
                : timeline.currentState === 'COMPLETED'
                  ? 'bg-[#F0FDF4] text-[#15803D]'
                  : 'bg-[#F3EFFF] text-[#6C3CE0]',
            )}
          >
            {currentLabel}
          </Badge>
        </div>

        <div className="space-y-3 rounded-xl border border-white/80 bg-white/90 p-4">
          {TIMELINE_STEPS.map((step) => {
            const visualState = getStepVisualState(timeline, step.state);
            const timestamp = formatDateTime(getTimestamp(timeline, step.state));

            return (
              <div key={step.state} className="flex gap-3">
                <div className="pt-0.5">
                  <TimelineIcon visualState={visualState} />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        visualState === 'failed'
                          ? 'text-[#C62828]'
                          : visualState === 'pending'
                            ? 'text-gray-400'
                            : 'text-gray-900',
                      )}
                    >
                      {step.label}
                    </span>
                    {timestamp && (
                      <span className="text-xs text-gray-500">{timestamp}</span>
                    )}
                  </div>
                  <p
                    className={cn(
                      'text-sm',
                      visualState === 'pending' ? 'text-gray-400' : 'text-gray-600',
                    )}
                  >
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-3 rounded-xl border border-[#E5D9FF] bg-white/85 p-4">
          {expectedDepositAt && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">예상 입금 시점</span>
              <span className="text-right text-sm font-semibold text-gray-900">
                {expectedDepositAt}
              </span>
            </div>
          )}
          <p className="text-sm text-gray-700">{renderHoldCopy(cancelledSeatHold)}</p>
          {releaseAt && cancelledSeatHold?.status === 'HELD' && (
            <p className="text-sm text-gray-700">
              재판매 가능 시점은 {releaseAt} 전후로 순차 반영될 수 있습니다.
            </p>
          )}
        </div>

        {(timeline.customerServiceCtaVisible || timeline.currentState === 'FAILED') && (
          <div
            role="alert"
            className={cn(
              'rounded-xl border p-4 text-sm',
              timeline.currentState === 'FAILED'
                ? 'border-[#F6C7C7] bg-[#FEF2F2] text-[#8F1D1D]'
                : 'border-[#F7E0A0] bg-[#FFFBEB] text-[#8B6306]',
            )}
          >
            {timeline.currentState === 'FAILED'
              ? '환불 처리가 지연되었거나 실패했습니다. 결제 수단 상태를 확인한 뒤 고객센터로 문의해주세요.'
              : '예상 입금 시점이 지나도 환불 완료가 보이지 않으면 고객센터로 문의해주세요.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
