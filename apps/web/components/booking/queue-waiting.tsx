'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  Hourglass,
  ShieldAlert,
  TimerReset,
  Ticket,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { QueueStatus } from '@/hooks/use-queue';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { formatCopy } from '@/lib/i18n/client-copy';
import { cn } from '@/lib';

type QueueWaitingProps = {
  status: QueueStatus;
  position: number;
  etaSeconds: number;
  // true while the server has not observed enough queue movement for an ETA.
  etaPending?: boolean;
  remainingSeats: number;
  autoEnter: boolean;
  // Booking open time on this device's clock (server-offset corrected).
  bookingOpensAt?: number | null;
  showEnterNow?: boolean;
  onRetry?: () => void;
  onEnterNow?: () => void;
  onBack?: () => void;
};

type SurfaceCopy = {
  badge: string;
  title: string;
  description: string;
  helper: string;
};

type QueueCopy = {
  status: Record<QueueStatus, SurfaceCopy>;
  metrics: {
    position: string;
    eta: string;
    remainingSeats: string;
    ready: string;
    soon: string;
    etaCalculating: string;
    etaUnderMinute: string;
    etaAbout: string;
    etaRange: string;
    opensIn: string;
    opening: string;
    openTimeUnknown: string;
  };
  infoLabel: string;
  autoEnterInfo: string;
  safetyInfo: string;
  etaInfo: string;
  soldOutRisk: string;
  retryAction: string;
  enterNowAction: string;
  backAction: string;
};

const FALLBACK_QUEUE_COPY: QueueCopy = {
  status: {
    loading: {
      badge: '대기열 확인 중',
      title: '예매 대기열에서 입장 순서를 기다리고 있습니다',
      description: '예매 가능한 순번과 남은 좌석 수를 불러오고 있습니다.',
      helper: '대기열 상태는 잠시 후 자동으로 갱신됩니다.',
    },
    notOpen: {
      badge: '오픈 전',
      title: '예매 오픈 전입니다. 오픈 시각에 자동으로 대기열에 입장합니다',
      description: '이 화면을 열어 두면 오픈 시각에 맞춰 자동으로 입장을 시도합니다.',
      helper: '새로고침이나 반복 클릭은 필요하지 않습니다. 남은 시간은 서버 시각 기준입니다.',
    },
    waiting: {
      badge: '대기 중',
      title: '예매 대기열에서 입장 순서를 기다리고 있습니다',
      description: '순번이 가까워지면 예매 화면으로 자동 이동합니다.',
      helper: '새로고침하지 않아도 현재 순번과 예상 대기 시간이 계속 갱신됩니다.',
    },
    admitted: {
      badge: '입장 준비',
      title: '입장 가능 상태입니다. 예매 화면으로 이동합니다',
      description: '자동으로 이동하지 않으면 아래 버튼으로 바로 입장할 수 있습니다.',
      helper: '입장이 승인되면 실시간 좌석 현황과 타이머가 바로 표시됩니다.',
    },
    expired: {
      badge: '입장 만료',
      title: '입장 시간이 만료되었습니다. 대기열로 다시 이동합니다',
      description: '새로운 순번을 받아 다시 예매 대기열에 입장해주세요.',
      helper: '재입장 후에도 남은 좌석 수와 예상 대기 시간은 계속 확인할 수 있습니다.',
    },
    closed: {
      badge: '예매 불가',
      title: '지금 예매할 수 있는 회차가 없습니다',
      description: '판매가 종료되었거나 모든 회차가 이미 시작되었습니다.',
      helper: '공연 정보에서 다른 일정이나 판매 상태를 확인해주세요.',
    },
    authRequired: {
      badge: '로그인 필요',
      title: '로그인 후 예매 대기열에 입장할 수 있습니다',
      description: '로그인 상태를 확인한 뒤 다시 예매를 진행해주세요.',
      helper: '로그인이 완료되면 예매 버튼을 눌러 대기열에 입장할 수 있습니다.',
    },
    retry: {
      badge: '재시도 필요',
      title: '요청이 많습니다. 잠시 후 다시 시도해주세요',
      description: '잠시 기다린 뒤 다시 시도하면 현재 대기열 상태를 다시 확인합니다.',
      helper: '반복 클릭보다는 잠시 후 재시도가 더 빠르게 상태를 복구합니다.',
    },
    challenge: {
      badge: '보안 확인',
      title: '보안 확인 후 다시 시도해주세요',
      description: '비정상 패턴이 감지되어 추가 확인이 필요합니다.',
      helper: '페이지를 새로고침하거나 잠시 후 다시 시도해 주세요.',
    },
    blocked: {
      badge: '요청 차단',
      title:
        '비정상적인 접근으로 요청이 차단되었습니다. 반복되면 고객센터에 문의해주세요',
      description:
        '같은 브라우저에서 반복된 비정상 요청이 감지되어 예매 진입이 제한되었습니다.',
      helper: '차단이 계속되면 잠시 후 다시 시도하거나 고객센터에 문의해주세요.',
    },
  },
  metrics: {
    position: '현재 순번',
    eta: '예상 대기',
    remainingSeats: '남은 좌석',
    ready: '입장 가능',
    soon: '곧 입장',
    etaCalculating: '계산 중',
    etaUnderMinute: '1분 이내',
    etaAbout: '약 {minutes}분',
    etaRange: '약 {min}~{max}분',
    opensIn: '오픈까지',
    opening: '입장 시도 중',
    openTimeUnknown: '오픈 시각 확인 중',
  },
  infoLabel: '안내',
  autoEnterInfo: '입장이 승인되면 자동으로 좌석 선택 화면으로 이어집니다.',
  safetyInfo:
    '대기열 순번, 예상 시간, 남은 좌석 수만 노출되며 내부 인증 정보는 표시되지 않습니다.',
  etaInfo:
    '예상 대기 시간은 최근 대기열이 줄어든 속도로 계산하며, 상황에 따라 달라질 수 있습니다.',
  soldOutRisk:
    '앞선 대기 인원이 남은 좌석보다 많아 순서가 오기 전에 매진될 수 있습니다.',
  retryAction: '다시 시도',
  enterNowAction: '지금 입장하기',
  backAction: '공연 정보로 돌아가기',
};

