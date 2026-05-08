'use client';

import {
  AlertTriangle,
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
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { QueueStatus } from '@/hooks/use-queue';
import { cn } from '@/lib';

type QueueWaitingProps = {
  status: QueueStatus;
  position: number;
  etaSeconds: number;
  remainingSeats: number;
  autoEnter: boolean;
  showEnterNow?: boolean;
  onRetry?: () => void;
  onEnterNow?: () => void;
};

type SurfaceCopy = {
  badge: string;
  title: string;
  description: string;
  helper: string;
  tone: 'default' | 'secondary' | 'outline' | 'destructive';
  icon: typeof Hourglass;
};

const SURFACE_COPY: Record<QueueStatus, SurfaceCopy> = {
  loading: {
    badge: '대기열 확인 중',
    title: '예매 대기열에서 입장 순서를 기다리고 있습니다',
    description: '예매 가능한 순번과 남은 좌석 수를 불러오고 있습니다.',
    helper: '대기열 상태는 잠시 후 자동으로 갱신됩니다.',
    tone: 'secondary',
    icon: Hourglass,
  },
  waiting: {
    badge: '대기 중',
    title: '예매 대기열에서 입장 순서를 기다리고 있습니다',
    description: '순번이 가까워지면 예매 화면으로 자동 이동합니다.',
    helper: '새로고침하지 않아도 현재 순번과 예상 대기 시간이 계속 갱신됩니다.',
    tone: 'secondary',
    icon: Hourglass,
  },
  admitted: {
    badge: '입장 준비',
    title: '입장 가능 상태입니다. 예매 화면으로 이동합니다',
    description: '자동으로 이동하지 않으면 아래 버튼으로 바로 입장할 수 있습니다.',
    helper: '좌석 선택이 시작되면 실시간 좌석 현황과 타이머가 바로 표시됩니다.',
    tone: 'default',
    icon: CheckCircle2,
  },
  expired: {
    badge: '입장 만료',
    title: '입장 시간이 만료되었습니다. 대기열로 다시 이동합니다',
    description: '새로운 순번을 받아 다시 예매 대기열에 입장해주세요.',
    helper: '재입장 후에도 같은 공연의 남은 좌석 수와 예상 대기 시간이 계속 표시됩니다.',
    tone: 'outline',
    icon: TimerReset,
  },
  retry: {
    badge: '재시도 필요',
    title: '요청이 많습니다. 잠시 후 다시 시도해주세요',
    description: '잠시 기다린 뒤 다시 시도하면 현재 대기열 상태를 다시 확인합니다.',
    helper: '반복 클릭보다는 잠시 후 재시도가 더 빠르게 입장 상태를 복구합니다.',
    tone: 'outline',
    icon: AlertTriangle,
  },
  challenge: {
    badge: '보안 확인',
    title: '보안 확인 후 다시 시도해주세요',
    description: '비정상 패턴이 감지되어 추가 확인이 필요합니다.',
    helper: '브라우저를 새로고침하거나 잠시 후 다시 시도해 주세요.',
    tone: 'destructive',
    icon: ShieldAlert,
  },
  blocked: {
    badge: '요청 차단',
    title:
      '비정상적인 접근으로 요청이 차단되었습니다. 반복되면 고객센터에 문의해주세요',
    description: '같은 브라우저에서 반복된 요청이 감지되어 예매 진입이 제한되었습니다.',
    helper: '차단이 계속되면 잠시 후 다시 시도하거나 고객센터에 문의해주세요.',
    tone: 'destructive',
    icon: ShieldAlert,
  },
};

function formatEta(etaSeconds: number): string {
  if (etaSeconds <= 0) {
    return '곧 입장';
  }

  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}초`;
  }

  return `${minutes}분 ${seconds.toString().padStart(2, '0')}초`;
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
  remainingSeats,
  autoEnter,
  showEnterNow = false,
  onRetry,
  onEnterNow,
}: QueueWaitingProps) {
  const copy = SURFACE_COPY[status];
  const Icon = copy.icon;
  const isFailure =
    status === 'expired' ||
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
              <div className="space-y-4">
                <Badge variant={copy.tone}>{copy.badge}</Badge>
                <div className="space-y-2">
                  <CardTitle
                    className={cn(
                      'text-2xl font-semibold tracking-tight text-neutral-950 sm:text-[28px]',
                      isFailure && 'text-red-900',
                    )}
                  >
                    {copy.title}
                  </CardTitle>
                  <CardDescription
                    className={cn(
                      'max-w-2xl text-base leading-7 text-neutral-600',
                      isFailure && 'text-red-700',
                    )}
                  >
                    {copy.description}
                  </CardDescription>
                </div>
              </div>
              <div
                className={cn(
                  'flex size-14 items-center justify-center rounded-2xl border border-neutral-200 bg-[#f5f5f7] text-[#6c3ce0]',
                  isFailure &&
                    'border-red-200 bg-red-50 text-red-600',
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
                실시간 예매 대기 정보
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-[#f5f5f7] p-4">
                  <p className="text-sm font-medium text-neutral-500">현재 순번</p>
                  {status === 'loading' ? (
                    <Skeleton className="mt-3 h-8 w-16" />
                  ) : (
                    <p className="mt-3 text-3xl font-semibold text-neutral-950">
                      {metricValue(status, position, '-')}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl bg-[#f5f5f7] p-4">
                  <p className="text-sm font-medium text-neutral-500">예상 대기</p>
                  {status === 'loading' ? (
                    <Skeleton className="mt-3 h-8 w-24" />
                  ) : (
                    <p className="mt-3 text-3xl font-semibold text-neutral-950">
                      {status === 'admitted' && autoEnter
                        ? '입장 가능'
                        : formatEta(etaSeconds)}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl bg-[#f5f5f7] p-4">
                  <p className="text-sm font-medium text-neutral-500">남은 좌석</p>
                  {status === 'loading' ? (
                    <Skeleton className="mt-3 h-8 w-20" />
                  ) : (
                    <p className="mt-3 text-3xl font-semibold text-neutral-950">
                      {metricValue(status, remainingSeats, '-')}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#e7defd] bg-[#f9f6ff] p-5">
              <p className="text-sm font-semibold text-[#6c3ce0]">안내</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-neutral-700">
                <p>{copy.helper}</p>
                <p>
                  {status === 'admitted'
                    ? '입장이 승인되면 자동으로 좌석 선택 화면으로 이어집니다.'
                    : '대기열 순번, 예상 시간, 남은 좌석 수만 노출되며 내부 인증 정보는 표시되지 않습니다.'}
                </p>
              </div>
            </section>
          </CardContent>

          <CardFooter className="flex flex-col gap-3 border-t bg-neutral-50/80 px-6 py-5 sm:flex-row sm:justify-end">
            {(status === 'retry' || status === 'challenge' || status === 'expired') && (
              <Button size="lg" variant="outline" onClick={onRetry}>
                다시 시도
              </Button>
            )}
            {status === 'admitted' && showEnterNow && (
              <Button size="lg" onClick={onEnterNow}>
                지금 입장하기
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
