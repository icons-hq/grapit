'use client';

import { useEffect } from 'react';
import { BookingProgress } from './booking-progress';
import { useLocale } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBookingStore } from '@/stores/use-booking-store';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

export function ConfirmHeader({ onExpire, onBack, disabled }: {
  onExpire: () => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const expiresAt = useBookingStore((store) => store.expiresAt);
  const copy = getCheckoutCopy(resolveVisibleCopyLocale(useLocale()));
  // Server-issued deadline: compare on the server-corrected clock.
  const deadlineReached = useServerTimeReached(expiresAt || null);
  useEffect(() => {
    if (deadlineReached) onExpire();
  }, [deadlineReached, expiresAt, onExpire]);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
        <Button variant="ghost" className="-ml-3 gap-2 text-muted-foreground" disabled={disabled} onClick={onBack}>
          <ChevronLeft className="size-4" />{copy.back}
        </Button>
        <BookingProgress step={1} />
      </div>
    </header>
  );
}
