'use client';

import { getCheckoutState } from '@/lib/booking/checkout-state';
import { getCancellationCopy } from '@/lib/i18n/cancellation-copy';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CancelConfirmModal } from '@/components/reservation/cancel-confirm-modal';
import { getCheckoutCopy, getCheckoutMethodLabel } from '@/lib/booking/checkout-copy';
import { PaymentRecoveryPanel } from '@/components/booking/payment-recovery-panel';
import { ReservationAmountBreakdown } from '@/components/reservation/reservation-amount-breakdown';
import { formatPaymentMethodLabel } from '@/lib/booking/payment-method-label';
import { ProviderChargeAmount } from '@/components/booking/provider-charge-amount';
import { RefundTimeline } from '@/components/reservation/refund-timeline';
import { SeatHighlightLabel } from '@/components/reservation/seat-highlight-label';
import { TicketEmailDeliveryPanel } from '@/components/reservation/ticket-email-delivery-panel';
import { TicketBenefitCoupons } from '@/components/reservation/ticket-benefit-coupons';
import { AreunGlPerformancePromo } from '@/components/promo/areun-gl-promo';
import { useRefundPreview } from '@/hooks/use-reservations';
import {
  buildQrCheckInUrl,
  QrTicketImage,
} from '@/components/field/qr-ticket-image';
import { getDiagnosticPaymentFailureGuidance } from '@/lib/booking/payment-failure-guidance';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
  type VisibleCopy,
} from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { getServerNowMs } from '@/lib/server-clock';
import type {
  BenefitEntitlement,
  ReservationDetail as ReservationDetailType,
  ReservationStatus,
  TicketItem,
} from '@grabit/shared';

const STATUS_CONFIG: Record<
  ReservationStatus,
  { labelKey: keyof VisibleCopy['reservation']['status']; className: string }
