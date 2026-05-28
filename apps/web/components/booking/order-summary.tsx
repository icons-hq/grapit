'use client';

import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { TICKET_SERVICE_FEE_KRW, type SeatSelection } from '@grabit/shared';

interface OrderSummaryProps {
  performanceTitle: string;
  posterUrl: string | null;
  showDateTime: string;
  venue: string;
  seats: SeatSelection[];
  totalPrice: number;
}

export function OrderSummary({
  performanceTitle,
  posterUrl,
  showDateTime,
  venue,
  seats,
  totalPrice,
}: OrderSummaryProps) {
  const serviceFeeTotal = seats.length * TICKET_SERVICE_FEE_KRW;

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-base font-semibold">공연 정보</h2>

        <div className="flex gap-4">
          {posterUrl ? (
            <div className="relative h-[112px] w-[80px] shrink-0 overflow-hidden rounded-md">
              <Image
                src={posterUrl}
                alt={performanceTitle}
                fill
                className="object-cover"
                sizes="80px"
              />
            </div>
          ) : (
            <div className="flex h-[112px] w-[80px] shrink-0 items-center justify-center rounded-md bg-gray-100">
              <span className="text-xs text-gray-400">No Image</span>
            </div>
          )}
          <div className="flex flex-col justify-center gap-1">
            <p className="text-base font-semibold text-gray-900">{performanceTitle}</p>
            <p className="text-sm text-gray-600">{showDateTime}</p>
            <p className="text-sm text-gray-600">{venue}</p>
          </div>
        </div>

        <Separator />

        <h2 className="text-base font-semibold">선택 좌석</h2>

        <ul className="space-y-2">
          {seats.map((seat) => (
            <li key={seat.seatId} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">
                {seat.tierName} {seat.row}열 {seat.number}번
              </span>
              <span className="text-gray-900">
                {seat.price.toLocaleString('ko-KR')}원
              </span>
            </li>
          ))}
        </ul>

        <Separator />

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">예매 수수료</span>
            <span className="text-gray-900">
              {serviceFeeTotal.toLocaleString('ko-KR')}원
            </span>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">총 {seats.length}매</span>
          <div className="text-right">
            <p className="text-xs text-gray-500">총 결제금액</p>
            <p className="text-xl font-semibold text-primary">
              {totalPrice.toLocaleString('ko-KR')}원
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
