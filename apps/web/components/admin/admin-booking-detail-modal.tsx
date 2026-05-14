'use client';

import { useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminManualOpenSeat } from '@/hooks/use-admin-seat-operations';
import { useAdminBookingDetail } from '@/hooks/use-reservations';
import { formatDateTime } from '@/lib/format-datetime';
import type { ReservationStatus } from '@grabit/shared';

const STATUS_CONFIG: Record<
  ReservationStatus,
  { label: string; className: string }
> = {
  CONFIRMED: {
    label: '예매완료',
    className: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  },
  CANCELLED: {
    label: '취소완료',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
  PENDING_PAYMENT: {
    label: '결제대기',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  },
  FAILED: {
    label: '결제실패',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-right text-sm font-semibold text-gray-900">
        {value}
      </span>
    </div>
  );
}

interface AdminBookingDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string | null;
  onRefund: (id: string, reason: string) => void;
  isRefunding: boolean;
}

export function AdminBookingDetailModal({
  open,
  onOpenChange,
  bookingId,
  onRefund,
  isRefunding,
}: AdminBookingDetailModalProps) {
  const { data: booking, isLoading } = useAdminBookingDetail(
    open ? bookingId : null,
  );
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [showManualOpenForm, setShowManualOpenForm] = useState(false);
  const [manualOpenReason, setManualOpenReason] = useState('');
  const manualOpenMutation = useAdminManualOpenSeat();

  function handleOpenChange(value: boolean) {
    if (!value) {
      setShowRefundForm(false);
      setRefundReason('');
      setShowManualOpenForm(false);
      setManualOpenReason('');
    }
    onOpenChange(value);
  }

  function handleRefundConfirm() {
    if (!bookingId || !refundReason.trim()) return;
    onRefund(bookingId, refundReason.trim());
  }

  function handleManualOpenConfirm() {
    if (!bookingId || !manualOpenReason.trim()) return;

    manualOpenMutation.mutate(
      {
        reservationId: bookingId,
        reason: manualOpenReason.trim(),
      },
      {
        onSuccess: () => {
          toast.success('취소 좌석이 즉시 판매 가능 상태로 변경되었습니다.');
          setShowManualOpenForm(false);
          setManualOpenReason('');
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : '취소 좌석 즉시 개방에 실패했습니다.',
          );
        },
      },
    );
  }

  const statusConfig = booking ? STATUS_CONFIG[booking.status] : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] w-full max-w-[480px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>예매 상세</DialogTitle>
          <DialogDescription>
            예매 상태, 좌석, 결제 정보와 예약별 운영 작업을 확인합니다.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-full" />
          </div>
        )}

        {booking && !showRefundForm && !showManualOpenForm && (
          <div className="space-y-1">
            <InfoRow label="예매번호" value={booking.reservationNumber} />
            <Separator />
            <InfoRow
              label="예매자"
              value={`${booking.userName} / ${booking.userPhone}`}
            />
            <Separator />
            <InfoRow label="공연명" value={booking.performanceTitle} />
            <Separator />
            <InfoRow
              label="공연일시"
              value={formatDateTime(booking.showDateTime)}
            />
            <Separator />
            <InfoRow
              label="좌석"
              value={booking.seats
                .map(
                  (s) => `${s.tierName} ${s.row}열 ${s.number}번`,
                )
                .join(', ')}
            />
            <Separator />
            <InfoRow
              label="결제금액"
              value={`${booking.totalAmount.toLocaleString('ko-KR')}원`}
            />
            <Separator />
            {booking.paymentInfo && (
              <>
                <InfoRow label="결제수단" value={booking.paymentInfo.method} />
                <Separator />
                <InfoRow
                  label="결제일시"
                  value={formatDateTime(booking.paymentInfo.paidAt)}
                />
                <Separator />
              </>
            )}
            <InfoRow
              label="상태"
              value={
                statusConfig ? (
                  <Badge className={statusConfig.className}>
                    {statusConfig.label}
                  </Badge>
                ) : (
                  booking.status
                )
              }
            />

            {booking.status === 'CONFIRMED' && (
              <Button
                variant="destructive"
                className="mt-4 w-full"
                onClick={() => {
                  setShowManualOpenForm(false);
                  setManualOpenReason('');
                  setShowRefundForm(true);
                }}
              >
                환불 처리
              </Button>
            )}

            {booking.status === 'CANCELLED' && (
              <Button
                variant="outline"
                className="mt-4 h-12 w-full border-[#C62828] text-[#C62828] hover:bg-[#FEF2F2] hover:text-[#C62828]"
                onClick={() => {
                  setShowRefundForm(false);
                  setRefundReason('');
                  setShowManualOpenForm(true);
                }}
              >
                취소 좌석 즉시 개방
              </Button>
            )}
          </div>
        )}

        {booking && showRefundForm && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900">
              환불을 진행하시겠습니까?
            </h3>

            <div>
              <label
                htmlFor="refund-reason"
                className="mb-2 block text-sm font-semibold text-gray-700"
              >
                환불 사유
              </label>
              <Textarea
                id="refund-reason"
                placeholder="환불 사유를 입력하세요"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="min-h-[80px]"
              />
            </div>

            <div className="rounded-lg bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">환불 금액</span>
                <span className="text-base font-semibold text-gray-900">
                  {booking.totalAmount.toLocaleString('ko-KR')}원
                </span>
              </div>
              {booking.paymentInfo && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-gray-600">환불 수단</span>
                  <span className="text-sm text-gray-600">
                    {booking.paymentInfo.method}으로 환불
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setShowRefundForm(false);
                  setRefundReason('');
                }}
              >
                취소
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!refundReason.trim() || isRefunding}
                onClick={handleRefundConfirm}
              >
                {isRefunding ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    환불 처리 중...
                  </>
                ) : (
                  '환불 확인'
                )}
              </Button>
            </div>
          </div>
        )}

        {booking && showManualOpenForm && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                이 취소 좌석을 지금 즉시 개방하시겠습니까?
              </DialogTitle>
              <DialogDescription>
                취소로 보류 중인 좌석을 판매 가능 상태로 즉시 변경합니다. 좌석과
                사유를 확인한 뒤 진행하세요.
              </DialogDescription>
            </DialogHeader>

            <div
              role="alert"
              className="flex gap-3 rounded-lg border border-[#F3C8C8] bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                즉시 개방은 예약 상세에서만 처리하는 고위험 운영 작업입니다.
              </span>
            </div>

            <div className="rounded-lg bg-[#F5F5F7] p-3">
              <p className="text-sm font-semibold text-gray-700">개방 대상</p>
              <dl className="mt-2 grid gap-2 text-sm text-gray-700">
                <div className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
                  <dt className="font-semibold">예매번호</dt>
                  <dd className="text-right">{booking.reservationNumber}</dd>
                </div>
                <div className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
                  <dt className="font-semibold">좌석</dt>
                  <dd className="text-right">
                    {booking.seats
                      .map(
                        (seat) =>
                          `${seat.floorLabel} ${seat.tierName} ${seat.row}열 ${seat.number}번`,
                      )
                      .join(', ')}
                  </dd>
                </div>
              </dl>
            </div>

            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>즉시 개방 사유</span>
              <Textarea
                value={manualOpenReason}
                onChange={(event) => setManualOpenReason(event.target.value)}
                aria-label="즉시 개방 사유"
                placeholder="예: 취소 입금 확인, 운영자 확인 후 재판매"
                className="min-h-[80px]"
              />
            </label>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowManualOpenForm(false);
                  setManualOpenReason('');
                }}
              >
                취소
              </Button>
              <Button
                type="button"
                className="bg-[#C62828] hover:bg-[#A81F1F]"
                disabled={
                  !manualOpenReason.trim() || manualOpenMutation.isPending
                }
                onClick={handleManualOpenConfirm}
              >
                {manualOpenMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    즉시 개방 중...
                  </>
                ) : (
                  '즉시 개방 확인'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
