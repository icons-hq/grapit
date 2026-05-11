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
    <section
      role="status"
      aria-live="polite"
      className={`rounded-2xl border px-5 py-4 ${
        isCritical
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-slate-200 bg-slate-50 text-slate-900'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
            {isCritical ? <AlertTriangle className="size-4" /> : <Clock3 className="size-4" />}
            <span>{t('paymentDeadline.badge')}</span>
          </div>
          <h2 className="text-base font-semibold">{t('paymentDeadline.title')}</h2>
          <p className="text-sm opacity-80">
            {isCritical
              ? t('paymentDeadline.criticalHelper', { threshold: CRITICAL_REMAINING_LABEL })
              : t('paymentDeadline.helper', { threshold: CRITICAL_REMAINING_LABEL })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[2rem] font-semibold tabular-nums leading-none">
            {paymentRemainingLabel}
          </p>
          <p className="mt-2 text-xs opacity-70">
            {t('paymentDeadline.seatHoldHelper', { time: lockRemainingLabel })}
          </p>
        </div>
      </div>
    </section>
  );
}
