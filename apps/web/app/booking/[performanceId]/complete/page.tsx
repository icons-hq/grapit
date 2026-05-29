'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AuthGuard } from '@/components/auth/auth-guard';
import { BookingComplete } from '@/components/booking/booking-complete';
import {
  useBookingPaymentRecovery,
  useConfirmPayment,
  type BookingPaymentStatus,
} from '@/hooks/use-booking';
import { ApiClientError } from '@/lib/api-client';
import { buildConfirmPaymentPayload } from '@/lib/booking/payment-return';
import { useBookingStore } from '@/stores/use-booking-store';
import type { ReservationDetail } from '@grabit/shared';

const LOCK_FAILURE_MESSAGES = [
  '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
  '이미 다른 사용자가 선택한 좌석입니다.',
] as const;

function isLockFailureMessage(message: string): boolean {
  return LOCK_FAILURE_MESSAGES.some((candidate) => candidate === message);
}

function isExpiredFailureMessage(message: string): boolean {
  return message === LOCK_FAILURE_MESSAGES[0];
}

function formatDeadline(dateStr: string | null): string | null {
  if (!dateStr) {
    return null;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
  };
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
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-current px-4 py-2 text-sm font-medium"
                >
                  {primaryAction.icon === 'refresh' && <RefreshCw className="h-4 w-4" />}
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
          </div>
        </div>
      </section>
    </main>
  );
}

