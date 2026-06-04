'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { TicketEmailDeliveryPanel } from '@/components/reservation/ticket-email-delivery-panel';
import {
  buildQrCheckInUrl,
  QrTicketImage,
} from '@/components/field/qr-ticket-image';
import type { ReservationDetail, TicketItem } from '@grabit/shared';

interface BookingCompleteProps {
  booking: ReservationDetail;
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatPrice(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

function formatSeats(booking: ReservationDetail): string {
  return booking.seats
    .map((seat) => `${seat.tierName} ${seat.row}열 ${seat.number}번`)
    .join(', ');
}

function formatTicketItemSeat(ticketItem: TicketItem): string {
  return `${ticketItem.tierName} ${ticketItem.row}열 ${ticketItem.number}번`;
}

function getQrStatusLabel(status: ReservationDetail['qrTicket']['status']): string {
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
  admissionState: TicketItem['admissionState'] | ReservationDetail['qrTicket']['entryStatus'],
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
};

function getBuyerQrCards(booking: ReservationDetail): BuyerQrCard[] {
  const ticketItems = Array.isArray(booking.ticketItems) ? booking.ticketItems : [];
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
      };
    });
  }

  const isQrActive = booking.qrTicket?.status === 'ACTIVE' && booking.qrTicket.token;
  return [
    {
      id: 'legacy-qr-ticket',
      seatLabel: formatSeats(booking),
      floorLabel: '',
      qrCheckInUrl: isQrActive ? buildQrCheckInUrl(booking.qrTicket.token) : null,
      qrBadgeLabel: isQrActive ? 'QR 활성' : '확인 중',
      qrUnavailableTitle: 'QR 티켓을 아직 표시할 수 없습니다.',
      qrUnavailableDescription: '잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.',
      ticketStatusLabel: getQrStatusLabel(booking.qrTicket.status),
      admissionStatusLabel: getAdmissionStateLabel(booking.qrTicket.entryStatus),
    },
  ];
}

export function BookingComplete({ booking }: BookingCompleteProps) {
  const router = useRouter();
  const qrCards = getBuyerQrCards(booking);
  const hasActiveQr = qrCards.some((card) => card.qrCheckInUrl);

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Success icon and heading */}
      <div className="flex flex-col items-center gap-3 pt-4">
        <CheckCircle2 className="h-16 w-16 text-success" />
        <h1 className="text-xl font-semibold" tabIndex={-1} id="booking-complete-heading">
          예매가 완료되었습니다
        </h1>
      </div>

      {/* Reservation number */}
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-2 py-6">
          <span className="text-sm text-gray-500">예매번호</span>
          <span
            className="text-2xl font-semibold text-primary"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            aria-label={`예매번호 ${booking.reservationNumber}`}
          >
            {booking.reservationNumber}
          </span>
        </CardContent>
      </Card>

      {/* Performance info */}
      <Card className="w-full">
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold">공연 정보</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">공연명</span>
              <span className="text-right font-semibold text-gray-900">{booking.performanceTitle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">공연일시</span>
              <span className="text-right text-gray-900">{formatDateTime(booking.showDateTime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">장소</span>
              <span className="text-right text-gray-900">{booking.venue}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seat info */}
      <Card className="w-full">
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold">좌석 정보</h2>
          <ul className="space-y-2">
            {booking.seats.map((seat) => (
              <li key={seat.seatId} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">
                  {seat.tierName} {seat.row}열 {seat.number}번
                </span>
                <span className="text-gray-900">{formatPrice(seat.price)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Payment info */}
      <Card className="w-full">
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold">결제 정보</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">결제금액</span>
              <span className="font-semibold text-primary">{formatPrice(booking.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">결제수단</span>
              <span className="text-gray-900">{booking.paymentMethod}</span>
            </div>
            {booking.paidAt && (
              <div className="flex justify-between">
                <span className="text-gray-500">결제일시</span>
                <span className="text-gray-900">{formatDateTime(booking.paidAt)}</span>
              </div>
            )}
            {booking.cancelDeadline && (
              <div className="flex justify-between">
                <span className="text-gray-500">취소마감시간</span>
                <span className="text-gray-900">{formatDateTime(booking.cancelDeadline)}까지</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="w-full border-[#E9DFFF] bg-[#F8F5FF]">
        <CardContent className="space-y-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-[#6C3CE0]" />
                <h2 className="text-base font-semibold text-gray-900">QR 티켓</h2>
              </div>
              <p className="text-sm text-gray-700">
                {hasActiveQr
                  ? 'QR 티켓이 준비되었습니다. 입장 시 현장 스태프가 QR을 확인합니다.'
                  : '결제는 완료되었지만 QR 티켓을 확인하는 중입니다. 잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.'}
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
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <span className="block text-gray-500">예매번호</span>
                      <span className="font-semibold text-gray-900">{booking.reservationNumber}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500">공연명</span>
                      <span className="font-semibold text-gray-900">{booking.performanceTitle}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500">공연일시</span>
                      <span className="font-semibold text-gray-900">
                        {formatDateTime(booking.showDateTime)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-gray-500">좌석</span>
                      <span className="font-semibold text-gray-900">{card.seatLabel}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500">티켓 상태</span>
                      <span className="font-semibold text-gray-900">
                        {card.ticketStatusLabel}
                      </span>
                    </div>
                    <div>
                      <span className="block text-gray-500">입장 상태</span>
                      <span className="font-semibold text-gray-900">
                        {card.admissionStatusLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <TicketEmailDeliveryPanel
            reservationId={booking.id}
            delivery={booking.ticketEmailDelivery}
          />
        </CardContent>
      </Card>

      <Separator />

      {/* CTA buttons */}
      <div className="flex w-full flex-col gap-3 pb-8">
        <Button
          className="h-12 w-full"
          onClick={() => router.push(`/mypage/reservations/${booking.id}`)}
        >
          QR 티켓 보기
        </Button>
        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => router.push('/mypage?tab=reservations')}
        >
          예매내역 보기
        </Button>
        <Button
          variant="ghost"
          className="h-12 w-full"
          onClick={() => router.push('/')}
        >
          홈으로
        </Button>
      </div>
    </div>
  );
}
