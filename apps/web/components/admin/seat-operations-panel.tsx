'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import {
  useAdminSeatOperationHistory,
  useDisableAdminSeat,
  useReactivateAdminSeat,
  type AdminSeatOperationPayload,
} from '@/hooks/use-admin-seat-operations';
import type { AdminSeatOperationHistory } from '@grabit/shared';

type SeatPanelAction = 'disable' | 'reactivate';

interface SeatOperationsPanelProps {
  initialShowtimeId?: string;
  initialSeatKey?: string;
  className?: string;
}

const ACTION_CONFIG: Record<
  SeatPanelAction,
  {
    title: string;
    body: string;
    confirmLabel: string;
    successLabel: string;
    buttonClassName?: string;
  }
> = {
  disable: {
    title: '좌석 비활성화',
    body: '이 좌석을 비활성화하면 판매 가능 수량이 즉시 변경됩니다. 사유를 입력하고 변경 내용을 확인한 뒤 진행하세요.',
    confirmLabel: '비활성화 확인',
    successLabel: '좌석이 비활성화되었습니다.',
    buttonClassName: 'bg-[#C62828] hover:bg-[#A81F1F]',
  },
  reactivate: {
    title: '좌석을 다시 판매 가능 상태로 변경하시겠습니까?',
    body: '비활성화된 좌석을 다시 판매 가능 상태로 변경합니다. 좌석 키와 사유를 확인한 뒤 진행하세요.',
    confirmLabel: '재활성화 확인',
    successLabel: '좌석이 다시 판매 가능 상태가 되었습니다.',
  },
};

const OPERATION_LABELS: Record<string, string> = {
  'seat.disable': '비활성화',
  'seat.reactivate': '재활성화',
  'seat.manual_open': '즉시 개방',
};

