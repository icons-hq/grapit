'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AuthGuard } from '@/components/auth/auth-guard';
import { BookingComplete } from '@/components/booking/booking-complete';
import Link from 'next/link';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  useBookingPaymentRecovery,
  useConfirmPayment,
  useReconcileAsyncPaymentReturn,
} from '@/hooks/use-booking';
import {
  CONFIRM_PAYMENT_RETURN_PARAMS,
  buildConfirmPaymentPayload,
  hasValidConfirmPaymentReturn,
  isRetryableConfirmPaymentError,
} from '@/lib/booking/payment-return';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import type { ReservationDetail } from '@grabit/shared';

function formatDeadline(dateStr: string | null, locale: string): string | null {
  if (!dateStr) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
    timeZoneName: 'short',
  }).format(new Date(dateStr));
}

function CompleteSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[720px] animate-pulse space-y-6 px-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <div className="h-16 w-16 rounded-full bg-gray-200" />
        <div className="h-6 w-48 rounded bg-gray-200" />
      </div>
      <div className="h-24 rounded-xl bg-gray-100" />
      <div className="h-32 rounded-xl bg-gray-100" />
      <div className="h-32 rounded-xl bg-gray-100" />
      <div className="h-32 rounded-xl bg-gray-100" />
    </div>
  );
}

interface RecoveryStateCardProps {
  tone: 'amber' | 'red';
  title: string;
  body: string;
  deadlineLabel?: string | null;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: 'refresh';
    disabled?: boolean;
  };
  supportAction?: { label: string; href: string };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

