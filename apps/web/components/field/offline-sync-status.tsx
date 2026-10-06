'use client';

import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ScannerOfflineQueueItem } from '@/hooks/use-field-operations';
import { cn } from '@/lib/cn';

interface OfflineSyncStatusProps {
  queue: readonly ScannerOfflineQueueItem[];
  isSyncing: boolean;
  canSync?: boolean;
  onSyncOffline: () => void;
}

const STATE_STYLES = {
  pending: {
    label: '동기화 대기',
    countLabel: '보류',
    icon: Clock3,
    row: 'border-[#FDE68A] bg-[#FFFBEB] text-[#8B6306]',
    badge: 'border-transparent bg-[#FFFBEB] text-[#8B6306]',
  },
  synced: {
    label: '서버 확정',
    countLabel: '동기화',
    icon: CheckCircle2,
    row: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
    badge: 'border-transparent bg-[#F0FDF4] text-[#15803D]',
  },
  rejected: {
    label: '충돌 확인 필요',
    countLabel: '거절',
    icon: AlertTriangle,
    row: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
  },
} as const;

export function OfflineSyncStatus({
  queue,
  isSyncing,
  canSync = true,
  onSyncOffline,
}: OfflineSyncStatusProps) {
  const counts = queue.reduce(
    (acc, item) => {
      acc[item.state] += 1;
      return acc;
    },
    { pending: 0, synced: 0, rejected: 0 },
  );
  const pendingItems = queue.filter((item) => item.state === 'pending');
  const resolvedItems = queue.filter((item) => item.state !== 'pending');
  const receiptsSummary = `동기화 완료 ${counts.synced}건 · 거절 ${counts.rejected}건 보기`;

  // Receipts of settled scans stay on the device for 7 days. Folded by default,
  // they no longer push the scan result below the first screen.
  if (pendingItems.length === 0 && resolvedItems.length > 0) {
    return (
      <Card data-testid="offline-sync-status" className="gap-0 border-gray-200 bg-white py-0 shadow-sm">
        <CardContent className="p-0">
          <ResolvedReceipts
            items={resolvedItems}
            summary={`보류 스캔 0건 · ${receiptsSummary}`}
            className="border-0 bg-transparent"
          />
        </CardContent>
      </Card>
    );
  }

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

        {pendingItems.length > 0 && (
          <div className="space-y-2">
            {pendingItems.map((item) => <QueueRow key={item.deviceAttemptId} item={item} />)}
          </div>
        )}

        {resolvedItems.length > 0 && <ResolvedReceipts items={resolvedItems} summary={receiptsSummary} />}

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-[#8B6306] text-[#8B6306]"
          disabled={!canSync || isSyncing || counts.pending === 0}
          onClick={onSyncOffline}
        >
          <RefreshCcw className="h-4 w-4" />
          {isSyncing ? '동기화 중' : '보류 스캔 동기화'}
        </Button>
      </CardContent>
    </Card>
  );
}

function ResolvedReceipts({
  items,
  summary,
  className,
}: {
  items: readonly ScannerOfflineQueueItem[];
  summary: string;
  className?: string;
}) {
  return (
    <details
      data-testid="offline-sync-receipts"
      className={cn('group rounded-lg border border-gray-200 bg-gray-50', className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 break-keep">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {items.map((item) => <QueueRow key={item.deviceAttemptId} item={item} />)}
      </div>
    </details>
  );
}

function QueueRow({ item }: { item: ScannerOfflineQueueItem }) {
  const style = STATE_STYLES[item.state];
  const Icon = style.icon;

  return (
    <div data-testid="offline-sync-row" className={cn('rounded-lg border px-3 py-2 text-sm font-semibold', style.row)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {item.seatLabel && <p className="break-keep">{item.seatLabel}</p>}
          <p className={item.seatLabel ? 'mt-0.5 font-normal' : undefined}>{formatTimestamp(item.attemptedAt)}</p>
          {item.reason && (
            <p className="mt-1 text-sm leading-[1.4]">{item.reason}</p>
          )}
        </div>
        <Badge className={cn('shrink-0 whitespace-nowrap break-keep', style.badge)}>
          <Icon className="h-3 w-3" />
          {style.label}
        </Badge>
      </div>
    </div>
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
