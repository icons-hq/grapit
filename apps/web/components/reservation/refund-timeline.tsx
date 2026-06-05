'use client';

import { AlertCircle, CheckCircle2, Circle, Clock3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { getVisibleCopy, type VisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import type {
  CancelledSeatHold,
  RefundTimeline as RefundTimelineData,
  RefundTimelineState,
} from '@grabit/shared';

type TimelineStep = {
  state: RefundTimelineState;
  label: string;
  description: string;
};

const STEP_ORDER: RefundTimelineState[] = [
  'REQUESTED',
  'SENT_TO_PG',
  'PROCESSING_AT_PG',
  'COMPLETED',
];

function formatDateTime(dateString: string | null | undefined, locale: string): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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

type RefundCopy = VisibleCopy['reservation']['refund'];

function getTimelineSteps(copy: RefundCopy): TimelineStep[] {
  return [
    { state: 'REQUESTED', ...copy.steps.requested },
    { state: 'SENT_TO_PG', ...copy.steps.sentToPg },
    { state: 'PROCESSING_AT_PG', ...copy.steps.processingAtPg },
    { state: 'COMPLETED', ...copy.steps.completed },
    { state: 'FAILED', ...copy.steps.failed },
  ];
}

function renderHoldCopy(
  cancelledSeatHold: CancelledSeatHold | null,
  copy: RefundCopy,
) {
  if (!cancelledSeatHold) {
    return copy.description;
  }

  if (cancelledSeatHold.status === 'MANUAL_OPENED') {
    return copy.manualOpened;
  }

  if (cancelledSeatHold.status === 'RELEASED') {
    return copy.released;
  }

  return copy.description;
}

export function RefundTimeline({
  timeline,
  cancelledSeatHold,
}: {
  timeline: RefundTimelineData;
  cancelledSeatHold: CancelledSeatHold | null;
}) {
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).reservation.refund;
  const timelineSteps = getTimelineSteps(copy);
  const expectedDepositAt = formatDateTime(timeline.expectedDepositAt, locale);
  const releaseAt = formatDateTime(cancelledSeatHold?.releaseAt, locale);
  const currentLabel =
    timelineSteps.find((step) => step.state === timeline.currentState)?.label ??
    copy.statusFallback;

  return (
    <Card className="mt-4 border-[#E9DFFF] bg-[#FAF7FF] py-4">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-gray-900">{copy.title}</h2>
            <p className="text-sm text-gray-700">
              {copy.description}
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
          {timelineSteps.map((step) => {
            const visualState = getStepVisualState(timeline, step.state);
            const timestamp = formatDateTime(getTimestamp(timeline, step.state), locale);

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
              <span className="text-sm text-gray-600">{copy.expectedDeposit}</span>
              <span className="text-right text-sm font-semibold text-gray-900">
                {expectedDepositAt}
              </span>
            </div>
          )}
          <p className="text-sm text-gray-700">{renderHoldCopy(cancelledSeatHold, copy)}</p>
          {releaseAt && cancelledSeatHold?.status === 'HELD' && (
            <p className="text-sm text-gray-700">
              {copy.releaseNotice.replace('{releaseAt}', releaseAt)}
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
              ? copy.failedBody
              : copy.delayedBody}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
