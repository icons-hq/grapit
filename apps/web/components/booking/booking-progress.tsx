'use client';

import { useLocale } from 'next-intl';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

export function BookingProgress({ step }: { step: 0 | 1 | 2 }) {
  const copy = getCheckoutCopy(resolveVisibleCopyLocale(useLocale()));
  const steps = [copy.seatStep, copy.paymentStep, copy.ticketStep];
  return <ol className="flex items-center gap-3 text-xs sm:gap-5 sm:text-sm" aria-label={steps[step]}>
    {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}
      className={`flex items-center gap-2 ${index === step ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
      <span className={`flex size-6 items-center justify-center rounded-full text-xs ${index === step ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{index + 1}</span>{label}
    </li>)}
  </ol>;
}
