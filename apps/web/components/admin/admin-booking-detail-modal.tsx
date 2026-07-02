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
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminManualOpenSeat } from '@/hooks/use-admin-seat-operations';
import {
  useAdminBookingDetail,
  useAdminRefundPreview,
} from '@/hooks/use-reservations';
import { formatDateTime } from '@/lib/format-datetime';
import { getPaymentFailureBucketLabel } from './payment-failure-buckets';
import { useAuthStore } from '@/stores/use-auth-store';
import { hasAdminCapability } from '@grabit/shared';
import type {
  AdminBookingDetail,
  AdminBookingFunnelStatus,
  AdminTicketItem,
  PaymentStatus,
  ReservationStatus,
} from '@grabit/shared';

const FUNNEL_STATUS_CONFIG: Record<
  AdminBookingFunnelStatus,
  { label: string; className: string }
> = {
  SOLD: {
    label: '판매 완료',
    className: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  },
  PAYMENT_PENDING: {
    label: '결제 대기',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  },
  PAYMENT_PROCESSING: {
    label: '결제 확인 중',
    className: 'bg-[#EEF2FF] text-[#4338CA] border-transparent',
  },
  PAYMENT_FAILED: {
    label: '결제 실패/만료',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
  CANCEL_PROCESSING: {
    label: '취소/환불 처리 중',
    className: 'bg-[#FFF7ED] text-[#C2410C] border-transparent',
  },
  PARTIAL_CANCELLED: {
    label: '부분 취소',
    className: 'bg-[#F5F3FF] text-[#6D28D9] border-transparent',
  },
  CANCELLED: {
    label: '취소 완료',
    className: 'bg-[#F3F4F6] text-[#4B5563] border-transparent',
  },
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  READY: '결제 준비',
  IN_PROGRESS: '결제 진행 중',
  DONE: '결제 완료',
  PARTIAL_CANCELED: '부분 환불 완료',
  CANCELED: '결제 취소',
  ABORTED: '결제 중단',
  EXPIRED: '결제 만료',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CARD: '카드',
  VIRTUAL_ACCOUNT: '가상계좌',
  TRANSFER: '계좌이체',
  MOBILE_PHONE: '휴대폰',
  FOREIGN_EASY_PAY: '해외 간편결제',
  SIMPLE_PAY: '국내 간편결제',
};

const TICKET_STATUS_LABELS: Record<AdminTicketItem['status'], string> = {
  ACTIVE: '티켓 유효',
  CANCELLATION_PENDING: '취소 확인 중',
  CANCELLED: '취소됨',
  EXPIRED: '만료됨',
};

const ADMISSION_STATE_LABELS: Record<
  AdminTicketItem['admissionState'],
  string
> = {
  NOT_ENTERED: '입장 전',
  ENTERED: '입장 완료',
};

const REOPEN_STATE_LABELS: Record<AdminTicketItem['reopenState'], string> = {
  NOT_REQUIRED: '재오픈 불필요',
  HELD_CANCELLED: '취소 좌석 보류',
  AVAILABLE: '판매 가능',
  MANUAL_OPENED: '수동 개방',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-gray-600">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-semibold text-gray-900">
        {value}
      </span>
    </div>
  );
}

function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

function formatOptionalDateTime(dateString: string | null | undefined): string {
  return dateString ? formatDateTime(dateString) : '-';
}

function fallbackFunnelStatus(status: ReservationStatus): AdminBookingFunnelStatus {
  switch (status) {
    case 'CONFIRMED':
      return 'SOLD';
    case 'PENDING_PAYMENT':
      return 'PAYMENT_PENDING';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
      return 'PAYMENT_FAILED';
  }
}

function getFunnelStatusConfig(booking: AdminBookingDetail) {
  const funnelStatus =
    booking.funnelStatus ?? fallbackFunnelStatus(booking.status);
  return FUNNEL_STATUS_CONFIG[funnelStatus];
}

function getPaymentStatusLabel(status: PaymentStatus | null): string {
  if (!status) return '결제 정보 없음';
  return PAYMENT_STATUS_LABELS[status] ?? '결제 상태 확인 필요';
}

function getPaymentMethodLabel(method: string | null): string {
  if (!method) return '결제수단 미정';
  if (PAYMENT_METHOD_LABELS[method]) {
    return PAYMENT_METHOD_LABELS[method];
  }
  return /[가-힣]/.test(method) ? method : '기타 결제수단';
}

