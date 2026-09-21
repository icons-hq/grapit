'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBookingStore } from '@/stores/use-booking-store';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

export function ConfirmHeader({ onExpire, onBack, disabled }: {
  onExpire: () => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const expiresAt = useBookingStore((store) => store.expiresAt);
  const copy = getCheckoutCopy(resolveVisibleCopyLocale(useLocale()));
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(onExpire, Math.min(2_147_483_647, Math.max(0, expiresAt - Date.now())));
    return () => window.clearTimeout(timer);
  }, [expiresAt, onExpire]);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
        <Button variant="ghost" className="-ml-3 gap-2 text-muted-foreground" disabled={disabled} onClick={onBack}>
          <ChevronLeft className="size-4" />{copy.back}
        </Button>
        <ol className="flex items-center gap-3 text-xs sm:gap-5 sm:text-sm" aria-label={copy.paymentStep}>
          {[copy.seatStep, copy.paymentStep, copy.ticketStep].map((step, index) => (
            <li key={step} aria-current={index === 1 ? 'step' : undefined} className={`flex items-center gap-2 ${index === 1 ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
              <span className={`flex size-6 items-center justify-center rounded-full text-xs ${index === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{index + 1}</span>{step}
            </li>
          ))}
        </ol>
      </div>
    </header>
  );
}
