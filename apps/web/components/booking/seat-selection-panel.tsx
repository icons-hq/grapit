'use client';

import { Loader2 } from 'lucide-react';
import { TICKET_SERVICE_FEE_KRW, type SeatSelection, type Showtime } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { formatKstDateLabel, formatKstTimeLabel } from '@/lib/booking-datetime';
import { SeatRow } from './seat-row';

interface SeatSelectionPanelProps {
  performanceTitle: string;
  selectedDate: Date | null;
  selectedShowtime: Showtime | null;
  selectedSeats: SeatSelection[];
  onRemove: (seatId: string) => void;
  onProceed: () => void;
  isLoading: boolean;
  disabledReason?: string | null;
}

export function SeatSelectionPanel({
  performanceTitle,
  selectedDate,
  selectedShowtime,
  selectedSeats,
  onRemove,
  onProceed,
  isLoading,
  disabledReason = null,
}: SeatSelectionPanelProps) {
  const seatTotal = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  const serviceFeeTotal = selectedSeats.length * TICKET_SERVICE_FEE_KRW;
  const totalPrice = seatTotal + serviceFeeTotal;

  return (
    <div className="hidden w-[360px] shrink-0 lg:block">
      <div className="sticky top-16 max-h-[calc(100vh-80px)] space-y-6 overflow-y-auto rounded-lg border bg-white p-6">
        {/* Performance info */}
        <div>
          <p className="truncate text-base font-semibold text-gray-900">
            {performanceTitle}
          </p>
          {selectedDate && selectedShowtime && (
            <p className="mt-1 text-sm text-gray-500">
              {formatKstDateLabel(selectedShowtime.dateTime)} {formatKstTimeLabel(selectedShowtime.dateTime)}
            </p>
          )}
        </div>

        {/* Selected seats */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900">선택 좌석</h2>
          {selectedSeats.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              좌석을 선택해주세요. 좌석맵에서 원하는 좌석을 탭하면 이곳에 표시됩니다.
            </p>
          ) : (
            <div className="mt-3 divide-y">
              {selectedSeats.map((seat) => (
                <SeatRow key={seat.seatId} seat={seat} onRemove={onRemove} />
              ))}
            </div>
          )}
          <p className="mt-2 text-sm text-gray-400">
            최대 4석까지 선택 가능합니다
          </p>
        </div>

        {/* Total */}
        <div className="border-l-[3px] border-primary pl-4">
          <p className="text-sm text-gray-500">총 합계</p>
          {selectedSeats.length > 0 && (
            <div className="mt-2 space-y-1 text-sm text-gray-500">
              <div className="flex justify-between">
                <span>좌석 금액</span>
                <span>{seatTotal.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between">
                <span>예매 수수료</span>
                <span>{serviceFeeTotal.toLocaleString()}원</span>
              </div>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-base text-gray-700">
              {selectedSeats.length}석
            </span>
            <span className="text-xl font-semibold text-gray-900">
              {totalPrice.toLocaleString()}원
            </span>
          </div>
        </div>

        {/* CTA */}
        {disabledReason && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {disabledReason}
          </p>
        )}
        <Button
          className="h-12 w-full text-base"
          disabled={!!disabledReason || selectedSeats.length === 0 || isLoading}
          onClick={onProceed}
        >
          {isLoading ? (
            <><Loader2 className="mr-2 size-4 animate-spin" />처리 중...</>
          ) : disabledReason ?? (selectedSeats.length === 0 ? '좌석을 선택해주세요' : '다음')}
        </Button>
      </div>
    </div>
  );
}
