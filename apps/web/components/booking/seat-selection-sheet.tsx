'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { SeatSelection, Showtime } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { SeatRow } from './seat-row';

interface SeatSelectionSheetProps {
  performanceTitle: string;
  selectedDate: Date | null;
  selectedShowtime: Showtime | null;
  selectedSeats: SeatSelection[];
  onRemove: (seatId: string) => void;
  onProceed: () => void;
  isLoading: boolean;
  disabledReason?: string | null;
}

const COLLAPSED_HEIGHT = 72;
const EXPANDED_RATIO = 0.6; // 60vh
const SNAP_THRESHOLD = 0.3; // 30% of range triggers snap
const VELOCITY_THRESHOLD = 0.5; // px/ms

export function SeatSelectionSheet({
  selectedSeats,
  onRemove,
  onProceed,
  isLoading,
  disabledReason = null,
}: SeatSelectionSheetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const prevSeatCount = useRef(selectedSeats.length);

  const totalPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0);

  // Auto-expand on first seat selection
  useEffect(() => {
    if (prevSeatCount.current === 0 && selectedSeats.length > 0) {
      setIsExpanded(true);
    }
    prevSeatCount.current = selectedSeats.length;
  }, [selectedSeats.length]);

  const getExpandedHeight = useCallback(() => {
    if (typeof window === 'undefined') return 400;
    return window.innerHeight * EXPANDED_RATIO;
  }, []);

  const getCurrentHeight = useCallback(() => {
    return isExpanded ? getExpandedHeight() : COLLAPSED_HEIGHT;
  }, [isExpanded, getExpandedHeight]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { y: touch.clientY, time: Date.now() };
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.touches[0];
      const deltaY = touch.clientY - touchStartRef.current.y;
      setTranslateY(deltaY);
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;

    const deltaY = translateY;
    const elapsed = Date.now() - touchStartRef.current.time;
    const velocity = Math.abs(deltaY) / elapsed;
    const range = getExpandedHeight() - COLLAPSED_HEIGHT;

    // Determine snap direction
    if (isExpanded) {
      // Dragging down -> collapse
      if (
        velocity > VELOCITY_THRESHOLD ||
        deltaY > range * SNAP_THRESHOLD
      ) {
        setIsExpanded(false);
      }
    } else {
      // Dragging up -> expand
      if (
        velocity > VELOCITY_THRESHOLD ||
        deltaY < -(range * SNAP_THRESHOLD)
      ) {
        setIsExpanded(true);
      }
    }

    setTranslateY(0);
    setIsDragging(false);
    touchStartRef.current = null;
  }, [isExpanded, translateY, getExpandedHeight]);

  if (selectedSeats.length === 0) return null;

  const sheetHeight = getCurrentHeight();

  return (
    <div
      role="dialog"
      aria-label="선택 좌석 패널"
      className="fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl border-t bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.1)] lg:hidden"
      style={{
        height: sheetHeight,
        transform: isDragging ? `translateY(${translateY}px)` : undefined,
        transition: isDragging ? 'none' : 'height 200ms ease-out',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Drag handle */}
      <div className="flex justify-center py-2">
        <div className="h-1 w-10 rounded-full bg-gray-300" />
      </div>

      {isExpanded ? (
        /* Expanded view */
        <div className="flex h-[calc(100%-28px)] flex-col px-4 pb-4">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            선택 좌석
          </h2>
          <div className="flex-1 divide-y overflow-y-auto">
            {selectedSeats.map((seat) => (
              <SeatRow key={seat.seatId} seat={seat} onRemove={onRemove} />
            ))}
          </div>
          <div className="mt-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                총 합계 {selectedSeats.length}석
              </span>
              <span className="text-lg font-semibold text-gray-900">
                {totalPrice.toLocaleString()}원
              </span>
            </div>
            <Button
              className="mt-3 h-12 w-full text-base"
              disabled={!!disabledReason || isLoading}
              onClick={onProceed}
            >
              {isLoading ? (
                <><Loader2 className="mr-2 size-4 animate-spin" />처리 중...</>
              ) : disabledReason ?? '다음'}
            </Button>
          </div>
        </div>
      ) : (
        /* Collapsed view */
        <div className="flex items-center justify-between px-4">
          <span className="text-sm font-normal text-gray-900">
            {selectedSeats.length}석 선택 | {totalPrice.toLocaleString()}원
          </span>
          <Button
            size="sm"
            disabled={!!disabledReason || isLoading}
            onClick={onProceed}
          >
            {isLoading ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />처리 중...</>
            ) : disabledReason ?? '다음'}
          </Button>
        </div>
      )}
    </div>
  );
}