function CompletePageContent() {
  const t = useTranslations('booking.paymentRecovery');
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
  const hasValidProviderChargeAmount =
    provider === 'PAYPAL'
    && !!providerChargeAmount?.trim();
  const hasPendingReturnParams = isPendingReturn && !!orderId && hasValidAmount;
  const hasConfirmParams = !!paymentKey
    && !!orderId
    && (provider === 'PAYPAL' ? hasValidProviderChargeAmount : hasValidAmount);

  const clearBooking = useBookingStore((s) => s.clearBooking);

  const confirmMutation = useConfirmPayment();
  const [bookingData, setBookingData] = useState<ReservationDetail | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<{
    message: string;
    paymentStatus: Extract<BookingPaymentStatus, 'failed' | 'expired'>;
  } | null>(null);
  const hasConfirmedRef = useRef(false);

  const [confirmFailed, setConfirmFailed] = useState(false);
  const shouldRecoverByOrderId = !!orderId && (confirmFailed || isPendingReturn);
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
    setConfirmationError(null);
  }, [clearBooking, recoveredBooking]);

  // Confirm payment on mount — only needs URL params (server has pending order)
  const confirmPayment = useCallback(async () => {
    if (
      hasConfirmedRef.current
      || isPendingReturn
      || !paymentKey
      || !orderId
      || !(provider === 'PAYPAL' ? hasValidProviderChargeAmount : hasValidAmount)
    ) {
      return;
    }

    hasConfirmedRef.current = true;
    setIsConfirming(true);
    setConfirmationError(null);

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
        return;
      }

      setBookingData(result);
      clearBooking();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : '결제 확인에 실패했습니다.';
      if (
        err instanceof ApiClientError &&
        err.statusCode === 409 &&
        isLockFailureMessage(errorMessage)
      ) {
        setConfirmationError({
          message: errorMessage,
          paymentStatus: isExpiredFailureMessage(errorMessage) ? 'expired' : 'failed',
        });
        setConfirmFailed(false);
        return;
      }
      toast.error(errorMessage);
      // Try recovery — maybe already confirmed on a previous attempt
      setConfirmFailed(true);
    } finally {
      setIsConfirming(false);
    }
  }, [
    isPendingReturn,
    paymentKey,
    orderId,
    amount,
    hasValidAmount,
    provider,
    providerChargeAmount,
    hasValidProviderChargeAmount,
    confirmMutation,
    clearBooking,
  ]);

  useEffect(() => {
    if (hasConfirmParams && !isPendingReturn) {
      confirmPayment();
    }
  }, [confirmPayment, hasConfirmParams, isPendingReturn]);

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
          <p className="text-gray-500">잘못된 접근입니다.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 text-sm text-primary underline"
          >
            홈으로 이동
          </button>
        </div>
      </div>
    );
  }

  if (confirmationError?.paymentStatus === 'expired') {
    return (
      <RecoveryStateCard
        tone="red"
        title={t('expiredTitle')}
        body={confirmationError.message || t('expiredBody')}
        primaryAction={routePerformanceId
          ? {
              label: t('reselectCta'),
              onClick: () => router.replace(`/booking/${routePerformanceId}`),
            }
          : undefined}
        secondaryAction={{
          label: '예매 내역 확인',
          onClick: () => router.replace('/mypage?tab=reservations'),
        }}
      />
    );
  }

  if (confirmationError?.paymentStatus === 'failed') {
    return (
      <RecoveryStateCard
        tone="red"
        title="예매를 완료하지 못했습니다"
        body={confirmationError.message}
        primaryAction={routePerformanceId
          ? {
              label: t('reselectCta'),
              onClick: () => router.replace(`/booking/${routePerformanceId}`),
            }
          : undefined}
        secondaryAction={{
          label: '예매 내역 확인',
          onClick: () => router.replace('/mypage?tab=reservations'),
        }}
      />
    );
  }

  if (paymentRecovery.paymentStatus === 'expired') {
    return (
      <RecoveryStateCard
        tone="red"
        title={t('expiredTitle')}
        body={t('expiredBody')}
        deadlineLabel={formatDeadline(paymentRecovery.paymentDeadlineAt)
          ? `결제 가능 시각이 ${formatDeadline(paymentRecovery.paymentDeadlineAt)}에 만료되었습니다.`
          : null}
        primaryAction={routePerformanceId
          ? {
              label: t('reselectCta'),
              onClick: () => router.replace(`/booking/${routePerformanceId}`),
            }
          : undefined}
        secondaryAction={{
          label: '예매 내역 확인',
          onClick: () => router.replace('/mypage?tab=reservations'),
        }}
      />
    );
  }

  if (paymentRecovery.paymentStatus === 'failed') {
    return (
      <RecoveryStateCard
        tone="red"
        title="결제 확인에 실패했습니다"
        body={paymentRecovery.reservation?.cancelReason || '예매 내역을 확인하거나 다시 결제를 시도해주세요.'}
        primaryAction={routePerformanceId
          ? {
              label: t('reselectCta'),
              onClick: () => router.replace(`/booking/${routePerformanceId}`),
            }
          : undefined}
        secondaryAction={{
          label: '예매 내역 확인',
          onClick: () => router.replace('/mypage?tab=reservations'),
        }}
      />
    );
  }

  if (paymentRecovery.paymentStatus === 'pending') {
    return (
      <RecoveryStateCard
        tone="amber"
        title={t('pendingTitle')}
        body={t('pendingBody')}
        deadlineLabel={formatDeadline(paymentRecovery.paymentDeadlineAt)
          ? `현재 주문은 ${formatDeadline(paymentRecovery.paymentDeadlineAt)}까지 결제 상태를 기다립니다.`
          : null}
        primaryAction={{
          label: '상태 다시 확인',
          onClick: () => {
            void paymentRecovery.refetch();
          },
          icon: 'refresh',
        }}
        secondaryAction={{
          label: '예매 내역 확인',
          onClick: () => router.replace('/mypage?tab=reservations'),
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

  if (confirmFailed && paymentRecovery.paymentStatus === 'idle') {
    return (
      <RecoveryStateCard
        tone="red"
        title="결제 확인에 실패했습니다"
        body="결제 상태를 아직 확인하지 못했습니다. 잠시 후 다시 확인하거나 예매 내역을 확인해주세요."
        primaryAction={{
          label: '상태 다시 확인',
          onClick: () => {
            void paymentRecovery.refetch();
          },
          icon: 'refresh',
        }}
        secondaryAction={{
          label: '예매 내역 확인',
          onClick: () => router.replace('/mypage?tab=reservations'),
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
