'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ConfirmHeader } from '@/components/booking/confirm-header';
import { OrderSummary } from '@/components/booking/order-summary';
import { BookerInfoSection } from '@/components/booking/booker-info-section';
import { PaymentDeadlineBanner } from '@/components/booking/payment-deadline-banner';
import { TermsAgreement } from '@/components/booking/terms-agreement';
import {
  TossPaymentWidget,
  type PaymentMethodSelection,
  type TossPaymentWidgetRef,
} from '@/components/booking/toss-payment-widget';
import { Button } from '@/components/ui/button';
import {
  useBookingPaymentSnapshot,
  usePrepareReservation,
  useUnlockAllSeats,
  useCancelPendingReservation,
} from '@/hooks/use-booking';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';
import type { FloorAwareSeatSelection, SeatSelection } from '@grabit/shared';

function generateOrderId(): string {
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GRP-${Date.now()}-${random}`;
}

const LOCK_FAILURE_MESSAGES = [
  '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
  '이미 다른 사용자가 선택한 좌석입니다.',
] as const;
const OVERSEAS_DISCLAIMER_CHECKBOX_LABEL = '해외 결제 및 환불 유의사항에 동의합니다';

const BOOKING_CONSENT_VERSION = '2026-04-28';
const BOOKING_CONSENT_KEYS = [
  'terms',
  'privacy',
  'pipa_required',
] as const;

const LEGACY_FLOOR_KEY = 'default';
const LEGACY_FLOOR_LABEL = '기본';

function toFloorAwareSeatSelection(seat: SeatSelection): FloorAwareSeatSelection {
  return {
    ...seat,
    floorKey: LEGACY_FLOOR_KEY,
    floorLabel: LEGACY_FLOOR_LABEL,
    seatKey: `${LEGACY_FLOOR_KEY}:${seat.seatId}`,
  };
}

function isLockFailureMessage(message: string): boolean {
  return LOCK_FAILURE_MESSAGES.some((candidate) => candidate === message);
}

function ConfirmPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('booking');
  const locale = resolveVisibleCopyLocale(useLocale());
  const performanceId = params.performanceId as string;

  const { selectedSeats, performanceTitle, showDateTime, venue, posterUrl, selectedShowtimeId } =
    useBookingStore();
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
  const [widgetReady, setWidgetReady] = useState(false);
  const [lockFailureMessage, setLockFailureMessage] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodSelection | null>(null);
  const [bookerInfo, setBookerInfo] = useState<{ name: string; phone: string }>({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
  });

  const paymentWidgetRef = useRef<TossPaymentWidgetRef>(null);
  const reservationIdRef = useRef<string | null>(null);
  const { bookingAvailable, bookingDisabledMessage } = useBookingAvailability();
  const prepareMutation = usePrepareReservation();
  const unlockAll = useUnlockAllSeats();
  const cancelPending = useCancelPendingReservation();

  // Generate orderId once per mount
  const orderId = useMemo(() => generateOrderId(), []);

  const totalPrice = useMemo(
    () => selectedSeats.reduce((sum, s) => sum + s.price, 0),
    [selectedSeats],
  );

  const orderName = useMemo(() => {
    if (!performanceTitle) return '';
    const base = performanceTitle.length > 30 ? `${performanceTitle.slice(0, 30)}...` : performanceTitle;
    return selectedSeats.length > 1 ? `${base} 외 ${selectedSeats.length - 1}건` : base;
  }, [performanceTitle, selectedSeats.length]);

  // Redirect if no booking data
  useEffect(() => {
    if (selectedSeats.length === 0) {
      router.replace(`/booking/${performanceId}`);
    }
  }, [selectedSeats.length, performanceId, router]);

  // Handle error return from Toss. Guard with useRef so React StrictMode's
  // double-effect in dev mode does not fire two toasts for the same URL.
  const errorToastFiredRef = useRef(false);
  useEffect(() => {
    const hasError = searchParams.get('error');
    if (hasError !== 'true' || errorToastFiredRef.current) return;
    errorToastFiredRef.current = true;

    const code = searchParams.get('code');
    const message = searchParams.get('message');

    if (code === 'PAY_PROCESS_CANCELED') {
      toast.error('결제가 취소되었습니다.');
    } else if (message) {
      toast.error(message);
    } else {
      toast.error('결제에 실패했습니다. 다시 시도해주세요.');
    }

    // Clean up URL params
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('code');
    url.searchParams.delete('message');
    window.history.replaceState({}, '', url.pathname);
  }, [searchParams]);

  const handleExpire = useCallback(() => {
    const { selectedShowtimeId } = useBookingStore.getState();
    if (selectedShowtimeId) {
      unlockAll.mutate({ showtimeId: selectedShowtimeId });
    }
    if (reservationIdRef.current) {
      cancelPending.mutate(reservationIdRef.current);
    }
    toast.error('좌석 점유 시간이 만료되어 좌석 선택 화면으로 이동합니다.');
    router.replace(`/booking/${performanceId}`);
  }, [performanceId, router, unlockAll, cancelPending]);

  const handleWidgetReady = useCallback(() => {
    setWidgetReady(true);
  }, []);

  const handleAgreementChange = useCallback((value: boolean) => {
    setAgreed(value);
  }, []);

  const handlePaymentMethodChange = useCallback((selection: PaymentMethodSelection) => {
    setSelectedPaymentMethod(selection);
    setOverseasDisclaimerAgreed(false);
  }, []);

  const handleBookerUpdate = useCallback((data: { name: string; phone: string }) => {
    setBookerInfo(data);
  }, []);

  const handleLockFailureRecovery = useCallback(() => {
    useBookingStore.getState().clearSeats();
    router.replace(`/booking/${performanceId}`);
  }, [performanceId, router]);

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
        agreementVersion: consent?.agreementVersion ?? '2026-05-08',
        agreed: overseasDisclaimerAgreed,
        agreedAt: overseasDisclaimerAgreed ? new Date().toISOString() : null,
        fxRateDisclaimer: t('paymentDisclaimer.fxHelper'),
        refundDelayNotice: t('paymentDisclaimer.refundDelay'),
      },
    };
  }, [overseasDisclaimerAgreed, requiresOverseasDisclaimer, selectedPaymentMethod, t]);

  async function handlePayment() {
    if (!bookingAvailable) return;
    if (lockFailureMessage) return;
    if (isPaymentDeadlineExpired) return;
    if (!paymentWidgetRef.current || !agreed || isProcessing) return;
    if (requiresOverseasDisclaimer && !overseasDisclaimerAgreed) return;

    setIsProcessing(true);
    try {
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
      reservationIdRef.current = result.reservationId;

      // 2. Initiate Toss payment — SDK redirects the browser
      await paymentWidgetRef.current.requestPayment();
    } catch (err) {
      setIsProcessing(false);
      const errorMessage =
        err instanceof Error ? err.message : '결제 요청에 실패했습니다.';
      if (isLockFailureMessage(errorMessage)) {
        setLockFailureMessage(errorMessage);
        return;
      }
      toast.error(errorMessage);
    }
  }

  if (selectedSeats.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const ctaDisabled = !bookingAvailable
    || !!lockFailureMessage
    || !agreed
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
    ? '결제 처리 중...'
    : requiresOverseasDisclaimer && !overseasDisclaimerAgreed
    ? t('paymentDisclaimer.ctaPending')
    : !agreed
      ? '약관에 동의해주세요'
      : t('paymentDisclaimer.payNow');

  return (
    <div className="flex min-h-dvh flex-col">
      <ConfirmHeader onExpire={handleExpire} />

      <main className="mx-auto w-full max-w-[720px] flex-1 space-y-6 px-4 py-6 md:px-6 md:py-8">
        <PaymentDeadlineBanner
          paymentDeadlineAt={paymentDeadlineAt}
          lockExpiresAt={lockExpiresAt}
        />

        {/* Order Summary */}
        <OrderSummary
          performanceTitle={performanceTitle ?? ''}
          posterUrl={posterUrl}
          showDateTime={showDateTime ?? ''}
          venue={venue ?? ''}
          seats={selectedSeats}
          totalPrice={totalPrice}
        />

        {/* Booker Info */}
        <BookerInfoSection
          userName={bookerInfo.name}
          userPhone={bookerInfo.phone}
          onUpdate={handleBookerUpdate}
        />

        {/* Terms Agreement */}
        <TermsAgreement agreed={agreed} onAgreementChange={handleAgreementChange} />

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
        <section className="space-y-3">
          <h2 className="text-base font-semibold">결제 수단</h2>
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
              onReady={handleWidgetReady}
              onPaymentMethodChange={handlePaymentMethodChange}
            />
          )}
        </section>

        {requiresOverseasDisclaimer && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-900">
              {t('paymentDisclaimer.title')}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              {t('paymentDisclaimer.description')}
            </p>
            <div className="mt-3 space-y-2 text-sm text-amber-900">
              <p>{t('paymentDisclaimer.krwPrimary')}</p>
              <p>{t('paymentDisclaimer.fxHelper')}</p>
              <p>{t('paymentDisclaimer.refundDelay')}</p>
            </div>
            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                checked={overseasDisclaimerAgreed}
                onChange={(event) => setOverseasDisclaimerAgreed(event.target.checked)}
                aria-label={OVERSEAS_DISCLAIMER_CHECKBOX_LABEL}
                className="mt-0.5 size-4 rounded border border-amber-400 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-amber-950">
                {t('paymentDisclaimer.checkboxLabel')}
              </span>
            </label>
          </section>
        )}

        {/* Desktop CTA */}
        <div className="hidden pb-8 md:block">
          <Button
            className="h-12 w-full text-base"
            disabled={ctaDisabled}
            onClick={handlePayment}
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {ctaText}
          </Button>
        </div>
      </main>

      {/* Mobile Sticky CTA */}
      <div className="sticky bottom-0 border-t bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden">
        <Button
          className="h-12 w-full text-base"
          disabled={ctaDisabled}
          onClick={handlePayment}
        >
          {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {ctaText}
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