const SURFACE_ICONS = {
  loading: Hourglass,
  notOpen: CalendarClock,
  waiting: Hourglass,
  admitted: CheckCircle2,
  expired: TimerReset,
  closed: CalendarX,
  authRequired: ShieldAlert,
  retry: AlertTriangle,
  challenge: ShieldAlert,
  blocked: ShieldAlert,
} as const;

const SURFACE_TONES = {
  loading: 'secondary',
  notOpen: 'secondary',
  waiting: 'secondary',
  admitted: 'default',
  expired: 'outline',
  closed: 'outline',
  authRequired: 'outline',
  retry: 'outline',
  challenge: 'destructive',
  blocked: 'destructive',
} as const;

const QUEUE_METRIC_TEST_IDS = {
  position: 'queue-metric-position',
  eta: 'queue-metric-eta',
  remainingSeats: 'queue-metric-remaining-seats',
  opensIn: 'queue-opens-in',
} as const;

// The estimate comes from measured queue movement, so it is shown as a range
// rather than a to-the-second countdown.
const ETA_RANGE_LOWER_RATIO = 0.8;
const ETA_RANGE_UPPER_RATIO = 1.2;

export function formatQueueEta(
  params: { etaSeconds: number; etaPending?: boolean; position: number },
  metrics: QueueCopy['metrics'],
): string {
  if (params.etaPending) {
    return params.position === 1 ? metrics.soon : metrics.etaCalculating;
  }

  if (params.etaSeconds <= 0) {
    return metrics.soon;
  }

  if (params.etaSeconds < 60) {
    return metrics.etaUnderMinute;
  }

  const lowerMinutes = Math.max(
    1,
    Math.floor((params.etaSeconds * ETA_RANGE_LOWER_RATIO) / 60),
  );
  const upperMinutes = Math.max(
    lowerMinutes,
    Math.ceil((params.etaSeconds * ETA_RANGE_UPPER_RATIO) / 60),
  );

  if (lowerMinutes === upperMinutes) {
    return formatCopy(metrics.etaAbout, { minutes: lowerMinutes });
  }

  return formatCopy(metrics.etaRange, { min: lowerMinutes, max: upperMinutes });
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function OpeningCountdown({
  opensAt,
  metrics,
}: {
  opensAt: number | null;
  metrics: QueueCopy['metrics'];
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (opensAt === null) {
      return;
    }

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [opensAt]);

  const remainingMs = opensAt === null ? null : opensAt - nowMs;
  const value =
    remainingMs === null
      ? metrics.openTimeUnknown
      : remainingMs > 0
        ? formatCountdown(remainingMs)
        : metrics.opening;

  return (
    <div
      className="rounded-2xl bg-[#f5f5f7] p-4"
      data-testid={QUEUE_METRIC_TEST_IDS.opensIn}
      role="group"
      aria-labelledby="queue-opens-in-label"
    >
      <p className="text-sm font-medium text-neutral-500" id="queue-opens-in-label">
        {metrics.opensIn}
      </p>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-neutral-950" role="timer">
        {value}
      </p>
    </div>
  );
}

function metricValue(status: QueueStatus, value: number, fallback: string): string {
  if (status === 'loading') {
    return fallback;
  }

  return value > 0 ? value.toString() : fallback;
}

export function QueueWaiting({
  status,
  position,
  etaSeconds,
  etaPending = false,
  remainingSeats,
  autoEnter,
  bookingOpensAt = null,
  showEnterNow = false,
  onRetry,
  onEnterNow,
  onBack,
}: QueueWaitingProps) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const queueCopy =
    getVisibleCopy(locale).booking.queue ?? FALLBACK_QUEUE_COPY;
  const copy = queueCopy.status[status] ?? FALLBACK_QUEUE_COPY.status[status];
  const metrics = { ...FALLBACK_QUEUE_COPY.metrics, ...queueCopy.metrics };
  const Icon = SURFACE_ICONS[status];
  const tone = SURFACE_TONES[status];
  const showQueueMetrics = status !== 'notOpen' && status !== 'closed';
  const showSoldOutRisk =
    status === 'waiting' && position > 0 && position > remainingSeats;
  const isFailure =
    status === 'expired' ||
    status === 'closed' ||
    status === 'authRequired' ||
    status === 'retry' ||
    status === 'challenge' ||
    status === 'blocked';

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-50 via-white to-[#f3efff] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <Card
          className={cn(
            'w-full overflow-hidden border-neutral-200/80 bg-white/95 shadow-xl shadow-black/5',
            isFailure && 'border-red-200/80',
          )}
        >
          <CardHeader className="gap-4 border-b bg-gradient-to-r from-white to-neutral-50/90 pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-4">
                <Badge variant={tone}>{copy.badge}</Badge>
                <div className="space-y-2">
                  <h1
                    className={cn(
                      'break-keep text-2xl font-semibold tracking-tight text-neutral-950 sm:text-[28px]',
                      isFailure && 'text-red-900',
                    )}
                  >
                    {copy.title}
                  </h1>
                  <p
                    className={cn(
                      'max-w-2xl whitespace-normal break-keep text-base leading-7 text-neutral-600',
                      isFailure && 'text-red-700',
                    )}
                  >
                    {copy.description}
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-[#f5f5f7] text-[#6c3ce0]',
                  isFailure && 'border-red-200 bg-red-50 text-red-600',
                )}
              >
                <Icon className="size-7" />
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[1.4fr_1fr]">
            <section
              className={cn(
                'rounded-2xl border border-neutral-200 bg-white p-5',
                isFailure && 'border-red-100 bg-red-50/30',
              )}
              role={isFailure ? 'alert' : undefined}
            >
              <div className="mb-5 flex items-center gap-3 text-sm font-semibold text-neutral-700">
                <Ticket className="size-4 text-[#6c3ce0]" />
                {queueCopy.infoLabel}
              </div>
              {status === 'notOpen' && (
                <OpeningCountdown opensAt={bookingOpensAt} metrics={metrics} />
              )}
              {status === 'closed' && (
                <p className="whitespace-normal break-keep text-sm leading-6 text-neutral-700">
                  {copy.helper}
                </p>
              )}
              {showQueueMetrics && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div
                  className="rounded-2xl bg-[#f5f5f7] p-4"
                  data-testid={QUEUE_METRIC_TEST_IDS.position}
                  role="group"
                  aria-labelledby="queue-metric-position-label"
                >
                  <p
                    className="text-sm font-medium text-neutral-500"
                    id="queue-metric-position-label"
                  >
                    {metrics.position}
                  </p>
                  {status === 'loading' ? (
                    <Skeleton className="mt-3 h-8 w-16" />
                  ) : (
                    <p className="mt-3 text-3xl font-semibold text-neutral-950">
                      {metricValue(status, position, '-')}
                    </p>
                  )}
                </div>
                <div
                  className="rounded-2xl bg-[#f5f5f7] p-4"
                  data-testid={QUEUE_METRIC_TEST_IDS.eta}
                  role="group"
                  aria-labelledby="queue-metric-eta-label"
                >
                  <p
                    className="text-sm font-medium text-neutral-500"
                    id="queue-metric-eta-label"
                  >
                    {metrics.eta}
                  </p>
                  {status === 'loading' ? (
                    <Skeleton className="mt-3 h-8 w-24" />
                  ) : (
                    <p className="mt-3 break-keep text-2xl font-semibold leading-tight text-neutral-950">
                      {status === 'admitted' && autoEnter
                        ? metrics.ready
                        : formatQueueEta({ etaSeconds, etaPending, position }, metrics)}
                    </p>
                  )}
                </div>
                <div
                  className="rounded-2xl bg-[#f5f5f7] p-4"
                  data-testid={QUEUE_METRIC_TEST_IDS.remainingSeats}
                  role="group"
                  aria-labelledby="queue-metric-remaining-seats-label"
                >
                  <p
                    className="text-sm font-medium text-neutral-500"
                    id="queue-metric-remaining-seats-label"
                  >
                    {metrics.remainingSeats}
                  </p>
                  {status === 'loading' ? (
                    <Skeleton className="mt-3 h-8 w-20" />
                  ) : (
                    <p className="mt-3 text-3xl font-semibold text-neutral-950">
                      {metricValue(status, remainingSeats, '-')}
                    </p>
                  )}
                </div>
              </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#e7defd] bg-[#f9f6ff] p-5">
              <p className="text-sm font-semibold text-[#6c3ce0]">
                {queueCopy.infoLabel}
              </p>
              <div className="mt-3 space-y-3 whitespace-normal break-keep text-sm leading-6 text-neutral-700">
                {status !== 'closed' && <p>{copy.helper}</p>}
                {showSoldOutRisk && (
                  <p className="font-medium text-amber-800" data-testid="queue-sold-out-risk">
                    {queueCopy.soldOutRisk ?? FALLBACK_QUEUE_COPY.soldOutRisk}
                  </p>
                )}
                <p>
                  {status === 'admitted'
                    ? queueCopy.autoEnterInfo
                    : status === 'waiting'
                      ? queueCopy.etaInfo ?? FALLBACK_QUEUE_COPY.etaInfo
                      : queueCopy.safetyInfo}
                </p>
              </div>
            </section>
          </CardContent>

          <CardFooter className="flex flex-col gap-3 border-t bg-neutral-50/80 px-6 py-5 sm:flex-row sm:justify-end">
            {(status === 'retry' ||
              status === 'challenge' ||
              status === 'authRequired' ||
              status === 'expired') && (
              <Button size="lg" variant="outline" onClick={onRetry}>
                {queueCopy.retryAction}
              </Button>
            )}
            {status === 'admitted' && showEnterNow && (
              <Button size="lg" onClick={onEnterNow}>
                {queueCopy.enterNowAction}
              </Button>
            )}
            {status === 'closed' && onBack && (
              <Button size="lg" variant="outline" onClick={onBack}>
                {queueCopy.backAction ?? FALLBACK_QUEUE_COPY.backAction}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