function getPaymentMethodAttributionLabel(booking: AdminBookingDetail): string {
  return booking.paymentMethodAttribution.label
    || getPaymentMethodLabel(booking.paymentInfo?.method ?? booking.paymentMethod);
}

function formatTicketStatusCounts(
  counts: AdminBookingDetail['ticketStatusCounts'],
): string {
  return [
    `티켓 유효 ${counts.ACTIVE.toLocaleString('ko-KR')}`,
    `취소 확인 중 ${counts.CANCELLATION_PENDING.toLocaleString('ko-KR')}`,
    `취소됨 ${counts.CANCELLED.toLocaleString('ko-KR')}`,
    `만료됨 ${counts.EXPIRED.toLocaleString('ko-KR')}`,
  ].join(' / ');
}

function canManualOpenCancelledSeats(booking: AdminBookingDetail): boolean {
  return (
    booking.status === 'CANCELLED' &&
    booking.ticketItems.some((item) => item.reopenState === 'HELD_CANCELLED')
  );
}

interface AdminBookingDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string | null;
  onRefund: (
    id: string,
    reason: string,
    options: {
      fullRefundOverride: boolean;
      enteredTicketOverride: boolean;
    },
  ) => void;
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
  const authUser = useAuthStore((state) => state.user);
  const canAdminRefund = hasAdminCapability(authUser, 'refund.admin_refund');
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [fullRefundOverride, setFullRefundOverride] = useState(false);
  const [
    enteredTicketOverride,
    setEnteredTicketOverride,
  ] = useState(false);
  const refundPreviewQuery = useAdminRefundPreview(
    open && showRefundForm ? bookingId : null,
    { fullRefundOverride, enteredTicketOverride },
    open && showRefundForm && Boolean(bookingId) && canAdminRefund,
  );
  const refundQuote = refundPreviewQuery.data?.cancellationQuote ?? null;
  const refundPreviewCalculating =
    refundPreviewQuery.isLoading || refundPreviewQuery.isFetching;
  const refundConfirmDisabled =
    !refundReason.trim()
    || isRefunding
    || refundPreviewCalculating
    || refundPreviewQuery.isError
    || refundQuote === null;
  const [showManualOpenForm, setShowManualOpenForm] = useState(false);
  const [manualOpenReason, setManualOpenReason] = useState('');
  const manualOpenMutation = useAdminManualOpenSeat();

  function handleOpenChange(value: boolean) {
    if (!value) {
      setShowRefundForm(false);
      setRefundReason('');
      setFullRefundOverride(false);
      setEnteredTicketOverride(false);
      setShowManualOpenForm(false);
      setManualOpenReason('');
    }
    onOpenChange(value);
  }

  function handleRefundConfirm() {
    if (!bookingId || !refundReason.trim()) return;
    onRefund(bookingId, refundReason.trim(), {
      fullRefundOverride,
      enteredTicketOverride,
    });
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

  const statusConfig = booking ? getFunnelStatusConfig(booking) : null;
  const paymentFailureBucketLabel = booking
    ? getPaymentFailureBucketLabel(booking.paymentFailureBucket)
    : null;

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
              label="Toss 주문번호"
              value={booking.tossOrderId ?? '-'}
            />
            <Separator />
            <InfoRow
              label="예매 생성일시"
              value={formatDateTime(booking.createdAt)}
            />
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
            <InfoRow
              label="결제 상태"
              value={getPaymentStatusLabel(
                booking.paymentInfo?.status ?? booking.paymentStatus,
              )}
            />
            <Separator />
            <InfoRow
              label="결제수단"
              value={getPaymentMethodAttributionLabel(booking)}
            />
            <Separator />
            <InfoRow
              label="결제수단 출처"
              value={booking.paymentMethodAttribution.source}
            />
            <Separator />
            {paymentFailureBucketLabel && (
              <>
                <InfoRow
                  label="실패/만료 분류"
                  value={paymentFailureBucketLabel}
                />
                <Separator />
              </>
            )}
            {booking.paymentFailureDiagnostic && (
              <>
                <InfoRow
                  label="실패/만료 코드"
                  value={booking.paymentFailureDiagnostic.code}
                />
                <Separator />
                <InfoRow
                  label="실패/만료 사유"
                  value={booking.paymentFailureDiagnostic.message}
                />
                <Separator />
                <InfoRow
                  label="진단 출처"
                  value={booking.paymentFailureDiagnostic.source}
                />
                <Separator />
                <InfoRow
                  label="Toss 확인 상태"
                  value={[
                    booking.paymentFailureDiagnostic.providerCheckStatus,
                    booking.paymentFailureDiagnostic.providerCheckMessage,
                  ].filter(Boolean).join(' / ')}
                />
                <Separator />
              </>
            )}
            <InfoRow
              label="결제 시도일시"
              value={formatOptionalDateTime(booking.paymentAttemptedAt)}
            />
            <Separator />
            <InfoRow
              label="완료처리일시"
              value={formatOptionalDateTime(booking.paymentCompletedAt)}
            />
            <Separator />
            <InfoRow
              label="상태"
              value={
                statusConfig ? (
                  <Badge className={statusConfig.className}>
                    {statusConfig.label}
                  </Badge>
                ) : (
                  '상태 확인 필요'
                )
              }
            />
            <Separator />
            <InfoRow
              label="티켓 상태"
              value={formatTicketStatusCounts(booking.ticketStatusCounts)}
            />

            {booking.ticketItems?.length > 0 && (
              <>
                <Separator />
                <div className="py-2">
                  <p className="mb-2 text-sm font-semibold text-gray-700">
                    티켓별 상태
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table aria-label="ticket item status">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">좌석</TableHead>
                          <TableHead className="whitespace-nowrap">티켓 상태</TableHead>
                          <TableHead className="whitespace-nowrap">입장 상태</TableHead>
                          <TableHead className="whitespace-nowrap text-right">
                            취소/환불
                          </TableHead>
                          <TableHead className="whitespace-nowrap">재오픈</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {booking.ticketItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {item.tierName} {item.row}열 {item.number}번
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {TICKET_STATUS_LABELS[item.status]}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {ADMISSION_STATE_LABELS[item.admissionState]}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right text-sm">
                              {formatWon(item.refundableAmount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {REOPEN_STATE_LABELS[item.reopenState]}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}

            {booking.status === 'CONFIRMED' && canAdminRefund && (
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

            {canManualOpenCancelledSeats(booking) && (
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

        {booking && showRefundForm && canAdminRefund && (
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
                  {refundPreviewCalculating
                    ? '계산 중...'
                    : refundQuote
                      ? formatWon(refundQuote.refundableAmount)
                      : '계산 불가'}
                </span>
              </div>
              {refundPreviewQuery.isError && (
                <p className="mt-2 text-xs font-semibold text-[#C62828]">
                  환불 금액을 계산하지 못했습니다. 잠시 후 다시 시도하세요.
                </p>
              )}
              {!refundPreviewCalculating && !refundPreviewQuery.isError && refundQuote === null && (
                <p className="mt-2 text-xs font-semibold text-[#C62828]">
                  서버 환불 견적이 없어 환불을 진행할 수 없습니다.
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600">환불 수단</span>
                <span className="text-right text-sm text-gray-600">
                  {getPaymentMethodAttributionLabel(booking)} 결제 취소
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <label className="flex items-start gap-3">
                <Checkbox
                  checked={fullRefundOverride}
                  onCheckedChange={(checked) => setFullRefundOverride(checked === true)}
                  aria-label="수수료 없이 전액 환불"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    수수료 없이 전액 환불
                  </span>
                  <span className="block text-xs text-gray-600">
                    공연사 귀책, 운영상 예외, 테스트 정리에만 사용합니다.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <Checkbox
                  checked={enteredTicketOverride}
                  onCheckedChange={(checked) =>
                    setEnteredTicketOverride(checked === true)
                  }
                  aria-label="입장 처리 티켓 강제 취소"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    입장 처리 티켓 강제 취소
                  </span>
                  <span className="block text-xs text-gray-600">
                    테스트 입장 처리 후 취소가 필요한 경우에만 사용합니다.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setShowRefundForm(false);
                  setRefundReason('');
                  setFullRefundOverride(false);
                  setEnteredTicketOverride(false);
                }}
              >
                취소
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={refundConfirmDisabled}
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
