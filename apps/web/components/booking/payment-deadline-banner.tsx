'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock3 } from 'lucide-react';

const CRITICAL_REMAINING_MS = 2 * 60 * 1000;
const CRITICAL_REMAINING_LABEL = '02:00';

function formatRemainingTime(targetAt: string | null, nowMs: number): string {
  if (!targetAt) {
    return '00:00';
  }

  const remainingMs = Math.max(0, new Date(targetAt).getTime() - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function PaymentDeadlineBanner({
  paymentDeadlineAt,
  lockExpiresAt,
}: {
  paymentDeadlineAt: string | null;
  lockExpiresAt: string | null;
}) {
  const t = useTranslations('booking');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const paymentRemainingMs = useMemo(() => {
    if (!paymentDeadlineAt) {
      return 0;
    }

    return Math.max(0, new Date(paymentDeadlineAt).getTime() - nowMs);
  }, [paymentDeadlineAt, nowMs]);

  const isCritical = paymentRemainingMs <= CRITICAL_REMAINING_MS;
  const paymentRemainingLabel = formatRemainingTime(paymentDeadlineAt, nowMs);
  const lockRemainingLabel = formatRemainingTime(lockExpiresAt, nowMs);

  return (
    <section aria-label={t('paymentDeadline.badge')} className={`space-y-2 border-b border-border pb-5 ${isCritical ? 'text-destructive' : 'text-muted-foreground'}`}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {isCritical ? <AlertTriangle className="size-4" /> : <Clock3 className="size-4" />}
          {t('paymentDeadline.badge')}
        </h2>
        <p role="timer" aria-live="off" className="text-xl font-semibold tabular-nums text-primary">{paymentRemainingLabel}</p>
      </div>
      <p role="status" className="text-xs leading-relaxed">{isCritical
        ? t('paymentDeadline.criticalHelper', { threshold: CRITICAL_REMAINING_LABEL })
        : t('paymentDeadline.helper', { threshold: CRITICAL_REMAINING_LABEL })}</p>
      <p className="sr-only">{t('paymentDeadline.seatHoldHelper', { time: lockRemainingLabel })}</p>
    </section>
  );
}
