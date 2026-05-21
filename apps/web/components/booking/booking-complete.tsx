'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, Mail, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import type { ReservationDetail } from '@grabit/shared';

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

function maskIdentifier(value: string | null | undefined): string {
  if (!value) {
    return '발급 대기';
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

export function BookingComplete({ booking }: BookingCompleteProps) {
  const router = useRouter();
  const isQrActive = booking.qrTicket?.status === 'ACTIVE';

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
                {isQrActive
                  ? '결제가 완료되었습니다. QR 티켓을 바로 확인할 수 있습니다.'
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
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="block text-gray-500">상태</span>
                <span className="font-semibold text-gray-900">
                  {isQrActive ? 'QR 활성' : 'QR 확인 중'}
                </span>
              </div>
              <div>
                <span className="block text-gray-500">티켓 ID</span>
                <span className="font-semibold text-gray-900">
                  {isQrActive ? maskIdentifier(booking.qrTicket?.jti) : '발급 대기'}
                </span>
              </div>
              <div>
                <span className="block text-gray-500">예매번호</span>
                <span className="font-semibold text-gray-900">{booking.reservationNumber}</span>
              </div>
              <div>
                <span className="block text-gray-500">결제 상태</span>
                <span className="font-semibold text-gray-900">
                  {booking.status === 'CONFIRMED' && booking.paidAt ? '결제 완료' : '확인 중'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/80 bg-white/90 p-4">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 text-[#6C3CE0]" />
              <p className="text-sm text-gray-700">
                QR 티켓 안내 메일은 공연 24시간 전에 다시 발송됩니다.
              </p>
            </div>
          </div>
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
