'use client';

import { X } from 'lucide-react';
import type { FloorAwareSeatSelection, SeatSelection } from '@grabit/shared';

interface SeatRowProps {
  seat: FloorAwareSeatSelection | SeatSelection;
  onRemove: (seatKey: string) => void;
}

export function SeatRow({ seat, onRemove }: SeatRowProps) {
  const removalKey = 'seatKey' in seat ? seat.seatKey : seat.seatId;

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-3 rounded-full"
          style={{ backgroundColor: seat.tierColor }}
        />
        <span className="text-sm text-gray-700">{seat.tierName}</span>
        <span className="text-sm text-gray-900">
          {seat.row}열 {seat.number}번
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-gray-900">
          {seat.price.toLocaleString()}원
        </span>
        <button
          type="button"
          onClick={() => onRemove(removalKey)}
          aria-label="좌석 선택 해제"
          className="flex size-6 items-center justify-center rounded text-gray-400 hover:text-gray-600"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
