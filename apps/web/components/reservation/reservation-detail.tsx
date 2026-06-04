'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Loader2, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CancelConfirmModal } from '@/components/reservation/cancel-confirm-modal';
import { RefundTimeline } from '@/components/reservation/refund-timeline';
import { TicketEmailDeliveryPanel } from '@/components/reservation/ticket-email-delivery-panel';
import {
  buildQrCheckInUrl,
  QrTicketImage,
} from '@/components/field/qr-ticket-image';
import type {
  ReservationDetail as ReservationDetailType,
  ReservationStatus,
  TicketItem,
} from '@grabit/shared';

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

function formatDateTime(dateString: string | null | undefined, fallback = '-'): string {
  if (!dateString) {
    return fallback;
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return fallback;
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

function formatTicketItemSeat(ticketItem: TicketItem): string {
  return `${ticketItem.tierName} ${ticketItem.row}열 ${ticketItem.number}번`;
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

function getEntryStatusLabel(
  entryStatus: ReservationDetailType['qrTicket']['entryStatus'],
): string {
  return entryStatus === 'ENTERED' ? '입장 완료' : '입장 전';
}

function getTicketItemStatusLabel(status: TicketItem['status']): string {
  switch (status) {
    case 'ACTIVE':
      return '티켓 유효';
    case 'CANCELLATION_PENDING':
      return '취소 확인 중';
    case 'CANCELLED':
      return '취소됨';
    case 'EXPIRED':
      return '만료됨';
    default:
      return '확인 중';
  }
}

function getAdmissionStateLabel(
  admissionState: TicketItem['admissionState'] | ReservationDetailType['qrTicket']['entryStatus'],
): string {
  return admissionState === 'ENTERED' ? '입장 완료' : '입장 전';
}

function getTicketItemQrBadgeLabel(status: TicketItem['status'], hasActiveQr: boolean): string {
  if (hasActiveQr) {
    return 'QR 활성';
  }
  if (status === 'CANCELLATION_PENDING') {
    return '취소 확인 중';
  }
  if (status === 'CANCELLED') {
    return '취소됨';
  }
  if (status === 'EXPIRED') {
    return '만료됨';
  }

  return '확인 중';
}

function getTicketItemQrUnavailableCopy(status: TicketItem['status']) {
  if (status === 'CANCELLATION_PENDING') {
    return {
      title: '취소 확인 중입니다.',
      description: '부분취소 결과를 확인 중입니다. 처리 완료 전까지 QR 티켓은 사용할 수 없습니다.',
    };
  }
  if (status === 'CANCELLED') {
    return {
      title: '취소된 티켓입니다.',
      description: '이 좌석의 QR 티켓은 사용할 수 없습니다.',
    };
  }
  if (status === 'EXPIRED') {
    return {
      title: '만료된 티켓입니다.',
      description: '이 좌석의 QR 티켓은 사용할 수 없습니다.',
    };
  }

  return {
    title: 'QR 티켓을 아직 표시할 수 없습니다.',
    description: '잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.',
  };
}

type BuyerQrCard = {
  id: string;
  seatLabel: string;
  floorLabel: string;
  qrCheckInUrl: string | null;
  qrBadgeLabel: string;
  qrUnavailableTitle: string;
  qrUnavailableDescription: string;
  ticketStatusLabel: string;
  admissionStatusLabel: string;
  admissionState: 'NOT_ENTERED' | 'ENTERED';
  enteredAt: string | null;
  status: TicketItem['status'];
  price: number;
  serviceFee: number;
};

function getBuyerQrCards(reservation: ReservationDetailType): BuyerQrCard[] {
  const ticketItems = Array.isArray(reservation.ticketItems) ? reservation.ticketItems : [];
  if (ticketItems.length > 0) {
    return ticketItems.map((ticketItem) => {
      const credential = ticketItem.qrCredential;
      const qrCheckInUrl = credential?.status === 'ACTIVE' && credential.token
        ? buildQrCheckInUrl(credential.token)
        : null;
      const unavailableCopy = getTicketItemQrUnavailableCopy(ticketItem.status);

      return {
        id: ticketItem.id,
        seatLabel: formatTicketItemSeat(ticketItem),
        floorLabel: ticketItem.floorLabel,
        qrCheckInUrl,
        qrBadgeLabel: getTicketItemQrBadgeLabel(ticketItem.status, Boolean(qrCheckInUrl)),
        qrUnavailableTitle: unavailableCopy.title,
        qrUnavailableDescription: unavailableCopy.description,
        ticketStatusLabel: getTicketItemStatusLabel(ticketItem.status),
        admissionStatusLabel: getAdmissionStateLabel(ticketItem.admissionState),
        admissionState: ticketItem.admissionState,
        enteredAt: ticketItem.enteredAt,
        status: ticketItem.status,
        price: ticketItem.price,
        serviceFee: ticketItem.serviceFee,
      };
    });
  }

  const isQrActive = reservation.qrTicket?.status === 'ACTIVE' && reservation.qrTicket.token;
  const admissionState = reservation.qrTicket.entryStatus === 'ENTERED'
    ? 'ENTERED'
    : 'NOT_ENTERED';

  return [
    {
      id: 'legacy-qr-ticket',
      seatLabel: formatSeats(reservation),
      floorLabel: '',
      qrCheckInUrl: isQrActive ? buildQrCheckInUrl(reservation.qrTicket.token) : null,
      qrBadgeLabel: isQrActive ? 'QR 활성' : '확인 중',
      qrUnavailableTitle: 'QR 티켓을 아직 표시할 수 없습니다.',
      qrUnavailableDescription: '잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.',
      ticketStatusLabel: getQrStatusLabel(reservation.qrTicket.status),
      admissionStatusLabel: getEntryStatusLabel(reservation.qrTicket.entryStatus),
      admissionState,
      enteredAt: reservation.qrTicket.enteredAt ?? null,
      status: reservation.qrTicket.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE',
      price: reservation.totalAmount,
      serviceFee: 0,
    },
  ];
}

function hasPersistedTicketItems(reservation: ReservationDetailType): boolean {
  const ticketItems = Array.isArray(reservation.ticketItems) ? reservation.ticketItems : [];
  return ticketItems.some((ticketItem) => ticketItem.isLegacyFallback !== true);
}

const DELAYED_REOPEN_NOTICE =
  '취소된 좌석은 즉시 재오픈되지 않을 수 있으며, 잠시 후 다시 판매될 수 있습니다';
const TICKET_CANCEL_REASONS = [
  '단순 변심',
  '일정 변경',
  '다른 좌석으로 재예매',
  '기타',
] as const;
const SEOUL_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getSeoulDayOrdinal(date: Date): number {
  const parts = SEOUL_DAY_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function isBeforeShowDateInSeoul(showDateTime: string): boolean {
  const showtime = new Date(showDateTime);
  if (Number.isNaN(showtime.getTime())) {
    return false;
  }

  return getSeoulDayOrdinal(showtime) - getSeoulDayOrdinal(new Date()) > 0;
}

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
  onResumePayment?: (reservation: ReservationDetailType) => void;
  onCancelTicketItem?: (ticketItemId: string, reason: string) => void | Promise<void>;
  isCancellingTicketItem?: boolean;
}

export function ReservationDetailView({
  reservation,
  onCancel,
  isCancelling,
  onResumePayment,
  onCancelTicketItem,
  isCancellingTicketItem = false,
}: ReservationDetailProps) {
  const router = useRouter();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [ticketCancelTarget, setTicketCancelTarget] = useState<BuyerQrCard | null>(null);
  const [ticketCancelReason, setTicketCancelReason] = useState('');
  const statusConfig = STATUS_CONFIG[reservation.status];
  const paymentMethodLabel = reservation.paymentMethod ?? '결제수단';

  const isDeadlinePassed = new Date(reservation.cancelDeadline) < new Date();
  const isPaymentDeadlinePassed = new Date(reservation.paymentDeadlineAt) < new Date();
  const canCancel = reservation.status === 'CONFIRMED' && !isDeadlinePassed;
  const hasSeatLevelTicketItems = hasPersistedTicketItems(reservation);
  const ticketItemRefundTotal = hasSeatLevelTicketItems
    ? reservation.ticketItems.reduce(
        (total, ticketItem) => total + (ticketItem.cancellation?.refundableAmount ?? 0),
        0,
      )
    : 0;
  const displayedRefundAmount =
    hasSeatLevelTicketItems && ticketItemRefundTotal > 0
      ? ticketItemRefundTotal
      : reservation.totalAmount;
  const showCancelButton = reservation.status === 'CONFIRMED' && !hasSeatLevelTicketItems;
  const canResumePayment =
    reservation.status === 'PENDING_PAYMENT' &&
    !isPaymentDeadlinePassed &&
    Boolean(onResumePayment);
  const showRefundPreview =
    reservation.status === 'CONFIRMED' ||
    reservation.status === 'CANCELLED';
  const showRefundTimeline =
    reservation.status === 'CANCELLED' ||
    reservation.cancelledAt !== null ||
    reservation.refundTimeline.currentState !== 'COMPLETED';
  const hasExpectedDepositAt =
    Boolean(reservation.refundTimeline.expectedDepositAt) && showRefundTimeline;
  const qrCards = getBuyerQrCards(reservation);
  const hasActiveQr = qrCards.some((card) => card.qrCheckInUrl);
  const shouldShowQrTicket =
    reservation.status !== 'PENDING_PAYMENT' &&
    (reservation.status === 'CONFIRMED' || hasSeatLevelTicketItems);
  const qrSectionDescription = hasActiveQr
    ? 'QR 티켓이 준비되었습니다. 입장 및 현장 혜택 확인 시 스태프가 QR을 확인합니다.'
    : hasSeatLevelTicketItems
      ? '좌석별 티켓 상태를 확인할 수 있습니다. 취소된 티켓의 QR은 표시되지 않습니다.'
      : '결제는 완료되었지만 QR 티켓을 확인하는 중입니다. 잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.';
  const canCancelTicketItems =
    reservation.status === 'CONFIRMED' &&
    hasSeatLevelTicketItems &&
    isBeforeShowDateInSeoul(reservation.showDateTime) &&
    Boolean(onCancelTicketItem);

  function closeTicketCancelDialog() {
    setTicketCancelTarget(null);
    setTicketCancelReason('');
  }

  async function handleConfirmTicketCancel() {
    if (!ticketCancelTarget || !ticketCancelReason || !onCancelTicketItem) {
      return;
    }

    try {
      await onCancelTicketItem(ticketCancelTarget.id, ticketCancelReason);
      closeTicketCancelDialog();
    } catch {
      // The page-level mutation handler owns user-facing error copy.
    }
  }

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
          <InfoRow label="결제수단" value={reservation.paymentMethod ?? '선택 전'} />
          <Separator />
          <InfoRow
            label="결제일시"
            value={formatDateTime(reservation.paidAt, '결제 전')}
          />
        </CardContent>
      </Card>

      {reservation.status === 'PENDING_PAYMENT' && (
        <Card className="mt-4 border-[#F3E6A6] bg-[#FFFBEB] py-4">
          <CardContent className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[#8B6306]">결제 대기 중</h2>
              <p className="mt-1 text-sm text-gray-700">
                결제를 완료해야 예매와 QR 티켓이 확정됩니다.
              </p>
              {isPaymentDeadlinePassed && (
                <p className="mt-2 text-sm font-medium text-[#C62828]">
                  결제 가능 시간이 만료되었습니다. 좌석을 다시 선택해주세요.
                </p>
              )}
            </div>
            {canResumePayment && (
              <Button
                type="button"
                className="h-12 w-full"
                onClick={() => onResumePayment?.(reservation)}
              >
                결제 계속하기
              </Button>
            )}
          </CardContent>
        </Card>
      )}

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
                  {qrSectionDescription}
                </p>
              </div>
              <Badge
                className={
                  hasActiveQr
                    ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
                    : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
                }
              >
                {hasActiveQr ? 'QR 활성' : '확인 중'}
              </Badge>
            </div>

            <div className="space-y-3">
              {qrCards.map((card) => (
                <div
                  key={card.id}
                  data-testid={`qr-ticket-card-${card.id}`}
                  className="rounded-xl border border-white/80 bg-white/90 p-4"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{card.seatLabel}</h3>
                      {card.floorLabel && (
                        <p className="mt-1 text-xs text-gray-500">{card.floorLabel}</p>
                      )}
                    </div>
                    <Badge
                      className={
                        card.qrCheckInUrl
                          ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
                          : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
                      }
                    >
                      {card.qrBadgeLabel}
                    </Badge>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
                    {card.qrCheckInUrl ? (
                      <QrTicketImage
                        value={card.qrCheckInUrl}
                        title={`${card.seatLabel} 검표 QR`}
                      />
                    ) : (
                      <div className="rounded-lg border border-[#F3E6A6] bg-[#FFFBEB] p-4 text-sm text-[#8B6306]">
                        <p className="font-semibold">
                          {card.qrUnavailableTitle}
                        </p>
                        <p className="mt-1">
                          {card.qrUnavailableDescription}
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
                      <InfoRow label="좌석" value={card.seatLabel} />
                      <Separator />
                      <InfoRow
                        label="티켓 상태"
                        value={card.ticketStatusLabel}
                      />
                      <Separator />
                      <InfoRow
                        label="입장 상태"
                        value={card.admissionStatusLabel}
                      />
                      {canCancelTicketItems &&
                        card.status === 'ACTIVE' &&
                        card.admissionState === 'NOT_ENTERED' && (
                          <div className="mt-4 flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setTicketCancelTarget(card)}
                              disabled={isCancellingTicketItem}
                            >
                              이 티켓 취소
                            </Button>
                          </div>
                        )}
                    </div>
                  </div>

                  {card.admissionState === 'ENTERED' && (
                    <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#15803D]" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[#166534]">
                          입장 처리가 완료되었습니다.
                        </p>
                        {card.enteredAt && (
                          <p className="text-sm text-[#166534]">
                            처리 시각 {formatDateTime(card.enteredAt)}
                          </p>
                        )}
                        <p className="text-sm text-gray-700">
                          QR 티켓은 현장 혜택 확인 등 추가 처리에 계속 사용할 수 있습니다.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <TicketEmailDeliveryPanel
              reservationId={reservation.id}
              delivery={reservation.ticketEmailDelivery}
            />
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
                value={`${displayedRefundAmount.toLocaleString('ko-KR')}원`}
              />
              <Separator />
              <InfoRow
                label="환불 수단"
                value={`${paymentMethodLabel} 결제 취소`}
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

      <Dialog
        open={Boolean(ticketCancelTarget)}
        onOpenChange={(open) => {
          if (!open) {
            closeTicketCancelDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              티켓을 취소하시겠습니까?
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              선택한 좌석 1장만 취소됩니다. 취소 수수료와 예매 수수료 환불 여부는 NOL Ticket 기준으로 티켓별 적용됩니다.
            </DialogDescription>
          </DialogHeader>

          {ticketCancelTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <InfoRow label="좌석" value={ticketCancelTarget.seatLabel} />
                <Separator />
                <InfoRow
                  label="티켓 금액"
                  value={`${ticketCancelTarget.price.toLocaleString('ko-KR')}원`}
                />
                <Separator />
                <InfoRow
                  label="예매 수수료"
                  value={`${ticketCancelTarget.serviceFee.toLocaleString('ko-KR')}원`}
                />
              </div>

              <div>
                <label
                  htmlFor="ticket-cancel-reason"
                  className="mb-2 block text-sm font-semibold text-gray-700"
                >
                  취소 사유
                </label>
                <Select value={ticketCancelReason} onValueChange={setTicketCancelReason}>
                  <SelectTrigger id="ticket-cancel-reason" className="w-full">
                    <SelectValue placeholder="취소 사유를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_CANCEL_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {reason}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeTicketCancelDialog}
              disabled={isCancellingTicketItem}
            >
              닫기
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmTicketCancel}
              disabled={!ticketCancelReason || isCancellingTicketItem}
            >
              {isCancellingTicketItem ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  취소 처리 중...
                </>
              ) : (
                '티켓 취소'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel modal */}
      <CancelConfirmModal
        open={cancelModalOpen}
        onOpenChange={setCancelModalOpen}
        refundAmount={displayedRefundAmount}
        paymentMethod={paymentMethodLabel}
        expectedDepositAt={reservation.refundTimeline.expectedDepositAt ?? null}
        releaseWindowMinutes={reservation.cancelledSeatHold?.releaseWindowMinutes ?? null}
        onConfirm={onCancel}
        isLoading={isCancelling}
      />
    </div>
  );
}
