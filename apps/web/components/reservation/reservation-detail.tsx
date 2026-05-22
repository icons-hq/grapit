'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Mail, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CancelConfirmModal } from '@/components/reservation/cancel-confirm-modal';
import { RefundTimeline } from '@/components/reservation/refund-timeline';
import {
  buildQrCheckInUrl,
  QrTicketImage,
} from '@/components/field/qr-ticket-image';
import type { ReservationDetail as ReservationDetailType, ReservationStatus } from '@grabit/shared';

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

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const day = days[date.getDay()];
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} (${day}) ${h}:${min}`;
}

function formatDeadline(dateString: string): string {
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${h}:${min}까지`;
}

function formatSeats(reservation: ReservationDetailType): string {
  return reservation.seats
    .map((seat) => `${seat.tierName} ${seat.row}열 ${seat.number}번`)
    .join(', ');
}

function getQrStatusLabel(
  status: ReservationDetailType['qrTicket']['status'],
): string {
  switch (status) {
    case 'ACTIVE':
      return 'QR 활성';
    case 'USED':
      return '사용됨';
    case 'REVOKED':
      return '해지됨';
    case 'EXPIRED':
      return '만료됨';
    default:
      return '확인 중';
  }
}

const DELAYED_REOPEN_NOTICE =
  '취소된 좌석은 즉시 재오픈되지 않을 수 있으며, 잠시 후 다시 판매될 수 있습니다';

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

interface ReservationDetailProps {
  reservation: ReservationDetailType;
  onCancel: (reason: string) => void;
  isCancelling: boolean;
}

