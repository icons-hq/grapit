'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ConfirmHeader } from '@/components/booking/confirm-header';
import { OrderSummary, CheckoutAmountSummary } from '@/components/booking/order-summary';
import { BookerInfoSection } from '@/components/booking/booker-info-section';
import { PaymentDeadlineBanner } from '@/components/booking/payment-deadline-banner';
import { TermsAgreement } from '@/components/booking/terms-agreement';
import {
  TossPaymentWidget,
  type PaymentMethodSelection,
  type TossPaymentWidgetRef,
} from '@/components/booking/toss-payment-widget';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import {
  useBookingPaymentSnapshot,
  usePrepareReservation,
  useUnlockAllSeats,
  useCancelPendingReservation,
} from '@/hooks/use-booking';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useCheckoutRecovery } from '@/hooks/use-checkout-recovery';
import { getCheckoutCopy, getCheckoutMethodLabel } from '@/lib/booking/checkout-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getPaymentFailureGuidance,
  type PaymentFailureGuidance,
} from '@/lib/booking/payment-failure-guidance';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';
import { apiClient } from '@/lib/api-client';
import {
  TICKET_SERVICE_FEE_KRW,
  isSameCheckoutPaymentMethod,
  toFloorAwareSeatSelection as toSharedFloorAwareSeatSelection,
} from '@grabit/shared';
import type { FloorAwareSeatSelection, PrepareReservationResponse, SeatSelection } from '@grabit/shared';

