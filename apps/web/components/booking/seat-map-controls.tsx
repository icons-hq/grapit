'use client';

import { getSeatSelectionCopy } from '@/lib/booking/seat-selection-copy';

import { useControls } from 'react-zoom-pan-pinch';
import { Plus, Minus, Maximize2 } from 'lucide-react';

export function SeatMapControls() {
  const seatCopy = getSeatSelectionCopy();
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div
      aria-label={seatCopy.mapControls}
      className="z-50 flex justify-end gap-2 bg-gray-50 px-3 pt-3 lg:absolute lg:right-4 lg:bottom-4 lg:flex-col lg:bg-transparent lg:p-0"
    >
      <button
        type="button"
        onClick={() => zoomIn()}
        aria-label={seatCopy.zoomIn}
        className="flex size-10 items-center justify-center rounded-lg border bg-white shadow-sm hover:bg-gray-50"
      >
        <Plus className="size-5 text-gray-700" />
      </button>
      <button
        type="button"
        onClick={() => zoomOut()}
        aria-label={seatCopy.zoomOut}
        className="flex size-10 items-center justify-center rounded-lg border bg-white shadow-sm hover:bg-gray-50"
      >
        <Minus className="size-5 text-gray-700" />
      </button>
      <button
        type="button"
        onClick={() => resetTransform()}
        aria-label={seatCopy.fitMap}
        className="flex size-10 items-center justify-center rounded-lg border bg-white shadow-sm hover:bg-gray-50"
      >
        <Maximize2 className="size-5 text-gray-700" />
      </button>
    </div>
  );
}