export function ReservationDetailView({
  reservation,
  onCancel,
  isCancelling,
}: ReservationDetailProps) {
  const router = useRouter();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const statusConfig = STATUS_CONFIG[reservation.status];

  const isDeadlinePassed = new Date(reservation.cancelDeadline) < new Date();
  const canCancel = reservation.status === 'CONFIRMED' && !isDeadlinePassed;
  const showCancelButton = reservation.status !== 'CANCELLED';
  const showRefundPreview =
    reservation.status === 'CONFIRMED' || reservation.status === 'CANCELLED';
  const showRefundTimeline =
    reservation.status === 'CANCELLED' ||
    reservation.cancelledAt !== null ||
    reservation.refundTimeline.currentState !== 'COMPLETED';
  const hasExpectedDepositAt =
    Boolean(reservation.refundTimeline.expectedDepositAt) && showRefundTimeline;
  const isQrActive = reservation.qrTicket?.status === 'ACTIVE';
  const qrCheckInUrl = isQrActive
    ? buildQrCheckInUrl(reservation.qrTicket.token)
    : null;
  const shouldShowQrTicket = reservation.status === 'CONFIRMED';

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          aria-label="뒤로 가기"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">예매 상세</h1>
      </div>

      {/* Reservation number + status */}
      <Card className="py-4">
        <CardContent className="flex items-center justify-between">
          <span className="font-mono text-xl font-semibold tracking-wide" style={{ fontFamily: 'ui-monospace, monospace' }}>
            {reservation.reservationNumber}
          </span>
          <Badge className={statusConfig.className}>{statusConfig.label}</Badge>
        </CardContent>
      </Card>

      {/* Performance info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            공연 정보
          </h2>
          <InfoRow label="공연명" value={reservation.performanceTitle} />
          <Separator />
          <InfoRow
            label="공연일시"
            value={formatDateTime(reservation.showDateTime)}
          />
          <Separator />
          <InfoRow label="장소" value={reservation.venue} />
        </CardContent>
      </Card>

      {/* Seat info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            좌석 정보
          </h2>
          {reservation.seats.map((seat, idx) => (
            <div key={seat.seatId}>
              {idx > 0 && <Separator />}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-600">
                  {seat.tierName} {seat.row}열 {seat.number}번
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  {seat.price.toLocaleString('ko-KR')}원
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            결제 정보
          </h2>
          <InfoRow
            label="결제금액"
            value={`${reservation.totalAmount.toLocaleString('ko-KR')}원`}
          />
          <Separator />
          <InfoRow label="결제수단" value={reservation.paymentMethod} />
          <Separator />
          <InfoRow
            label="결제일시"
            value={formatDateTime(reservation.paidAt)}
          />
        </CardContent>
      </Card>

      {shouldShowQrTicket && (
        <Card className="mt-4 border-[#E9DFFF] bg-[#F8F5FF] py-4">
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-[#6C3CE0]" />
                  <h2 className="text-base font-semibold text-gray-900">QR 티켓</h2>
                </div>
                <p className="text-sm text-gray-700">
                  {isQrActive
                    ? 'QR 티켓이 준비되었습니다. 입장 시 현장 스태프가 QR을 확인합니다.'
                    : '결제는 완료되었지만 QR 티켓을 확인하는 중입니다. 잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.'}
                </p>
              </div>
              <Badge
                className={
                  isQrActive
                    ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
                    : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
                }
              >
                {isQrActive ? 'QR 활성' : '확인 중'}
              </Badge>
            </div>

            <div className="rounded-xl border border-white/80 bg-white/90 p-4">
              <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
                {qrCheckInUrl ? (
                  <QrTicketImage value={qrCheckInUrl} />
                ) : (
                  <div className="rounded-lg border border-[#F3E6A6] bg-[#FFFBEB] p-4 text-sm text-[#8B6306]">
                    <p className="font-semibold">
                      QR 티켓을 아직 표시할 수 없습니다.
                    </p>
                    <p className="mt-1">
                      잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.
                    </p>
                    <p className="mt-2 text-gray-700">
                      현장 검표 결과가 최종 입장 기준입니다.
                    </p>
                  </div>
                )}
                <div>
                  <InfoRow label="예매번호" value={reservation.reservationNumber} />
                  <Separator />
                  <InfoRow label="공연명" value={reservation.performanceTitle} />
                  <Separator />
                  <InfoRow
                    label="공연일시"
                    value={formatDateTime(reservation.showDateTime)}
                  />
                  <Separator />
                  <InfoRow label="좌석" value={formatSeats(reservation)} />
                  <Separator />
                  <InfoRow
                    label="티켓 상태"
                    value={getQrStatusLabel(reservation.qrTicket.status)}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-white/70 bg-white/80 p-4">
              <Mail className="mt-0.5 h-4 w-4 text-[#6C3CE0]" />
              <p className="text-sm text-gray-700">
                QR 티켓 안내 메일은 공연 24시간 전에 다시 발송됩니다.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {showRefundPreview && (
        <Card className="mt-4 border-[#E9DFFF] bg-[#FAF7FF] py-4">
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-gray-900">
                  환불 및 재오픈 안내
                </h2>
                <p className="text-sm text-gray-700">
                  환불 예정 금액과 취소 후 좌석 재판매 안내를 확인하세요.
                </p>
              </div>
              <Badge
                className={
                  reservation.status === 'CANCELLED'
                    ? 'bg-[#FEF2F2] text-[#C62828] border-transparent'
                    : 'bg-[#F3EFFF] text-[#6C3CE0] border-transparent'
                }
              >
                {reservation.status === 'CANCELLED' ? '취소 접수됨' : '취소 전 확인'}
              </Badge>
            </div>

            <div className="rounded-xl border border-white/80 bg-white/90 p-4">
              <InfoRow
                label={reservation.status === 'CANCELLED' ? '환불 요청 금액' : '환불 예정 금액'}
                value={`${reservation.totalAmount.toLocaleString('ko-KR')}원`}
              />
              <Separator />
              <InfoRow
                label="환불 수단"
                value={`${reservation.paymentMethod} 결제 취소`}
              />
              {hasExpectedDepositAt && reservation.refundTimeline.expectedDepositAt && (
                <>
                  <Separator />
                  <InfoRow
                    label="예상 입금 시점"
                    value={formatDateTime(reservation.refundTimeline.expectedDepositAt)}
                  />
                </>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-[#E5D9FF] bg-white/85 p-4">
              <p className="text-sm text-gray-700">
                환불 반영 시점은 결제수단과 카드사 처리 속도에 따라 달라질 수 있습니다.
              </p>
              <p className="text-sm text-gray-700">{DELAYED_REOPEN_NOTICE}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {showRefundTimeline && (
        <RefundTimeline
          timeline={reservation.refundTimeline}
          cancelledSeatHold={reservation.cancelledSeatHold}
        />
      )}

      {/* Cancel info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            취소 정보
          </h2>
          <div className="flex items-start justify-between py-2">
            <span className="text-sm text-gray-600">취소마감시간</span>
            <div className="text-right">
              <span
                className={`text-sm font-semibold ${
                  isDeadlinePassed ? 'text-error' : 'text-gray-900'
                }`}
              >
                {formatDeadline(reservation.cancelDeadline)}
              </span>
              {isDeadlinePassed && (
                <p className="mt-0.5 text-xs text-[#C62828]">
                  취소 마감시간이 지났습니다
                </p>
              )}
            </div>
          </div>
          {reservation.cancelledAt && (
            <>
              <Separator />
              <InfoRow
                label="취소일시"
                value={formatDateTime(reservation.cancelledAt)}
              />
              {reservation.cancelReason && (
                <>
                  <Separator />
                  <InfoRow label="취소사유" value={reservation.cancelReason} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Cancel button */}
      {showCancelButton && (
        <div className="mt-6">
          {canCancel ? (
            <Button
              variant="destructive"
              className="h-12 w-full"
              onClick={() => setCancelModalOpen(true)}
            >
              예매 취소
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block w-full">
                    <Button
                      variant="destructive"
                      className="h-12 w-full"
                      aria-disabled="true"
                      disabled
                    >
                      예매 취소
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  취소 마감시간이 지났습니다
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      {/* Cancel modal */}
      <CancelConfirmModal
        open={cancelModalOpen}
        onOpenChange={setCancelModalOpen}
        refundAmount={reservation.totalAmount}
        paymentMethod={reservation.paymentMethod}
        expectedDepositAt={reservation.refundTimeline.expectedDepositAt ?? null}
        releaseWindowMinutes={reservation.cancelledSeatHold?.releaseWindowMinutes ?? null}
        onConfirm={onCancel}
        isLoading={isCancelling}
      />
    </div>
  );
}