> = {
  CONFIRMED: {
    labelKey: 'confirmed',
    className: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  },
  CANCELLED: {
    labelKey: 'cancelled',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
  PENDING_PAYMENT: {
    labelKey: 'pendingPayment',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  },
  FAILED: {
    labelKey: 'failed',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
};

function formatDateTime(
  dateString: string | null | undefined,
  fallback = '-',
  locale = 'ko',
): string {
  if (!dateString) {
    return fallback;
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(date) + ' KST';
}

function formatDeadline(
  dateString: string,
  locale: string,
  deadlineTemplate: string,
): string {
  const value = formatDateTime(dateString, '-', locale);
  return formatTemplate(deadlineTemplate, { value });
}

function formatTemplate(template: string, values: object) {
  const record = values as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(record[key] ?? ''),
  );
}

function formatPrice(amount: number, locale: string) {
  if (locale === 'ko') return `${amount.toLocaleString('ko-KR')}원`;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(amount);
}

type ReservationDetailCopy = VisibleCopy['reservation']['detail'];

function formatSeats(
  reservation: ReservationDetailType,
  seatTemplate: string,
): string {
  return reservation.seats
    .map((seat) => formatTemplate(seatTemplate, seat))
    .join(', ');
}

function formatTicketItemSeat(
  ticketItem: TicketItem,
  seatTemplate: string,
): string {
  return formatTemplate(seatTemplate, ticketItem);
}

function getQrStatusLabel(
  status: ReservationDetailType['qrTicket']['status'],
  copy: ReservationDetailCopy,
): string {
  switch (status) {
    case 'ACTIVE':
      return copy.qrStatus.active;
    case 'USED':
      return copy.qrStatus.used;
    case 'REVOKED':
      return copy.qrStatus.revoked;
    case 'EXPIRED':
      return copy.qrStatus.expired;
    default:
      return copy.qrStatus.checking;
  }
}

function getEntryStatusLabel(
  entryStatus: ReservationDetailType['qrTicket']['entryStatus'],
  copy: ReservationDetailCopy,
): string {
  return entryStatus === 'ENTERED' ? copy.entryValues.entered : copy.entryValues.notEntered;
}

function getTicketItemStatusLabel(
  status: TicketItem['status'],
  copy: ReservationDetailCopy,
): string {
  switch (status) {
    case 'ACTIVE':
      return copy.ticketStatus.active;
    case 'CANCELLATION_PENDING':
      return copy.ticketStatus.cancellationPending;
    case 'CANCELLED':
      return copy.ticketStatus.cancelled;
    case 'EXPIRED':
      return copy.ticketStatus.expired;
    default:
      return copy.ticketStatus.checking;
  }
}

function getAdmissionStateLabel(
  admissionState: TicketItem['admissionState'] | ReservationDetailType['qrTicket']['entryStatus'],
  copy: ReservationDetailCopy,
): string {
  return admissionState === 'ENTERED' ? copy.entryValues.entered : copy.entryValues.notEntered;
}

function getTicketItemQrBadgeLabel(
  status: TicketItem['status'],
  hasActiveQr: boolean,
  copy: ReservationDetailCopy,
): string {
  if (hasActiveQr) {
    return copy.qrStatus.active;
  }
  if (status === 'CANCELLATION_PENDING') {
    return copy.ticketStatus.cancellationPending;
  }
  if (status === 'CANCELLED') {
    return copy.ticketStatus.cancelled;
  }
  if (status === 'EXPIRED') {
    return copy.ticketStatus.expired;
  }

  return copy.qrStatus.checking;
}

function getTicketItemQrUnavailableCopy(
  status: TicketItem['status'],
  copy: ReservationDetailCopy,
) {
  if (status === 'CANCELLATION_PENDING') {
    return {
      title: copy.qrUnavailable.cancellationPendingTitle,
      description: copy.qrUnavailable.cancellationPendingDescription,
    };
  }
  if (status === 'CANCELLED') {
    return {
      title: copy.qrUnavailable.cancelledTitle,
      description: copy.qrUnavailable.cancelledDescription,
    };
  }
  if (status === 'EXPIRED') {
    return {
      title: copy.qrUnavailable.expiredTitle,
      description: copy.qrUnavailable.expiredDescription,
    };
  }

  return {
    title: copy.qrUnavailable.pendingTitle,
    description: copy.qrUnavailable.pendingDescription,
  };
}

type BuyerQrCard = {
  id: string;
  isTicketItem: boolean;
  seatLabel: string;
  tierColor?: string;
  floorLabel: string;
  qrCheckInUrl: string | null;
  qrToken: string | null;
  qrBadgeLabel: string;
  qrUnavailableTitle: string;
  qrUnavailableDescription: string;
  ticketStatusLabel: string;
  admissionStatusLabel: string;
  admissionState: 'NOT_ENTERED' | 'ENTERED';
  enteredAt: string | null;
  status: TicketItem['status'];
  price: number;
  serviceFee: number;
  benefitEntitlements: BenefitEntitlement[];
  cancellation?: TicketItem['cancellation'];
};

function getBuyerQrCards(
  reservation: ReservationDetailType,
  copy: ReservationDetailCopy,
): BuyerQrCard[] {
  const ticketItems = Array.isArray(reservation.ticketItems) ? reservation.ticketItems : [];
  if (ticketItems.length > 0) {
    return ticketItems.map((ticketItem) => {
      const credential = ticketItem.qrCredential;
      const qrCheckInUrl = credential?.status === 'ACTIVE' && credential.token
        ? buildQrCheckInUrl(credential.token)
        : null;
      const unavailableCopy = getTicketItemQrUnavailableCopy(ticketItem.status, copy);

      return {
        id: ticketItem.id,
        isTicketItem: ticketItem.isLegacyFallback !== true,
        seatLabel: formatTicketItemSeat(ticketItem, copy.seatLabel),
        tierColor: ticketItem.tierColor,
        floorLabel: ticketItem.floorLabel,
        qrCheckInUrl,
        qrToken: credential?.status === 'ACTIVE' ? credential.token : null,
        qrBadgeLabel: getTicketItemQrBadgeLabel(ticketItem.status, Boolean(qrCheckInUrl), copy),
        qrUnavailableTitle: unavailableCopy.title,
        qrUnavailableDescription: unavailableCopy.description,
        ticketStatusLabel: getTicketItemStatusLabel(ticketItem.status, copy),
        admissionStatusLabel: getAdmissionStateLabel(ticketItem.admissionState, copy),
        admissionState: ticketItem.admissionState,
        enteredAt: ticketItem.enteredAt,
        status: ticketItem.status,
        price: ticketItem.price,
        serviceFee: ticketItem.serviceFee,
        cancellation: ticketItem.cancellation,
        benefitEntitlements: Array.isArray(ticketItem.benefitEntitlements)
          ? ticketItem.benefitEntitlements
          : [],
      };
    });
  }

  const isQrActive = reservation.qrTicket?.status === 'ACTIVE' && reservation.qrTicket.token;
  const admissionState = reservation.qrTicket.entryStatus === 'ENTERED'
    ? 'ENTERED'
    : 'NOT_ENTERED';

  return [
    {
      id: 'legacy-qr-ticket',
      isTicketItem: false,
      seatLabel: formatSeats(reservation, copy.seatLabel),
      tierColor: reservation.seats.length === 1 ? reservation.seats[0]?.tierColor : undefined,
      floorLabel: '',
      qrCheckInUrl: isQrActive ? buildQrCheckInUrl(reservation.qrTicket.token) : null,
      qrToken: null,
      qrBadgeLabel: isQrActive ? copy.qrStatus.active : copy.qrStatus.checking,
      qrUnavailableTitle: copy.qrUnavailable.pendingTitle,
      qrUnavailableDescription: copy.qrUnavailable.pendingDescription,
      ticketStatusLabel: getQrStatusLabel(reservation.qrTicket.status, copy),
      admissionStatusLabel: getEntryStatusLabel(reservation.qrTicket.entryStatus, copy),
      admissionState,
      enteredAt: reservation.qrTicket.enteredAt ?? null,
      status: reservation.qrTicket.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE',
      price: reservation.totalAmount,
      serviceFee: 0,
      benefitEntitlements: [],
    },
  ];
}

function TicketCancellationSummary({ cancellation, locale }: { cancellation: NonNullable<TicketItem['cancellation']>; locale: string }) {
  const copy = getVisibleCopy(locale).reservation;
  const cancellationCopy = getCancellationCopy(locale);
  const step = { REQUESTED: 'requested', SENT_TO_PG: 'sentToPg', PROCESSING_AT_PG: 'processingAtPg',
    COMPLETED: 'completed', FAILED: 'failed' } as const;
  return <div className="mt-4 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
    <p className="font-semibold">{copy.refund.steps[step[cancellation.refundStatus]].label}</p>
    <InfoRow label={copy.cancel.refundAmount} value={formatPrice(cancellation.refundableAmount, locale)} />
    <InfoRow label={copy.cancel.cancellationFee} value={formatPrice(cancellation.cancellationFee, locale)} />
    {cancellation.providerRefund && <InfoRow label={cancellationCopy.providerRefund}
      value={`${cancellation.providerRefund.currency} ${cancellation.providerRefund.amountDecimal}`} />}
    <p className="text-gray-600">{cancellation.reopenState === 'NOT_REQUIRED' ? cancellationCopy.resalePending
      : cancellation.reopenState === 'HELD_CANCELLED' ? cancellationCopy.held : cancellationCopy.released}
      {cancellation.reopenAt ? ` · ${formatDateTime(cancellation.reopenAt, '-', locale)}` : ''}</p>
    <p className="text-gray-600">{copy.cancel.refundTimingNotice}</p>
  </div>;
}

function hasPersistedTicketItems(reservation: ReservationDetailType): boolean {
  const ticketItems = Array.isArray(reservation.ticketItems) ? reservation.ticketItems : [];
  return ticketItems.some((ticketItem) => ticketItem.isLegacyFallback !== true);
}

const SEOUL_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const MS_PER_DAY = 24 * 60 * 60 * 1000;
type PaymentStatus = NonNullable<ReservationDetailType['paymentInfo']>['status'];
type ProgressGuidance = {
  kind:
    | 'payment-pending'
    | 'payment-processing'
    | 'payment-failed'
    | 'cancel-processing'
    | 'cancel-completed';
  title: string;
  badgeLabel: string;
  cardClassName: string;
  badgeClassName: string;
  currentStep: string;
  nextStep: string;
  customerAction: string;
  estimate: string;
};

function getSeoulDayOrdinal(date: Date): number {
  const parts = SEOUL_DAY_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function isBeforeShowDateInSeoul(showDateTime: string): boolean {
  const showtime = new Date(showDateTime);
  if (Number.isNaN(showtime.getTime())) {
    return false;
  }

  return getSeoulDayOrdinal(showtime) - getSeoulDayOrdinal(new Date()) > 0;
}

function getPaymentMethodLabel(
  reservation: ReservationDetailType,
  copy: ReservationDetailCopy,
): string {
  return formatPaymentMethodLabel(
    reservation.paymentInfo?.paymentMethod?.method ??
      reservation.paymentInfo?.method ??
      reservation.paymentMethod,
    copy.paymentMethods,
  );
}

function hasCancellationInProgress(reservation: ReservationDetailType): boolean {
  return Boolean(reservation.refundTimeline && reservation.refundTimeline.currentState !== 'COMPLETED') ||
    reservation.ticketItems.some((ticketItem) => ticketItem.status === 'CANCELLATION_PENDING');
}

function getProgressGuidance(
  reservation: ReservationDetailType,
  paymentDeadlineAt: string | null | undefined,
  nowMs: number,
  copy: ReservationDetailCopy,
  locale: string,
): ProgressGuidance | null {
  const progress = copy.progress;

  if (reservation.status === 'CANCELLED') {
    if (!reservation.refundTimeline && !reservation.paidAt && !reservation.paymentInfo?.paidAt) return null;
    if (hasCancellationInProgress(reservation)) {
      return {
        kind: 'cancel-processing',
        title: progress.cancelTitle,
        badgeLabel: progress.processingBadge,
        cardClassName: 'border-[#E9DFFF] bg-[#FAF7FF]',
        badgeClassName: 'bg-[#F3EFFF] text-[#6C3CE0] border-transparent',
        currentStep: progress.cancelProcessingStep,
        nextStep: progress.refundSequential,
        customerAction: progress.waitForProgress,
        estimate: reservation.refundTimeline?.expectedDepositAt
          ? formatTemplate(progress.expectedDeposit, {
              date: formatDateTime(reservation.refundTimeline?.expectedDepositAt, undefined, locale),
            })
          : progress.refundBusinessDays,
      };
    }

    return {
      kind: 'cancel-completed',
      title: progress.cancelTitle,
      badgeLabel: progress.completedBadge,
      cardClassName: 'border-[#BBF7D0] bg-[#F0FDF4]',
      badgeClassName: 'bg-white text-[#15803D] border-transparent',
      currentStep: progress.cancelCompletedStep,
      nextStep: progress.refundCompleted,
      customerAction: progress.checkCancelledDetail,
      estimate: progress.completed,
    };
  }

  if (reservation.ticketItems.some((ticketItem) => ticketItem.status === 'CANCELLATION_PENDING')) {
    return {
      kind: 'cancel-processing',
      title: progress.cancelTitle,
      badgeLabel: progress.processingBadge,
      cardClassName: 'border-[#E9DFFF] bg-[#FAF7FF]',
      badgeClassName: 'bg-[#F3EFFF] text-[#6C3CE0] border-transparent',
      currentStep: progress.cancelProcessingStep,
      nextStep: progress.refundSequential,
      customerAction: progress.waitForProgress,
      estimate: reservation.refundTimeline?.expectedDepositAt
        ? formatTemplate(progress.expectedDeposit, {
            date: formatDateTime(reservation.refundTimeline?.expectedDepositAt, undefined, locale),
          })
        : progress.refundBusinessDays,
    };
  }

  const checkoutState = getCheckoutState(reservation, nowMs);
  if (reservation.status === 'PENDING_PAYMENT' && (checkoutState === 'processing' || checkoutState === 'unavailable')) {
    return {
      kind: 'payment-processing',
      title: progress.paymentTitle,
      badgeLabel: progress.checkingBadge,
      cardClassName: 'border-[#E9DFFF] bg-[#FAF7FF]',
      badgeClassName: 'bg-[#F3EFFF] text-[#6C3CE0] border-transparent',
      currentStep: progress.paymentCheckingStep,
      nextStep: progress.paymentAutoConfirm,
      customerAction: progress.doNotRetryPayment,
      estimate: progress.withinMinutes,
    };
  }

  const isPendingPaymentFailure =
    reservation.status === 'PENDING_PAYMENT' &&
    (checkoutState === 'expired' || checkoutState === 'failed');
  if (reservation.status === 'FAILED' || isPendingPaymentFailure) {
    return {
      kind: 'payment-failed',
      title: progress.paymentTitle,
      badgeLabel: progress.retryBadge,
      cardClassName: 'border-[#F6C7C7] bg-[#FEF2F2]',
      badgeClassName: 'bg-white text-[#C62828] border-transparent',
      currentStep: progress.paymentFailedStep,
      nextStep: progress.startNewPayment,
      customerAction: progress.closeOldPayment,
      estimate: progress.newPaymentGuide,
    };
  }

  if (reservation.status === 'PENDING_PAYMENT') {
    return {
      kind: 'payment-pending',
      title: progress.paymentTitle,
      badgeLabel: progress.pendingBadge,
      cardClassName: 'border-[#F3E6A6] bg-[#FFFBEB]',
      badgeClassName: 'bg-white text-[#8B6306] border-transparent',
      currentStep: progress.paymentPendingStep,
      nextStep: progress.paymentThenQr,
      customerAction: progress.finishPaymentAction,
      estimate: formatTemplate(progress.paymentDeadline, {
        date: formatDateTime(paymentDeadlineAt, progress.beforePaymentDeadline, locale),
      }),
    };
  }

  return null;
}

function InfoRow({
  label,
  value,
  valueClassName = 'text-sm font-semibold text-gray-900',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="w-24 max-w-[40%] shrink-0 text-sm text-gray-600">{label}</span>
      <span className={`min-w-0 flex-1 break-words text-right ${valueClassName}`}>
        {value}
      </span>
    </div>
  );
}

interface ReservationDetailProps {
  reservation: ReservationDetailType;
  onCancel: (reason: string, ticketItemId?: string, expected?: import('@grabit/shared').CancellationExpectation) => Promise<void> | void;
  isCancelling: boolean;
  onResumePayment?: (reservation: ReservationDetailType) => void;
  onCheckPayment?: () => void | Promise<unknown>;
  isCheckingPayment?: boolean;
  paymentCheckedAt?: number;
  providerUnavailable?: boolean;
  onReselectSeats?: () => void;
  onChangePaymentMethod?: () => void | Promise<unknown>;
  isChangingPaymentMethod?: boolean;
  paymentChangeError?: string | null;
}

export function ReservationDetailView({
  reservation,
  onCancel,
  isCancelling,
  onResumePayment,
  onCheckPayment, isCheckingPayment, paymentCheckedAt, providerUnavailable, onReselectSeats,
  onChangePaymentMethod, isChangingPaymentMethod, paymentChangeError,
}: ReservationDetailProps) {
  const router = useRouter();
  const locale = getClientLocale();
  const benefitLocale = resolveVisibleCopyLocale(locale);
  const visibleCopy = getVisibleCopy(locale);
  const copy = visibleCopy.reservation;
  const detailCopy = copy.detail;
  const completeCopy = visibleCopy.bookingExtra.completeCard;
  const cancellationCopy = getCancellationCopy(locale);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelTicketItemId, setCancelTicketItemId] = useState<string | null>(null);
  const statusConfig = STATUS_CONFIG[reservation.status];
  const statusLabel = copy.status[statusConfig.labelKey];
  const savedPaymentMethod = reservation.paymentInfo?.paymentMethod ?? reservation.checkoutPaymentMethod;
  const paymentMethodLabel = savedPaymentMethod
    ? getCheckoutMethodLabel(savedPaymentMethod, locale)
    : getPaymentMethodLabel(reservation, detailCopy);
  const refundPaymentMethodLabel =
    paymentMethodLabel === detailCopy.paymentMethods.unselected
      ? detailCopy.paymentMethods.fallback
      : paymentMethodLabel;
  const paymentPaidAt = reservation.paymentInfo?.paidAt ?? reservation.paidAt;
  const hasCompletedPayment = reservation.status === 'CONFIRMED'
    || ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(reservation.paymentInfo?.status ?? '');
  const missingPaymentTimeLabel = hasCompletedPayment
    ? detailCopy.paymentTimeUnavailable
    : detailCopy.beforePayment;
  const paymentDeadlineAt =
    reservation.paymentInfo?.paymentDeadlineAt ?? reservation.paymentDeadlineAt;

  // Server-issued deadlines are compared on the server-corrected clock.
  const nowMs = getServerNowMs();
  const isDeadlinePassed = Date.parse(reservation.cancelDeadline) < nowMs;
  const canCancel = reservation.status === 'CONFIRMED' && !isDeadlinePassed;
  const canCancelSeat = canCancel && !hasCancellationInProgress(reservation);
  const refundPreviewQuery = useRefundPreview(
    reservation.id,
    canCancel && cancelModalOpen && !isCancelling &&
      (!cancelTicketItemId || reservation.ticketItems.some((item) => item.id === cancelTicketItemId && item.status === 'ACTIVE')),
    cancelTicketItemId,
  );
  const hasSeatLevelTicketItems = hasPersistedTicketItems(reservation);
  const ticketItemRefundTotal = hasSeatLevelTicketItems
    ? reservation.ticketItems.filter((item) => item.status === 'CANCELLED').reduce(
        (total, ticketItem) => total + (ticketItem.cancellation?.refundableAmount ?? 0),
        0,
      )
    : 0;
  let displayedRefundAmount: number | null;
  const hasCompletedCancellation = reservation.ticketItems.some((item) => item.status === 'CANCELLED' && item.cancellation);
  if (hasCompletedCancellation) {
    displayedRefundAmount = ticketItemRefundTotal;
  } else if (reservation.ticketItems.some((item) => item.status === 'CANCELLATION_PENDING')) {
    displayedRefundAmount = reservation.ticketItems.filter((item) => item.status === 'CANCELLATION_PENDING')
      .reduce((sum, item) => sum + (item.cancellation?.refundableAmount ?? 0), 0);
  } else if (reservation.status === 'CONFIRMED') {
    displayedRefundAmount =
      refundPreviewQuery.data?.cancellationQuote?.refundableAmount ?? null;
  } else if (hasSeatLevelTicketItems && ticketItemRefundTotal > 0) {
    displayedRefundAmount = ticketItemRefundTotal;
  } else {
    displayedRefundAmount = reservation.totalAmount;
  }
  const showRefundQuoteIntentCopy =
    reservation.status === 'CONFIRMED' && !hasCompletedCancellation && !cancelModalOpen;
  const displayedRefundValue =
    displayedRefundAmount !== null
      ? formatPrice(displayedRefundAmount, locale)
      : showRefundQuoteIntentCopy
        ? copy.cancel.quoteAvailableInModal
        : refundPreviewQuery.isLoading
          ? copy.cancel.quoteLoading
          : refundPreviewQuery.isError
            ? copy.cancel.quoteError
            : copy.cancel.quoteUnavailable;
  const displayedRefundValueClassName =
    displayedRefundAmount !== null
      ? undefined
      : 'text-sm font-medium text-gray-600';
  const cancelModalRefundAmount =
    refundPreviewQuery.data?.cancellationQuote?.refundableAmount ?? 0;
  const showCancelButton = reservation.status === 'CONFIRMED' && !hasCancellationInProgress(reservation);
  const progressGuidance = getProgressGuidance(
    reservation,
    paymentDeadlineAt,
    nowMs,
    detailCopy,
    locale,
  );
  const paymentFailureGuidance = progressGuidance?.kind === 'payment-failed'
    ? getDiagnosticPaymentFailureGuidance({
        diagnostic: reservation.paymentFailureDiagnostic,
        copy: visibleCopy.booking.paymentFailureGuidance,
        providerMessagePrefix: visibleCopy.booking.paymentRecovery.providerMessagePrefix,
      })
    : null;
  const showPaymentRecovery = progressGuidance?.kind === 'payment-processing';
  const canResumePayment =
    progressGuidance?.kind === 'payment-pending' &&
    Boolean(onResumePayment);
  const showRefundPreview =
    reservation.status === 'CONFIRMED' ||
    Boolean(reservation.refundTimeline);
  const showRefundTimeline = Boolean(reservation.refundTimeline);
  const hasExpectedDepositAt =
    Boolean(reservation.refundTimeline?.expectedDepositAt) && showRefundTimeline;
  const qrCards = getBuyerQrCards(reservation, detailCopy);
  const hasActiveQr = qrCards.some((card) => card.qrCheckInUrl);
  const shouldShowQrTicket =
    reservation.status !== 'PENDING_PAYMENT' &&
    (reservation.status === 'CONFIRMED' || hasSeatLevelTicketItems);
  const qrSectionDescription = hasActiveQr
    ? completeCopy.qrReady
    : hasSeatLevelTicketItems
      ? detailCopy.qrCheckingSeatItems
      : completeCopy.qrChecking;
  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          aria-label={copy.detail.back}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">{copy.detail.reservationNumber}</h1>
      </div>

      {/* Reservation number + status */}
      <Card className="py-4">
        <CardContent className="flex items-center justify-between">
          <span className="font-mono text-xl font-semibold tracking-wide" style={{ fontFamily: 'ui-monospace, monospace' }}>
            {reservation.reservationNumber}
          </span>
          <Badge className={statusConfig.className}>{statusLabel}</Badge>
        </CardContent>
      </Card>

      {/* Performance info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            {copy.detail.performanceInfo}
          </h2>
          <InfoRow label={completeCopy.performanceName} value={reservation.performanceTitle} />
          <Separator />
          <InfoRow
            label={completeCopy.performanceDate}
            value={formatDateTime(reservation.showDateTime, undefined, locale)}
          />
          <Separator />
          <InfoRow label={completeCopy.venue} value={reservation.venue} />
        </CardContent>
      </Card>

      {/* Seat info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            {copy.detail.seatInfo}
          </h2>
          {reservation.seats.map((seat, idx) => (
            <div key={seat.seatId}>
              {idx > 0 && <Separator />}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-600">
                  {formatTemplate(copy.detail.seatLabel, seat)}
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatPrice(seat.price, locale)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            {copy.detail.paymentInfo}
          </h2>
          <ReservationAmountBreakdown reservation={reservation} locale={locale} />
          <Separator />
          <ProviderChargeAmount quote={reservation.paymentInfo?.providerChargeQuote ?? reservation.providerChargeQuote} locale={locale} paid={hasCompletedPayment} />
          <InfoRow label={copy.detail.paymentMethod} value={paymentMethodLabel} />
          <Separator />
          <InfoRow
            label={completeCopy.paidAt}
            value={formatDateTime(paymentPaidAt, missingPaymentTimeLabel, locale)}
          />
        </CardContent>
      </Card>

      {showPaymentRecovery && <div className="mt-4"><PaymentRecoveryPanel reservation={reservation} locale={locale}
        onCheck={onCheckPayment} checking={isCheckingPayment} checkedAt={paymentCheckedAt}
        providerUnavailable={providerUnavailable} onReselect={onReselectSeats}
        onChangeMethod={onChangePaymentMethod} changingMethod={isChangingPaymentMethod} changeError={paymentChangeError} /></div>}

      {progressGuidance && !showPaymentRecovery && (
        <Card className={`mt-4 ${progressGuidance.cardClassName} py-4`}>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                {progressGuidance.title}
              </h2>
              <Badge className={progressGuidance.badgeClassName}>
                {progressGuidance.badgeLabel}
              </Badge>
            </div>
            <div className="rounded-xl border border-white/80 bg-white/90 p-4">
              <InfoRow label={detailCopy.progressCurrentStep} value={progressGuidance.currentStep} />
              <Separator />
              <InfoRow label={detailCopy.progressNextStep} value={progressGuidance.nextStep} />
              <Separator />
              <InfoRow label={detailCopy.progressCustomerAction} value={progressGuidance.customerAction} />
              <Separator />
              <InfoRow label={detailCopy.progressEstimate} value={progressGuidance.estimate} />
            </div>
            {reservation.cancellationRecovery && (
              <Button variant="outline" disabled={isCancelling} onClick={() => {
                const recovery = reservation.cancellationRecovery!;
                void Promise.resolve(onCancel(cancellationCopy.checkCancellation,
                  recovery.kind === 'ticket' ? recovery.ticketItemId : undefined)).catch(() => undefined);
              }}>{cancellationCopy.checkCancellation}</Button>
            )}
            {paymentFailureGuidance && (
              <div className="rounded-xl border border-white/80 bg-white/90 p-4">
                <p className="text-sm font-semibold text-gray-900">
                  {paymentFailureGuidance.label}
                </p>
                <p className="mt-2 text-sm font-medium text-gray-900">
                  {paymentFailureGuidance.title}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  {paymentFailureGuidance.body}
                </p>
                {paymentFailureGuidance.providerMessage && (
                  <p className="mt-2 text-xs text-gray-600">
                    {paymentFailureGuidance.providerMessage}
                  </p>
                )}
              </div>
            )}
            {progressGuidance.kind === 'payment-failed' && onReselectSeats && <Button onClick={onReselectSeats}>{getCheckoutCopy(locale).reselect}</Button>}
            {canResumePayment && (
              <Button
                type="button"
                className="h-12 w-full"
                onClick={() => onResumePayment?.(reservation)}
              >
                {detailCopy.continuePayment}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {shouldShowQrTicket && (
        <Card className="mt-4 border-[#E9DFFF] bg-[#F8F5FF] py-4">
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-[#6C3CE0]" />
                  <h2 className="text-base font-semibold text-gray-900">{copy.detail.qrTicket}</h2>
                </div>
                <p className="text-sm text-gray-700">
                  {qrSectionDescription}
                </p>
              </div>
              <Badge
                className={
                  hasActiveQr
                    ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
                    : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
                }
              >
                {hasActiveQr ? completeCopy.qrActive : reservation.status === 'CANCELLED' ? detailCopy.ticketStatus.cancelled : completeCopy.qrPending}
              </Badge>
            </div>

            <div className="space-y-3">
              {qrCards.map((card) => (
                <div
                  key={card.id}
                  data-testid={`qr-ticket-card-${card.id}`}
                  className="rounded-xl border border-white/80 bg-white/90 p-4"
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <h3
                        data-testid={`qr-ticket-seat-label-${card.id}`}
                        className="break-words text-2xl font-bold leading-tight text-gray-950"
                      >
                        <SeatHighlightLabel
                          tierColor={card.tierColor}
                          testId={`qr-ticket-seat-label-highlight-${card.id}`}
                        >
                          {card.seatLabel}
                        </SeatHighlightLabel>
                      </h3>
                      {card.floorLabel && (
                        <p className="mt-1 text-sm font-medium text-gray-500">{card.floorLabel}</p>
                      )}
                    </div>
                    <Badge
                      className={
                        card.qrCheckInUrl
                          ? 'bg-[#F0FDF4] px-3 py-1 text-sm font-semibold text-[#15803D] border-transparent'
                          : 'bg-[#FFFBEB] px-3 py-1 text-sm font-semibold text-[#8B6306] border-transparent'
                      }
                    >
                      {card.qrBadgeLabel}
                    </Badge>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    {card.qrCheckInUrl ? (
                      <QrTicketImage
                        value={card.qrCheckInUrl}
                        title={`${card.seatLabel} ${copy.detail.qrTicket}`}
                      />
                    ) : (
                      <div className="rounded-lg border border-[#F3E6A6] bg-[#FFFBEB] p-4 text-sm text-[#8B6306]">
                        <p className="font-semibold">
                          {card.qrUnavailableTitle}
                        </p>
                        <p className="mt-1">
                          {card.qrUnavailableDescription}
                        </p>
                        <p className="mt-2 text-gray-700">
                          {completeCopy.fieldCheckResult}
                        </p>
                      </div>
                    )}
                    <div>
                      <InfoRow label={copy.detail.reservationNumber} value={reservation.reservationNumber} />
                      <Separator />
                      <InfoRow label={completeCopy.performanceName} value={reservation.performanceTitle} />
                      <Separator />
                      <InfoRow
                        label={completeCopy.performanceDate}
                        value={formatDateTime(reservation.showDateTime, undefined, locale)}
                      />
                      <Separator />
                      <InfoRow
                        label={copy.detail.seatInfo}
                        value={(
                          <SeatHighlightLabel
                            tierColor={card.tierColor}
                            testId={`qr-ticket-seat-detail-highlight-${card.id}`}
                          >
                            {card.seatLabel}
                          </SeatHighlightLabel>
                        )}
                        valueClassName="break-words text-lg font-bold leading-snug text-gray-950"
                      />
                      <Separator />
                      <InfoRow
                        label={completeCopy.ticketStatusLabel}
                        value={card.ticketStatusLabel}
                      />
                      <Separator />
                      <InfoRow
                        label={copy.detail.entryStatus}
                        value={card.admissionStatusLabel}
                      />
                    </div>
                  </div>

                  {card.admissionState === 'ENTERED' && (
                    <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#15803D]" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[#166534]">
                          {detailCopy.entryProcessed}
                        </p>
                        {card.enteredAt && (
                          <p className="text-sm text-[#166534]">
                            {formatDateTime(card.enteredAt, undefined, locale)}
                          </p>
                        )}
                        <p className="text-sm text-gray-700">
                          {detailCopy.enteredFieldCheckResult}
                        </p>
                      </div>
                    </div>
                  )}

                  {card.isTicketItem && (
                    <TicketBenefitCoupons
                      reservationId={reservation.id}
                      ticketItemId={card.id}
                      benefits={card.benefitEntitlements}
                      ticketStatus={card.status}
                      token={card.qrToken}
                      seatLabel={card.seatLabel}
                      locale={benefitLocale}
                    />
                  )}
                  {card.cancellation && <TicketCancellationSummary cancellation={card.cancellation} locale={locale} />}
                  {card.isTicketItem && card.status === 'ACTIVE' && card.admissionState !== 'ENTERED'
                    && !card.benefitEntitlements.some((benefit) => benefit.state === 'redeemed') && canCancelSeat && (
                    <Button variant="outline" className="mt-4" disabled={isCancelling} onClick={() => {
                      setCancelTicketItemId(card.id); setCancelModalOpen(true);
                    }}>{cancellationCopy.cancelOne}</Button>
                  )}

                </div>
              ))}
            </div>

            {reservation.ticketItems.some((item) => item.status === 'ACTIVE') && <TicketEmailDeliveryPanel
              reservationId={reservation.id}
              delivery={reservation.ticketEmailDelivery}
            />}
          </CardContent>
        </Card>
      )}

      {reservation.status === 'CONFIRMED' && (
        <AreunGlPerformancePromo
          genre={reservation.performanceGenre}
          placement="reservation_detail"
          locale={locale}
          className="mt-4"
        />
      )}

      {showRefundPreview && (
        <Card className="mt-4 border-[#E9DFFF] bg-[#FAF7FF] py-4">
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-gray-900">
                  {copy.cancel.title}
                </h2>
                <p className="text-sm text-gray-700">
                  {copy.cancel.description}
                </p>
              </div>
              <Badge
                className={
                  reservation.status === 'CANCELLED'
                    ? 'bg-[#FEF2F2] text-[#C62828] border-transparent'
                    : 'bg-[#F3EFFF] text-[#6C3CE0] border-transparent'
                }
              >
                {reservation.status === 'CANCELLED' ? copy.status.cancelled : copy.cancel.finalCheck}
              </Badge>
            </div>

            <div className="rounded-xl border border-white/80 bg-white/90 p-4">
              <InfoRow
                label={copy.cancel.refundAmount}
                value={displayedRefundValue}
                valueClassName={displayedRefundValueClassName}
              />
              {reservation.refundProviderAmount && <InfoRow label={cancellationCopy.completedTotal}
                value={`${reservation.refundProviderAmount.currency} ${reservation.refundProviderAmount.amountDecimal}`} />}
              <Separator />
              <InfoRow
                label={copy.cancel.refundMethod}
                value={copy.cancel.refundMethodValue.replace('{paymentMethod}', refundPaymentMethodLabel)}
              />
              {hasExpectedDepositAt && reservation.refundTimeline?.expectedDepositAt && (
                <>
                  <Separator />
                  <InfoRow
                    label={copy.cancel.expectedDeposit}
                    value={formatDateTime(reservation.refundTimeline?.expectedDepositAt, undefined, locale)}
                  />
                </>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-[#E5D9FF] bg-white/85 p-4">
              <p className="text-sm text-gray-700">
                {copy.cancel.refundTimingNotice}
              </p>
              <p className="text-sm text-gray-700">{copy.cancel.delayedReopenNotice}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {showRefundTimeline && reservation.refundTimeline && (
        <RefundTimeline
          timeline={reservation.refundTimeline}
          cancelledSeatHold={reservation.cancelledSeatHold}
        />
      )}

      {/* Cancellation deadlines apply only after a completed payment. */}
      {hasCompletedPayment && <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            {copy.cancel.deadlineTitle}
          </h2>
          <div className="flex items-start justify-between py-2">
            <span className="text-sm text-gray-600">{completeCopy.cancellationDeadline}</span>
            <div className="text-right">
              <span
                className={`text-sm font-semibold ${
                  isDeadlinePassed ? 'text-error' : 'text-gray-900'
                }`}
              >
                {formatDeadline(reservation.cancelDeadline, locale, detailCopy.deadlineSuffix)}
              </span>
              {isDeadlinePassed && (
                <p className="mt-0.5 text-xs text-[#C62828]">
                  {detailCopy.deadlinePassed}
                </p>
              )}
            </div>
          </div>
          {reservation.cancelledAt && (
            <>
              <Separator />
              <InfoRow
                label={detailCopy.cancelledAt}
                value={formatDateTime(reservation.cancelledAt, undefined, locale)}
              />
              {reservation.cancelReason && (
                <>
                  <Separator />
                  <InfoRow label={copy.cancel.reasonLabel} value={reservation.cancelReason} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>}

      {/* Cancel button */}
      {showCancelButton && (
        <div className="mt-6">
          {canCancel ? (
            <Button
              variant="destructive"
              className="h-12 w-full"
              onClick={() => { setCancelTicketItemId(null); setCancelModalOpen(true); }}
            >
              {copy.detail.cancelReservation}
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block w-full">
                    <Button
                      variant="destructive"
                      className="h-12 w-full"
                      aria-disabled="true"
                      disabled
                    >
                      {copy.detail.cancelReservation}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {detailCopy.deadlinePassed}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      {/* Cancel modal */}
      <CancelConfirmModal
        key={cancelTicketItemId ?? 'all-active-tickets'}
        open={cancelModalOpen}
        onOpenChange={setCancelModalOpen}
        refundAmount={cancelModalRefundAmount}
        cancellationQuote={refundPreviewQuery.data?.cancellationQuote ?? null}
        paymentMethod={paymentMethodLabel}
        expectedDepositAt={reservation.refundTimeline?.expectedDepositAt ?? null}
        releaseWindowMinutes={refundPreviewQuery.data?.cancelledSeatHoldWindowMinutes ?? null}
        isPreviewLoading={refundPreviewQuery.isLoading}
        isPreviewError={refundPreviewQuery.isError}
        selectedSeats={qrCards.filter((card) => card.status === 'ACTIVE' && (!cancelTicketItemId || card.id === cancelTicketItemId)).map((card) => card.seatLabel)}
        remainingSeats={qrCards.filter((card) => card.status === 'ACTIVE' && cancelTicketItemId && card.id !== cancelTicketItemId).map((card) => card.seatLabel)}
        providerRefund={refundPreviewQuery.data?.providerRefund}
        blockedReason={refundPreviewQuery.data?.blockedReason}
        canConfirm={refundPreviewQuery.data?.canRequestRefund === true}
        onRetryPreview={() => { void refundPreviewQuery.refetch(); }}
        onConfirm={(reason) => onCancel(reason, cancelTicketItemId ?? undefined, {
          expectedRefundableAmount: refundPreviewQuery.data!.refundableAmount,
          expectedProviderRefundAmountMinor: refundPreviewQuery.data?.providerRefund?.amountMinor,
        })}
        isLoading={isCancelling}
      />
    </div>
  );
}