export function SeatOperationsPanel({
  initialShowtimeId = '',
  initialSeatKey = '',
  className,
}: SeatOperationsPanelProps) {
  const [showtimeId, setShowtimeId] = useState(initialShowtimeId);
  const [seatKey, setSeatKey] = useState(initialSeatKey);
  const [action, setAction] = useState<SeatPanelAction | null>(null);
  const [reason, setReason] = useState('');

  const normalizedFilters = useMemo(
    () => ({
      showtimeId: showtimeId.trim(),
      seatKey: seatKey.trim() || undefined,
      limit: 50,
    }),
    [seatKey, showtimeId],
  );
  const historyQuery = useAdminSeatOperationHistory(normalizedFilters);
  const disableSeat = useDisableAdminSeat();
  const reactivateSeat = useReactivateAdminSeat();

  const selectedConfig = action ? ACTION_CONFIG[action] : null;
  const isMutating = disableSeat.isPending || reactivateSeat.isPending;
  const canOperate = showtimeId.trim().length > 0 && seatKey.trim().length > 0;
  const canConfirm = canOperate && reason.trim().length > 0 && !isMutating;
  const historyRows = historyQuery.data?.rows ?? [];

  function openConfirmation(nextAction: SeatPanelAction) {
    setAction(nextAction);
    setReason('');
  }

  function closeConfirmation(open: boolean) {
    if (!open && !isMutating) {
      setAction(null);
      setReason('');
    }
  }

  function handleConfirm() {
    if (!action || !canConfirm || !selectedConfig) {
      return;
    }

    const payload: AdminSeatOperationPayload = {
      showtimeId: showtimeId.trim(),
      seatKey: seatKey.trim(),
      reason: reason.trim(),
    };
    const mutation = action === 'disable' ? disableSeat : reactivateSeat;

    void mutation
      .mutateAsync(payload)
      .then(() => {
        toast.success(selectedConfig.successLabel);
        setAction(null);
        setReason('');
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : '좌석 운영 요청에 실패했습니다.',
        );
      });
  }

  return (
    <section
      className={cn('space-y-4 rounded-lg bg-white p-4 shadow-sm', className)}
      aria-labelledby="seat-operations-title"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2
            id="seat-operations-title"
            className="text-xl font-semibold leading-tight text-gray-900"
          >
            좌석 운영
          </h2>
          <p className="mt-1 text-base text-gray-600">
            회차 ID와 좌석 키를 기준으로 비활성화, 재활성화, 운영 이력을 확인합니다.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="h-12 bg-[#C62828] hover:bg-[#A81F1F]"
            disabled={!canOperate || isMutating}
            onClick={() => openConfirmation('disable')}
          >
            좌석 비활성화
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12"
            disabled={!canOperate || isMutating}
            onClick={() => openConfirmation('reactivate')}
          >
            좌석 재활성화
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>회차 ID</span>
          <Input
            value={showtimeId}
            onChange={(event) => setShowtimeId(event.target.value)}
            placeholder="showtime id"
            aria-label="회차 ID"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>좌석 키</span>
          <Input
            value={seatKey}
            onChange={(event) => setSeatKey(event.target.value)}
            placeholder="1F:A-10"
            aria-label="좌석 키"
          />
        </label>
      </div>

      <div className="rounded-lg border border-gray-200">
        {historyQuery.isError && (
          <div
            role="alert"
            className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]"
          >
            좌석 운영 이력을 불러오지 못했습니다. 회차 ID와 좌석 키를 확인하세요.
          </div>
        )}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <History className="h-4 w-4 text-[#6C3CE0]" />
          <h3 className="text-sm font-semibold text-gray-900">
            좌석 운영 이력
          </h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F5F5F7]">
              <TableHead className="text-sm font-semibold text-gray-600">
                작업
              </TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">
                좌석
              </TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">
                상태 변경
              </TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">
                사유
              </TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">
                시각
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {historyQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={`seat-history-skeleton-${index}`}>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                </TableRow>
              ))}

            {!historyQuery.isLoading && !canOperate && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center">
                  <p className="text-base font-semibold text-gray-900">
                    회차 ID와 좌석 키를 입력하세요
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    좌석 운영 작업과 이력 조회에 모두 필요합니다.
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!historyQuery.isLoading && canOperate && historyRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center">
                  <p className="text-base font-semibold text-gray-900">
                    좌석 운영 이력이 없습니다
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    비활성화, 재활성화, 즉시 개방 기록이 생기면 여기에 표시됩니다.
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!historyQuery.isLoading &&
              historyRows.map((row) => (
                <HistoryRow key={row.id} row={row} />
              ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={action !== null} onOpenChange={closeConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedConfig?.title}</DialogTitle>
            <DialogDescription>{selectedConfig?.body}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {action === 'disable' && (
              <div
                role="alert"
                className="flex gap-3 rounded-lg border border-[#F3C8C8] bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  판매 가능 수량이 즉시 변경되며 고객 예매 흐름에 영향을 줄 수 있습니다.
                </span>
              </div>
            )}

            <div className="rounded-lg bg-[#F5F5F7] p-3">
              <p className="text-sm font-semibold text-gray-700">좌석 요약</p>
              <dl className="mt-2 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                <div className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
                  <dt className="font-semibold">회차 ID</dt>
                  <dd className="text-right">{showtimeId.trim() || '-'}</dd>
                </div>
                <div className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
                  <dt className="font-semibold">좌석 키</dt>
                  <dd className="text-right">{seatKey.trim() || '-'}</dd>
                </div>
              </dl>
            </div>

            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>좌석 운영 사유</span>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-label="좌석 운영 사유"
                placeholder="예: 시야 제한, 좌석 파손, 운영 점검 완료"
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeConfirmation(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className={selectedConfig?.buttonClassName}
            >
              {isMutating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  처리 중...
                </>
              ) : (
                selectedConfig?.confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function HistoryRow({ row }: { row: AdminSeatOperationHistory }) {
  return (
    <TableRow data-testid={`seat-operation-history-row-${row.id}`}>
      <TableCell>
        <Badge className={badgeClassName(row.operation)}>
          {OPERATION_LABELS[row.operation] ?? row.operation}
        </Badge>
      </TableCell>
      <TableCell className="text-sm font-semibold text-gray-900">
        {row.seatKey}
      </TableCell>
      <TableCell className="text-sm text-gray-700">
        {row.previousStatus} -&gt; {row.nextStatus}
      </TableCell>
      <TableCell className="max-w-[260px] truncate text-sm text-gray-700">
        {row.reason}
      </TableCell>
      <TableCell className="text-sm text-gray-700">
        {formatDateTime(row.createdAt)}
      </TableCell>
    </TableRow>
  );
}

function badgeClassName(operation: AdminSeatOperationHistory['operation']) {
  if (operation === 'seat.disable') {
    return 'border-transparent bg-[#FEF2F2] text-[#C62828]';
  }
  if (operation === 'seat.reactivate') {
    return 'border-transparent bg-[#F0FDF4] text-[#15803D]';
  }
  return 'border-transparent bg-[#F3EFFF] text-[#6C3CE0]';
}

function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${h}:${min}`;
}