function generateOrderId(): string {
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GRP-${Date.now()}-${random}`;
}

const LOCK_FAILURE_MESSAGES = [
  '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
  '이미 다른 사용자가 선택한 좌석입니다.',
] as const;

const BOOKING_CONSENT_VERSION = '2026-04-28';
const BOOKING_CONSENT_KEYS = [
  'terms',
  'privacy',
  'pipa_required',
] as const;

const LEGACY_FLOOR_KEY = 'default';
const LEGACY_FLOOR_LABEL = '기본';

function toFloorAwareSeatSelection(seat: SeatSelection): FloorAwareSeatSelection {
  return toSharedFloorAwareSeatSelection(seat, {
    defaultFloorKey: LEGACY_FLOOR_KEY,
    defaultFloorLabel: LEGACY_FLOOR_LABEL,
  });
}

function isLockFailureMessage(message: string): boolean {
  return LOCK_FAILURE_MESSAGES.some((candidate) => candidate === message);
}

function getLocalizedLockFailureMessage(
  message: string,
  copy: ReturnType<typeof getVisibleCopy>['bookingExtra']['confirm'],
) {
  if (message === LOCK_FAILURE_MESSAGES[0]) return copy.lockExpired;
  if (message === LOCK_FAILURE_MESSAGES[1]) return copy.seatTaken;
  return message;
}

function ConfirmPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('booking');
  const locale = resolveVisibleCopyLocale(useLocale());
  const visibleCopy = getVisibleCopy(locale);
  const confirmCopy = visibleCopy.bookingExtra.confirm;
  const checkoutCopy = getCheckoutCopy(locale);
  const paymentFailureGuidanceCopy = visibleCopy.booking.paymentFailureGuidance;
  const paymentProviderMessagePrefix = visibleCopy.booking.paymentRecovery.providerMessagePrefix;
  const performanceId = params.performanceId as string;

  const { selectedSeats, performanceTitle, showDateTime, venue, posterUrl, selectedShowtimeId } =
    useBookingStore();
  const applyPaymentDeadline = useBookingStore((s) => s.applyPaymentDeadline);
  const user = useAuthStore((s) => s.user);
  const {
    paymentDeadlineAt,
    lockExpiresAt,
    bookingPolicy,
    isPaymentDeadlineExpired,
  } = useBookingPaymentSnapshot();

  const [agreed, setAgreed] = useState(false);
  const [overseasDisclaimerAgreed, setOverseasDisclaimerAgreed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReselecting, setIsReselecting] = useState(false);
  const reselectingRef = useRef(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const [widgetAgreementAgreed, setWidgetAgreementAgreed] = useState(false);
  const [lockFailureMessage, setLockFailureMessage] = useState<string | null>(null);
  const [paymentReturnError, setPaymentReturnError] = useState<PaymentFailureGuidance | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodSelection | null>(null);
  const [preparedReview, setPreparedReview] = useState<PrepareReservationResponse | null>(null);
  const [bookerInfo, setBookerInfo] = useState<{ name: string; phone: string }>({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
  });

  const paymentWidgetRef = useRef<TossPaymentWidgetRef>(null);
  const reservationIdRef = useRef<string | null>(null);
  const paymentRequestInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { bookingAvailable, bookingDisabledMessage } = useBookingAvailability();
  const prepareMutation = usePrepareReservation();
  const unlockAll = useUnlockAllSeats();
  const cancelPending = useCancelPendingReservation();
  const cancelAbandonedPending = useCancelPendingReservation({ showErrorToast: false });

  const resumeOrderId = searchParams.get('resumeOrderId');
  const hasPaymentErrorReturn = searchParams.get('error') === 'true';
  const returnOrderId = resumeOrderId ?? (hasPaymentErrorReturn ? searchParams.get('orderId') : null);
  const isResumingPendingPayment = Boolean(returnOrderId);
  const [newOrderId, setOrderId] = useState(generateOrderId);
  const orderId = returnOrderId ?? newOrderId;
  const recovery = useCheckoutRecovery(returnOrderId, performanceId, isProcessing);
  const { refetch: refetchRecovery } = recovery;
  const bookingPath = getLocalizedPathname(`/booking/${performanceId}`, locale);
  const ticketsPath = `${getLocalizedPathname('/mypage', locale)}?tab=reservations`;

  useEffect(() => {
    if (recovery.reservation) reservationIdRef.current = recovery.reservation.id;
    if (
      !paymentRequestInFlightRef.current
      && (recovery.state === 'confirmed' || recovery.state === 'processing')
    ) {
      router.replace(`${bookingPath}/complete?pending=true&orderId=${encodeURIComponent(orderId)}`);
    }
  }, [bookingPath, orderId, recovery.reservation, recovery.state, router]);

  const totalPrice = useMemo(
    () => selectedSeats.reduce((sum, s) => sum + s.price, 0)
      + selectedSeats.length * TICKET_SERVICE_FEE_KRW,
    [selectedSeats],
  );

  const orderName = useMemo(() => {
    if (!performanceTitle) return '';
    const base = performanceTitle.length > 30 ? `${performanceTitle.slice(0, 30)}...` : performanceTitle;
    if (selectedSeats.length <= 1) return base;
    return locale === 'ko'
      ? `${base} 외 ${selectedSeats.length - 1}건`
      : `${base} + ${selectedSeats.length - 1} more`;
  }, [locale, performanceTitle, selectedSeats.length]);

  // Redirect if no booking data
  useEffect(() => {
    if (selectedSeats.length === 0 && !returnOrderId && !hasPaymentErrorReturn && !paymentReturnError) {
      router.replace(bookingPath);
    }
  }, [bookingPath, hasPaymentErrorReturn, paymentReturnError, returnOrderId, selectedSeats.length, router]);

  // Handle error return from Toss. Guard with useRef so React StrictMode's
  // double-effect in dev mode does not fire two toasts for the same URL.
  const errorToastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const hasError = searchParams.get('error');
    const code = searchParams.get('code');
    const message = searchParams.get('message');
    const failedOrderId = searchParams.get('orderId');
    const errorToastKey = `${code ?? ''}:${message ?? ''}:${failedOrderId ?? ''}`;
    if (hasError !== 'true' || errorToastKeyRef.current === errorToastKey) return;
    errorToastKeyRef.current = errorToastKey;
    const failureGuidance = getPaymentFailureGuidance({
      code,
      providerMessage: message,
      copy: paymentFailureGuidanceCopy,
      providerMessagePrefix: paymentProviderMessagePrefix,
    });

    paymentRequestInFlightRef.current = false;
    queueMicrotask(() => {
      setIsProcessing(false);
      setPaymentReturnError(failureGuidance);

    });

    toast.error(failureGuidance.title, {
      description: failureGuidance.body,
    });

    // Clean up URL params
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('code');
    url.searchParams.delete('message');
    url.searchParams.delete('paymentDeadlineAt');
    if (returnOrderId) url.searchParams.set('resumeOrderId', returnOrderId);
    url.searchParams.delete('orderId');
    // Next.js copies its internal history state for external calls. Passing it
    // back would bypass useSearchParams updates and let a render erase this URL.
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [
    returnOrderId,
    paymentFailureGuidanceCopy,
    paymentProviderMessagePrefix,
    searchParams,
  ]);

  const handlePaymentReturnRecovery = useCallback(async () => {
    if (reselectingRef.current) return;
    reselectingRef.current = true;
    setIsReselecting(true);
    try {
      if (reservationIdRef.current) await cancelPending.mutateAsync(reservationIdRef.current);
      const showtimeId = useBookingStore.getState().selectedShowtimeId;
      // A delayed unlock-all must never erase seats chosen on the next screen.
      if (showtimeId) await unlockAll.mutateAsync({ showtimeId });
      setPaymentReturnError(null);
      useBookingStore.getState().clearBooking();
      router.replace(bookingPath);
    } catch {
      if (returnOrderId) await refetchRecovery();
    } finally {
      reselectingRef.current = false;
      if (mountedRef.current) setIsReselecting(false);
    }
  }, [bookingPath, cancelPending, refetchRecovery, returnOrderId, router, unlockAll]);

  const handleExpire = useCallback(() => {
    toast.error(confirmCopy.lockExpiredRedirect);
    if (returnOrderId) void refetchRecovery();
  }, [confirmCopy, refetchRecovery, returnOrderId]);

  const handleWidgetReady = useCallback(() => {
    setWidgetReady(true);
  }, [setWidgetReady]);

  const handleAgreementChange = useCallback((value: boolean) => {
    setAgreed(value);
  }, [setAgreed]);

  const handlePaymentMethodChange = useCallback((selection: PaymentMethodSelection) => {
    setSelectedPaymentMethod(selection);
    setOverseasDisclaimerAgreed(false);
    setPreparedReview((current) => current?.paymentMethod
      && isSameCheckoutPaymentMethod(current.paymentMethod, selection.paymentMethod) ? current : null);
  }, [setSelectedPaymentMethod, setOverseasDisclaimerAgreed, setPreparedReview]);

  const handleWidgetAgreementChange = useCallback((value: boolean) => {
    setWidgetAgreementAgreed(value);
  }, [setWidgetAgreementAgreed]);

  const handlePaymentDeadlineChange = useCallback((nextPaymentDeadlineAt: string) => {
    applyPaymentDeadline(nextPaymentDeadlineAt);
  }, [applyPaymentDeadline]);

  const handleBookerUpdate = useCallback((data: { name: string; phone: string }) => {
    setBookerInfo(data);
  }, [setBookerInfo]);

  const handleLockFailureRecovery = handlePaymentReturnRecovery;

  const requiresOverseasDisclaimer = selectedPaymentMethod?.requiresOverseasDisclaimer ?? false;
  const paymentMethod = useMemo(() => {
    if (!selectedPaymentMethod) {
      return {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
      } as const;
    }

    if (!requiresOverseasDisclaimer) {
      return selectedPaymentMethod.paymentMethod;
    }

    const consent = selectedPaymentMethod.paymentMethod.overseasPaymentConsent;

    return {
      ...selectedPaymentMethod.paymentMethod,
      overseasPaymentConsent: {
        required: consent?.required ?? true,
        agreementVersion: consent?.agreementVersion ?? '2026-09-21',
        agreed: overseasDisclaimerAgreed,
        agreedAt: overseasDisclaimerAgreed ? new Date().toISOString() : null,
        fxRateDisclaimer: checkoutCopy.chargeNotice,
        refundDelayNotice: t('paymentDisclaimer.refundDelay'),
      },
    };
  }, [checkoutCopy.chargeNotice, overseasDisclaimerAgreed, requiresOverseasDisclaimer, selectedPaymentMethod, t]);

  const restoredMethod = recovery.reservation?.checkoutPaymentMethod;
  const methodMatchesRestoredOrder = !restoredMethod || !selectedPaymentMethod
    || isSameCheckoutPaymentMethod(restoredMethod, paymentMethod);
  const lockedMethodMismatch = Boolean(recovery.reservation?.checkoutStartedAt) && !methodMatchesRestoredOrder;
  const visibleQuote = preparedReview?.providerChargeQuote
    ?? (methodMatchesRestoredOrder ? recovery.reservation?.providerChargeQuote : undefined);

  async function handlePayment() {
    if (!bookingAvailable) return;
    if (lockFailureMessage) return;
    if (isPaymentDeadlineExpired) return;
    if (returnOrderId && recovery.state !== 'ready') return;
    if (lockedMethodMismatch) return;
    if (
      !paymentWidgetRef.current
      || !agreed
      || !widgetAgreementAgreed
      || isProcessing
      || paymentRequestInFlightRef.current
    ) return;
    if (requiresOverseasDisclaimer && !overseasDisclaimerAgreed) return;

    paymentRequestInFlightRef.current = true;
    errorToastKeyRef.current = null;
    setPaymentReturnError(null);
    setIsProcessing(true);
    let prepareSucceeded = false;
    const requestedBooking = useBookingStore.getState();
    const isCurrentBookingRequest = () => {
      const current = useBookingStore.getState();
      return mountedRef.current
        && current.performanceId === requestedBooking.performanceId
        && current.selectedShowtimeId === requestedBooking.selectedShowtimeId
        && JSON.stringify(current.selectedSeats) === JSON.stringify(requestedBooking.selectedSeats);
    };
    try {
      // Persist the identity before the request: the server may commit even if
      // this document disappears or the response never reaches the browser.
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set('resumeOrderId', orderId);
      window.history.replaceState(null, '', `${returnUrl.pathname}${returnUrl.search}`);

      // 1. Create pending reservation on server before payment
      const now = new Date();
      const result = await prepareMutation.mutateAsync({
        orderId,
        showtimeId: selectedShowtimeId ?? '',
        seats: selectedSeats.map(toFloorAwareSeatSelection),
        amount: totalPrice,
        consentItems: BOOKING_CONSENT_KEYS.map((key) => ({
          key,
          version: BOOKING_CONSENT_VERSION,
          language: locale,
          accepted: true,
          sourceFlow: 'booking' as const,
        })),
        queueAdmission: {
          queueSessionId: `legacy-${orderId}`,
          admissionToken: `legacy-${orderId}`,
          refreshFamilyId: user?.id ?? 'anonymous',
          deviceSlotKey: user?.id ?? 'anonymous',
          admittedAt: now.toISOString(),
          activeUntilAt: lockExpiresAt ?? now.toISOString(),
          reentryGraceUntilAt: lockExpiresAt ?? now.toISOString(),
        },
        paymentDeadlineAt: paymentDeadlineAt ?? now.toISOString(),
        bookingPolicy,
        paymentMethod,
      });
      prepareSucceeded = true;
      // A late prepare response belongs only to the selection that requested it.
      if (!isCurrentBookingRequest()) {
        if (!isResumingPendingPayment) {
          await cancelAbandonedPending.mutateAsync(result.reservationId).catch(() => {});
        }
        paymentRequestInFlightRef.current = false;
        if (mountedRef.current) {
          setIsProcessing(false);
          if (!isResumingPendingPayment) setOrderId(generateOrderId());
        }
        return;
      }
      reservationIdRef.current = result.reservationId;
      if (result.paymentDeadlineAt) {
        applyPaymentDeadline(result.paymentDeadlineAt);
      }

      if (
        result.providerChargeQuote
        && JSON.stringify(result.providerChargeQuote) !== JSON.stringify(visibleQuote)
      ) {
        setPreparedReview(result);
        paymentRequestInFlightRef.current = false;
        setIsProcessing(false);
        return;
      }

      // 2. Initiate Toss payment — SDK redirects the browser
      await paymentWidgetRef.current.requestPayment(result);
      paymentRequestInFlightRef.current = false;
      if (mountedRef.current) setIsProcessing(false);
      if (returnOrderId) await refetchRecovery();
    } catch (err) {
      paymentRequestInFlightRef.current = false;
      if (!isCurrentBookingRequest()) {
        if (mountedRef.current) setIsProcessing(false);
        return;
      }
      const errorMessage =
        err instanceof Error ? err.message : confirmCopy.paymentRequestFailed;
      let uncreatedOrder = false;
      if (!prepareSucceeded && !isResumingPendingPayment && err instanceof Error
        && 'statusCode' in err && [400, 403, 409, 422].includes(Number(err.statusCode))) {
        try {
          // A rejection alone may describe an existing order. Only a successful
          // owner lookup returning null proves this new attempt has no order.
          uncreatedOrder = await apiClient.get(
            `/api/v1/reservations?orderId=${encodeURIComponent(orderId)}&locale=${locale}`,
            { showErrorToast: false },
          ) === null;
        } catch { /* Lookup failure never authorizes another order. */ }
        if (!isCurrentBookingRequest()) {
          if (mountedRef.current) setIsProcessing(false);
          return;
        }
        if (uncreatedOrder) {
          const rejectedUrl = new URL(window.location.href);
          if (rejectedUrl.searchParams.get('resumeOrderId') === orderId) {
            rejectedUrl.searchParams.delete('resumeOrderId');
            window.history.replaceState(null, '', `${rejectedUrl.pathname}${rejectedUrl.search}`);
          }
        }
      }
      if (mountedRef.current) setIsProcessing(false);
      if (uncreatedOrder || isLockFailureMessage(errorMessage)) {
        setLockFailureMessage(locale === 'ko' ? getLocalizedLockFailureMessage(errorMessage, confirmCopy) : confirmCopy.paymentRequestFailed);
        return;
      }
      toast.error(errorMessage);
      if (returnOrderId) void refetchRecovery();
    }
  }

  const awaitingPreparedSnapshot = recovery.state === 'loading' && preparedReview?.orderId === returnOrderId;
  if (returnOrderId && !isProcessing && !awaitingPreparedSnapshot && recovery.state !== 'ready') {
    const ended = recovery.state === 'ended';
    const checking = recovery.state === 'loading' || recovery.state === 'confirmed' || recovery.state === 'processing';
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-5 px-6 py-12">
        <section role="status" className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">{checking ? checkoutCopy.checking : ended ? checkoutCopy.ended : checkoutCopy.unavailable}</h1>
          <p className="text-muted-foreground">{checking ? checkoutCopy.checkingBody : ended ? checkoutCopy.endedBody : checkoutCopy.unavailableBody}</p>
        </section>
        <Button onClick={() => void refetchRecovery()} disabled={recovery.isFetching}>{checkoutCopy.retry}</Button>
        {ended && <Button variant="outline" onClick={handlePaymentReturnRecovery} disabled={isReselecting}>{checkoutCopy.reselect}</Button>}
        <Button variant="ghost" onClick={() => router.replace(ticketsPath)}>{checkoutCopy.tickets}</Button>
        <Link className="text-center text-sm text-primary underline" href={getLocalizedPathname('/support', locale)}>{checkoutCopy.support}</Link>
      </main>
    );
  }

  if (selectedSeats.length === 0) {
    if (paymentReturnError) {
      return (
        <div className="flex min-h-dvh items-center justify-center px-4 py-10">
          <section
            role="alert"
            className="w-full max-w-[420px] rounded-lg border border-red-200 bg-red-50 p-5 text-center"
          >
            <h1 className="text-base font-semibold text-red-800">
              {paymentReturnError.title}
            </h1>
            <p className="mt-2 text-sm text-red-700">
              {paymentReturnError.body}
            </p>
            {paymentReturnError.providerMessage && (
              <p className="mt-3 text-xs text-red-700">
                {paymentReturnError.providerMessage}
              </p>
            )}
            <Button
              type="button"
              className="mt-5 w-full"
              onClick={handlePaymentReturnRecovery}
            >
              {t('paymentRecovery.reselectCta')}
            </Button>
          </section>
        </div>
      );
    }

    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const ctaDisabled = isReselecting || !bookingAvailable
    || lockedMethodMismatch
    || (Boolean(returnOrderId) && recovery.state !== 'ready')
    || !!lockFailureMessage
    || !agreed
    || !widgetAgreementAgreed
    || isProcessing
    || !widgetReady
    || isPaymentDeadlineExpired
    || (requiresOverseasDisclaimer && !overseasDisclaimerAgreed);
  const ctaText = !bookingAvailable
    ? bookingDisabledMessage
    : lockFailureMessage
    ? t('paymentRecovery.reselectPrompt')
    : isPaymentDeadlineExpired
    ? t('paymentRecovery.expiredCta')
    : isProcessing
    ? confirmCopy.processing
    : requiresOverseasDisclaimer && !overseasDisclaimerAgreed
    ? t('paymentDisclaimer.ctaPending')
    : !agreed
      ? confirmCopy.agreeTerms
      : !widgetAgreementAgreed
      ? confirmCopy.agreePaymentTerms
      : visibleQuote
      ? `${visibleQuote.currency} ${visibleQuote.amountDecimal} ${checkoutCopy.pay}`
      : requiresOverseasDisclaimer
      ? checkoutCopy.reviewCharge
      : t('paymentDisclaimer.payNow');

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ConfirmHeader onExpire={handleExpire} onBack={handlePaymentReturnRecovery} disabled={isProcessing || isReselecting} />
      <main className="mx-auto grid w-full max-w-7xl flex-1 items-start gap-8 px-4 py-8 md:px-8 md:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:gap-12">
        <div className="space-y-7 md:space-y-9">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{checkoutCopy.title}</h1>
          <OrderSummary performanceTitle={performanceTitle ?? ''} posterUrl={posterUrl}
            showDateTime={showDateTime ?? ''} venue={venue ?? ''} seats={selectedSeats} />
          <Separator />
          <BookerInfoSection userName={bookerInfo.name} userPhone={bookerInfo.phone}
            userEmail={user?.email} emailVerified={user?.isEmailVerified} onUpdate={handleBookerUpdate} />
          <Separator />
          <TermsAgreement performanceId={performanceId} onAgreementChange={handleAgreementChange} />
        </div>
        <Card className="gap-5 border-border bg-muted/20 shadow-none">
          <CardHeader className="gap-5 px-4 sm:px-6">
            <PaymentDeadlineBanner paymentDeadlineAt={paymentDeadlineAt} lockExpiresAt={lockExpiresAt} />
            <CheckoutAmountSummary seats={selectedSeats} totalPrice={totalPrice} quote={visibleQuote ?? undefined} />
          </CardHeader>
          <CardContent className="space-y-5 px-4 sm:px-6">
        {paymentReturnError && (
          <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">
              {paymentReturnError.title}
            </p>
            <p className="mt-1 text-sm text-red-700">
              {paymentReturnError.body}
            </p>
            {paymentReturnError.providerMessage && (
              <p className="mt-2 text-xs text-red-700">
                {paymentReturnError.providerMessage}
              </p>
            )}
          </section>
        )}

        {lockFailureMessage && (
          <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">{lockFailureMessage}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={handleLockFailureRecovery}
            >
              {t('paymentRecovery.reselectCta')}
            </Button>
          </section>
        )}

        {isPaymentDeadlineExpired && (
          <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-700">
              {t('paymentRecovery.expiredTitle')}
            </p>
            <p className="mt-1 text-sm text-red-700">
              {t('paymentRecovery.expiredBody')}
            </p>
          </section>
        )}

        {!bookingAvailable && (
          <section role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">
              {bookingDisabledMessage}
            </p>
          </section>
        )}

        {/* Payment Widget */}
        {restoredMethod && (
          <section role="status" className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm">{checkoutCopy.savedMethod}: <strong>{getCheckoutMethodLabel(restoredMethod, locale)}</strong></p>
            {lockedMethodMismatch && <p className="text-sm text-muted-foreground">{checkoutCopy.methodLocked}</p>}
          </section>
        )}
        <section className="space-y-3" inert={isProcessing}>
          <h2 className="text-base font-semibold">{confirmCopy.paymentMethod}</h2>
          {user && bookingAvailable && (
            <TossPaymentWidget
              ref={paymentWidgetRef}
              orderId={orderId}
              orderName={orderName}
              amount={totalPrice}
              performanceId={performanceId}
              customerKey={user.id}
              customerName={bookerInfo.name}
              customerEmail={user.email}
              customerMobilePhone={bookerInfo.phone}
              customerCountry={user.country}
              selectedSeats={selectedSeats.map(toFloorAwareSeatSelection)}
              initialPaymentMethod={recovery.reservation?.checkoutPaymentMethod ?? undefined}
              onReady={handleWidgetReady}
              onPaymentMethodChange={handlePaymentMethodChange}
              onWidgetAgreementChange={handleWidgetAgreementChange}
              onPaymentDeadlineChange={handlePaymentDeadlineChange}
            />
          )}
        </section>

        {requiresOverseasDisclaimer && (
          <section className="space-y-2 border-t border-border pt-5">
            <p className="text-sm font-semibold text-foreground">
              {t('paymentDisclaimer.title')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('paymentDisclaimer.description')}
            </p>
            <div className="mt-3 space-y-2 text-sm text-foreground">
              <p>{checkoutCopy.chargeNotice}</p>
              <p>{t('paymentDisclaimer.refundDelay')}</p>
            </div>
            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                checked={overseasDisclaimerAgreed}
                onChange={(event) => setOverseasDisclaimerAgreed(event.target.checked)}
                aria-label={confirmCopy.overseasDisclaimerAria}
                className="mt-0.5 size-4 rounded border border-input text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-foreground">
                {t('paymentDisclaimer.checkboxLabel')}
              </span>
            </label>
          </section>
        )}

          </CardContent>
          <CardFooter className="flex-col gap-5 px-4 sm:px-6">
            <Button className="hidden min-h-12 w-full whitespace-normal text-base lg:inline-flex" disabled={ctaDisabled} onClick={handlePayment}>
              {isProcessing && <Loader2 className="size-4 animate-spin" />}{ctaText}
            </Button>
            <p className="w-full border-t border-border pt-5 text-center text-sm text-muted-foreground">
              {checkoutCopy.help}{' '}<Link className="text-primary underline underline-offset-4" href={getLocalizedPathname('/support', locale)}>{checkoutCopy.support}</Link>
            </p>
          </CardFooter>
        </Card>
      </main>
      <div className="sticky bottom-0 z-30 space-y-2 border-t border-border bg-background/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <p className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{visibleQuote ? checkoutCopy.charge : checkoutCopy.orderTotal}</span><strong className="tabular-nums">{visibleQuote ? `${visibleQuote.currency} ${visibleQuote.amountDecimal}` : `KRW ${totalPrice.toLocaleString('en-US')}`}</strong></p>
        <Button className="min-h-12 w-full whitespace-normal text-base" disabled={ctaDisabled} onClick={handlePayment}>
          {isProcessing && <Loader2 className="size-4 animate-spin" />}{ctaText}
        </Button>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <AuthGuard>
      <ConfirmPageContent />
    </AuthGuard>
  );
}