function RecoveryStateCard({
  tone,
  title,
  body,
  deadlineLabel,
  primaryAction,
  secondaryAction,
  supportAction,
}: RecoveryStateCardProps) {
  const toneClasses = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-red-200 bg-red-50 text-red-700';
  const secondaryToneClasses = tone === 'amber' ? 'text-amber-900' : 'text-red-700';

  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-[720px] items-center justify-center px-6 py-12">
      <section
        role={tone === 'red' ? 'alert' : 'status'}
        className={`w-full rounded-2xl border p-6 ${toneClasses}`}
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-2 text-sm">{body}</p>
            {deadlineLabel && (
              <p className="mt-3 text-sm font-medium">{deadlineLabel}</p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              {primaryAction && (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-current px-4 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {primaryAction.icon === 'refresh' && (
                    primaryAction.disabled
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />
                  )}
                  {primaryAction.label}
                </button>
              )}
              {secondaryAction && (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  className={`text-sm font-medium underline ${secondaryToneClasses}`}
                >
                  {secondaryAction.label}
                </button>
              )}
            </div>
            {supportAction && <Link className="mt-4 inline-block text-sm underline" href={supportAction.href}>{supportAction.label}</Link>}
          </div>
        </div>
      </section>
    </main>
  );
}

function CompletePageContent() {
  const t = useTranslations('booking.paymentRecovery');
  const locale = resolveVisibleCopyLocale(useLocale());
  const visibleCopy = getVisibleCopy(locale);
  const completeCopy = visibleCopy.bookingExtra.complete;
  const checkoutCopy = getCheckoutCopy(locale);
  const router = useRouter();
  const params = useParams<{ performanceId: string }>();
  const searchParams = useSearchParams();

  const routePerformanceId = Array.isArray(params.performanceId)
    ? params.performanceId[0]
    : params.performanceId;
  const isPendingReturn = searchParams.get('pending') === 'true';
  const paymentKey = searchParams.get('paymentKey');
  const orderId = searchParams.get('orderId');
  const amount = searchParams.get('amount');
  const provider = searchParams.get('provider');
  const providerChargeAmount = searchParams.get('providerChargeAmount');
  const parsedAmount = Number(amount);
  const hasValidAmount = amount !== null && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const hasValidConfirmReturn = hasValidConfirmPaymentReturn({
    provider,
    amount,
    providerChargeAmount,
  });
  const hasPendingReturnParams = isPendingReturn && !!orderId;
  const hasConfirmParams = !!paymentKey
    && !!orderId
    && hasValidConfirmReturn;
  const asyncReturnProvider =
    provider === 'ALIPAY_PLUS' || provider === 'TRUEMONEY'
      ? provider
      : undefined;

  const clearBooking = useBookingStore((s) => s.clearBooking);

  const confirmMutation = useConfirmPayment();
  const asyncReturnMutation = useReconcileAsyncPaymentReturn();
  const [bookingData, setBookingData] = useState<ReservationDetail | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const hasConfirmedRef = useRef(false);
  const hasReconciledAsyncReturnRef = useRef(false);

  const [confirmFailed, setConfirmFailed] = useState(false);
  // Only a transient failure (retries exhausted) offers to send the confirm again.
  const [confirmRetryable, setConfirmRetryable] = useState(false);
  // A confirm error is reported only after lookup shows the order is not confirmed.
  const [unreportedConfirmError, setUnreportedConfirmError] = useState<string | null>(null);
  // A confirmed response is authoritative; a later lookup outage must not replace it.
  const shouldRecoverByOrderId = !!orderId && !bookingData && (confirmFailed || isPendingReturn);
  const paymentRecovery = useBookingPaymentRecovery(
    shouldRecoverByOrderId ? orderId : null,
    {
      enabled: shouldRecoverByOrderId,
      pendingReturn: isPendingReturn,
    },
  );
  const recoveredBooking = paymentRecovery.paymentStatus === 'confirmed'
    ? paymentRecovery.reservation
    : null;
  const effectiveBooking = bookingData ?? recoveredBooking;

  useEffect(() => {
    if (!recoveredBooking) {
      return;
    }

    setBookingData(recoveredBooking);
    clearBooking();
    setConfirmFailed(false);
    setConfirmRetryable(false);
    setUnreportedConfirmError(null);
  }, [clearBooking, recoveredBooking]);

  // Once confirmed, drop the one-time provider return so reload or history
  // navigation reads the order instead of sending confirm again.
  const replaceConfirmReturnWithLookup = useCallback((confirmedOrderId: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    for (const key of CONFIRM_PAYMENT_RETURN_PARAMS) {
      nextParams.delete(key);
    }
    nextParams.set('pending', 'true');
    nextParams.set('orderId', confirmedOrderId);
    router.replace(`${window.location.pathname}?${nextParams.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Confirm payment on mount — only needs URL params (server has pending order)
  const confirmPayment = useCallback(async (): Promise<boolean> => {
    if (
      hasConfirmedRef.current
      || isPendingReturn
      || !paymentKey
      || !orderId
      || !hasValidConfirmReturn
    ) {
      return false;
    }

    hasConfirmedRef.current = true;
    setIsConfirming(true);
    setConfirmRetryable(false);

    try {
      const result = await confirmMutation.mutateAsync(buildConfirmPaymentPayload({
        paymentKey,
        orderId,
        amount,
        provider,
        providerChargeAmount,
      }));

      if (result.status !== 'CONFIRMED') {
        setConfirmFailed(true);
        return false;
      }

      setBookingData(result);
      setConfirmFailed(false);
      setUnreportedConfirmError(null);
      clearBooking();
      replaceConfirmReturnWithLookup(orderId);
      return true;
    } catch (err) {
      setUnreportedConfirmError(
        err instanceof Error ? err.message : completeCopy.confirmFailedTitle,
      );
      setConfirmRetryable(isRetryableConfirmPaymentError(err));
      // Try recovery — maybe already confirmed on a previous attempt
      setConfirmFailed(true);
      return false;
    } finally {
      setIsConfirming(false);
    }
  }, [
    isPendingReturn,
    paymentKey,
    orderId,
    amount,
    provider,
    providerChargeAmount,
    hasValidConfirmReturn,
    confirmMutation,
    clearBooking,
    completeCopy,
    replaceConfirmReturnWithLookup,
  ]);

  const { refetch: refetchPaymentRecovery } = paymentRecovery;
  const retryConfirmPayment = useCallback(async () => {
    hasConfirmedRef.current = false;
    if (!(await confirmPayment())) {
      void refetchPaymentRecovery();
    }
  }, [confirmPayment, refetchPaymentRecovery]);
  const canRetryConfirm = hasConfirmParams && !isPendingReturn && confirmRetryable && !bookingData;

  // An already confirmed order (for example after a reload past its admission window)
  // must not be reported as a payment failure.
  const recoveryPaymentStatus = paymentRecovery.paymentStatus;
  useEffect(() => {
    if (!unreportedConfirmError) {
      return;
    }
    if (recoveryPaymentStatus === 'confirmed') {
      setUnreportedConfirmError(null);
      return;
    }
    if (
      recoveryPaymentStatus === 'failed'
      || recoveryPaymentStatus === 'expired'
      || recoveryPaymentStatus === 'unavailable'
    ) {
      toast.error(unreportedConfirmError);
      setUnreportedConfirmError(null);
    }
  }, [recoveryPaymentStatus, unreportedConfirmError]);

  useEffect(() => {
    if (hasConfirmParams && !isPendingReturn) {
      confirmPayment();
    }
  }, [confirmPayment, hasConfirmParams, isPendingReturn]);

  useEffect(() => {
    if (
      hasReconciledAsyncReturnRef.current
      || !isPendingReturn
      || !paymentKey
      || !orderId
      || !asyncReturnProvider
    ) {
      return;
    }

    hasReconciledAsyncReturnRef.current = true;
    void asyncReturnMutation.mutateAsync({
      paymentKey,
      orderId,
      provider: asyncReturnProvider,
      ...(hasValidAmount ? { amount: parsedAmount } : {}),
    }).then(() => {
      void paymentRecovery.refetch();
    }).catch((err) => {
      toast.error(err instanceof Error ? err.message : completeCopy.statusCheckFailed);
      setConfirmFailed(true);
    });
  }, [
    asyncReturnMutation,
    asyncReturnProvider,
    hasValidAmount,
    isPendingReturn,
    orderId,
    parsedAmount,
    paymentKey,
    paymentRecovery,
    completeCopy,
  ]);

  // Focus heading on success
  useEffect(() => {
    if (effectiveBooking) {
      const heading = document.getElementById('booking-complete-heading');
      heading?.focus();
    }
  }, [effectiveBooking]);

  // Handle missing params
  if (!hasConfirmParams && !hasPendingReturnParams) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-[720px] items-center justify-center px-6 py-12">
        <div className="text-center">
          <p className="text-gray-500">{completeCopy.invalidAccess}</p>
          <button
            onClick={() => router.push(getLocalizedPathname('/', locale))}
            className="mt-4 text-sm text-primary underline"
          >
            {visibleCopy.commonErrors.home}
          </button>
        </div>
      </div>
    );
  }

  if (paymentRecovery.paymentStatus === 'expired') {
    return (
      <RecoveryStateCard
        tone="red"
        title={t('expiredTitle')}
        body={t('expiredBody')}
        deadlineLabel={formatDeadline(paymentRecovery.paymentDeadlineAt, locale)
          ? completeCopy.deadlineExpired.replace(
              '{deadline}',
              formatDeadline(paymentRecovery.paymentDeadlineAt, locale) ?? '',
            )
          : null}
        primaryAction={routePerformanceId
          ? {
              label: t('reselectCta'),
              onClick: () => router.replace(getLocalizedPathname(`/booking/${routePerformanceId}`, locale)),
            }
          : undefined}
        secondaryAction={{
          label: completeCopy.checkReservations,
          onClick: () => router.replace(`${getLocalizedPathname('/mypage', locale)}?tab=reservations`),
        }}
      />
    );
  }

  if (paymentRecovery.paymentStatus === 'failed') {
    return (
      <RecoveryStateCard
        tone="red"
        title={paymentRecovery.reservation?.status === 'CANCELLED'
          ? visibleCopy.reservation.detail.cancelledNoticeTitle : completeCopy.confirmFailedTitle}
        body={paymentRecovery.reservation?.status === 'CANCELLED'
          ? visibleCopy.reservation.detail.qrCheckingSeatItems
          : locale === 'ko' ? paymentRecovery.reservation?.cancelReason || completeCopy.confirmFailedBody : completeCopy.confirmFailedBody}
        primaryAction={routePerformanceId
          ? {
              label: t('reselectCta'),
              onClick: () => router.replace(getLocalizedPathname(`/booking/${routePerformanceId}`, locale)),
            }
          : undefined}
        secondaryAction={{
          label: completeCopy.checkReservations,
          onClick: () => router.replace(`${getLocalizedPathname('/mypage', locale)}?tab=reservations`),
        }}
      />
    );
  }

  const retryConfirmAction = {
    label: completeCopy.retryConfirm,
    onClick: () => {
      void retryConfirmPayment();
    },
    icon: 'refresh' as const,
    disabled: isConfirming,
  };

  if (paymentRecovery.paymentStatus === 'pending') {
    return (
      <RecoveryStateCard
        tone="amber"
        title={checkoutCopy.checking}
        body={canRetryConfirm ? completeCopy.confirmRetryBody : checkoutCopy.checkingBody}
        supportAction={{ label: checkoutCopy.support, href: getLocalizedPathname('/support', locale) }}
        primaryAction={canRetryConfirm ? retryConfirmAction : {
          label: completeCopy.retryStatus,
          onClick: () => {
            void paymentRecovery.refetch();
          },
          icon: 'refresh',
        }}
        secondaryAction={{
          label: completeCopy.checkReservations,
          onClick: () => router.replace(`${getLocalizedPathname('/mypage', locale)}?tab=reservations`),
        }}
      />
    );
  }

  if (
    isConfirming
    || (confirmFailed && paymentRecovery.fetchStatus === 'fetching' && paymentRecovery.paymentStatus === 'idle')
    || (!effectiveBooking && !isPendingReturn && !confirmFailed)
  ) {
    return <CompleteSkeleton />;
  }

  if (paymentRecovery.paymentStatus === 'unavailable' || (confirmFailed && paymentRecovery.paymentStatus === 'idle')) {
    return (
      <RecoveryStateCard
        tone="red"
        title={checkoutCopy.unavailable}
        body={canRetryConfirm ? completeCopy.confirmRetryBody : completeCopy.confirmUnknownBody}
        supportAction={{ label: checkoutCopy.support, href: getLocalizedPathname('/support', locale) }}
        primaryAction={canRetryConfirm ? retryConfirmAction : {
          label: completeCopy.retryStatus,
          onClick: () => {
            void paymentRecovery.refetch();
          },
          icon: 'refresh',
        }}
        secondaryAction={{
          label: completeCopy.checkReservations,
          onClick: () => router.replace(`${getLocalizedPathname('/mypage', locale)}?tab=reservations`),
        }}
      />
    );
  }

  // Success state
  if (effectiveBooking) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-6 py-12">
        <BookingComplete booking={effectiveBooking} />
      </main>
    );
  }

  // Fallback - should not reach here normally
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-[720px] items-center justify-center px-6 py-12">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export default function CompletePage() {
  return (
    <AuthGuard>
      <CompletePageContent />
    </AuthGuard>
  );
}
