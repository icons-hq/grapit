'use client';

import { AlertTriangle, CheckCircle2, Clock3, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ScannerOfflineQueueItem } from '@/hooks/use-field-operations';
import { cn } from '@/lib/cn';

interface OfflineSyncStatusProps {
  queue: readonly ScannerOfflineQueueItem[];
  isSyncing: boolean;
  onSyncOffline: () => void;
}

const STATE_STYLES = {
  pending: {
    label: 'pending',
    countLabel: '보류',
    icon: Clock3,
    row: 'border-[#FDE68A] bg-[#FFFBEB] text-[#8B6306]',
    badge: 'border-transparent bg-[#FFFBEB] text-[#8B6306]',
  },
  synced: {
    label: 'synced',
    countLabel: '동기화',
    icon: CheckCircle2,
    row: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
    badge: 'border-transparent bg-[#F0FDF4] text-[#15803D]',
  },
  rejected: {
    label: 'rejected',
    countLabel: '거절',
    icon: AlertTriangle,
    row: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
  },
} as const;

export function OfflineSyncStatus({
  queue,
  isSyncing,
  onSyncOffline,
}: OfflineSyncStatusProps) {
  const counts = queue.reduce(
    (acc, item) => {
      acc[item.state] += 1;
      return acc;
    },
    { pending: 0, synced: 0, rejected: 0 },
  );

  return (
    <Card
      data-testid="offline-sync-status"
      className="border-[#FDE68A] bg-white shadow-sm"
    >
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-heading font-semibold text-gray-900">보류 스캔</p>
          <p className="mt-2 text-base leading-[1.5] text-[#8B6306]">
            보류 상태는 최종 입장 증거가 아닙니다
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2" aria-label="보류 스캔 동기화 요약">
          {(['pending', 'synced', 'rejected'] as const).map((state) => (
            <div
              key={state}
              className={cn(
                'rounded-lg border px-3 py-2 text-center text-sm font-semibold',
                STATE_STYLES[state].row,
              )}
            >
              {STATE_STYLES[state].countLabel} {counts[state]}
            </div>
          ))}
        </div>

        {queue.length > 0 && (
          <div className="space-y-2">
            {queue.map((item) => {
              const style = STATE_STYLES[item.state];
              const Icon = style.icon;

              return (
                <div
                  key={item.deviceAttemptId}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-semibold',
                    style.row,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p>
                        {formatTimestamp(item.attemptedAt)} · {style.label}
                      </p>
                      {item.reason && (
                        <p className="mt-1 text-sm leading-[1.4]">{item.reason}</p>
                      )}
                    </div>
                    <Badge className={style.badge}>
                      <Icon className="h-3 w-3" />
                      {style.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-[#8B6306] text-[#8B6306]"
          disabled={isSyncing || counts.pending === 0}
          onClick={onSyncOffline}
        >
          <RefreshCcw className="h-4 w-4" />
          {isSyncing ? '동기화 중' : '보류 스캔 동기화'}
        </Button>
      </CardContent>
    </Card>
  );
}

function formatTimestamp(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date);
}
