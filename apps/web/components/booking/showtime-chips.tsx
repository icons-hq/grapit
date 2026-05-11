'use client';

import type { Showtime } from '@grabit/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib';
import { formatKstTimeLabel } from '@/lib/booking-datetime';

interface ShowtimeChipsProps {
  showtimes: Showtime[];
  selected: string | null;
  onSelect: (id: string) => void;
  isLoading?: boolean;
}

export function ShowtimeChips({
  showtimes,
  selected,
  onSelect,
  isLoading,
}: ShowtimeChipsProps) {
  if (isLoading) {
    return (
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (showtimes.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        선택한 날짜에 예정된 회차가 없습니다
      </p>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto">
      {showtimes.map((showtime) => {
        const isActive = showtime.id === selected;
        return (
          <button
            key={showtime.id}
            type="button"
            onClick={() => onSelect(showtime.id)}
            className={cn(
              'h-9 shrink-0 rounded-lg px-4 text-sm font-normal transition-colors',
              isActive
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-900 hover:bg-gray-200',
            )}
          >
            {formatKstTimeLabel(showtime.dateTime)}
          </button>
        );
      })}
    </div>
  );
}
