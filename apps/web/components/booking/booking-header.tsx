'use client';

import { getSeatSelectionCopy } from '@/lib/booking/seat-selection-copy';

import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountdownTimer } from './countdown-timer';

interface BookingHeaderProps {
  performanceTitle: string;
  expiresAt: number | null;
  onBack: () => void;
  onExpire: () => void;
}

export function BookingHeader({
  performanceTitle,
  expiresAt,
  onBack,
  onExpire,
}: BookingHeaderProps) {
  const seatCopy = getSeatSelectionCopy();
  return (
    <header className="sticky top-0 z-50 flex h-12 items-center justify-between border-b bg-white px-4 shadow-sm lg:h-14 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label={seatCopy.back}
      >
        <ChevronLeft className="size-5" />
      </Button>

      <h1 className="max-w-[200px] truncate text-lg font-semibold text-gray-900 lg:max-w-[400px]">
        {performanceTitle}
      </h1>

      <div>
        <CountdownTimer expiresAt={expiresAt} onExpire={onExpire} />
      </div>
    </header>
  );
}
