'use client';

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
import { RefundTimeline } from '@/components/reservation/refund-timeline';
import { TicketEmailDeliveryPanel } from '@/components/reservation/ticket-email-delivery-panel';
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
  }).format(date);
}

function formatDeadline(
  dateString: string,
  locale: string,
  deadlineTemplate: string,
): string {
  const date = new Date(dateString);
  const value = locale === 'ko'
    ? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : formatDateTime(dateString, '-', locale);
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
type BenefitCopy = VisibleCopy['bookingExtra']['completeCard']['benefits'];
type BenefitLocale = keyof BenefitEntitlement['displayCopy'];

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

function getBenefitKindLabel(kind: BenefitEntitlement['kind'], copy: BenefitCopy): string {
  return kind === 'included' ? copy.included : copy.limited;
}

function getBenefitStateKey(
  entitlement: BenefitEntitlement,
  ticketStatus: TicketItem['status'],
): 'available' | 'used' | 'inactive' {
  if (ticketStatus !== 'ACTIVE' || entitlement.state === 'inactive') {
    return 'inactive';
  }
  if (entitlement.state === 'redeemed') {
    return 'used';
  }

  return 'available';
}

function getBenefitStateLabel(
  stateKey: 'available' | 'used' | 'inactive',
  copy: BenefitCopy,
): string {
  switch (stateKey) {
    case 'used':
      return copy.used;
    case 'inactive':
      return copy.inactive;
    default:
      return copy.available;
  }
}

function getBenefitStateClassName(stateKey: 'available' | 'used' | 'inactive'): string {
  switch (stateKey) {
    case 'used':
      return 'bg-[#F3EFFF] text-[#6C3CE0]';
    case 'inactive':
      return 'bg-[#F3F4F6] text-gray-600';
    default:
      return 'bg-[#F0FDF4] text-[#15803D]';
  }
}

function getBenefitName(
  entitlement: BenefitEntitlement,
  locale: BenefitLocale,
): string {
  return entitlement.displayCopy[locale]?.name ?? entitlement.displayCopy.ko.name;
}

type BuyerQrCard = {
  id: string;
  isTicketItem: boolean;
  seatLabel: string;
  floorLabel: string;
  qrCheckInUrl: string | null;
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
        isTicketItem: true,
        seatLabel: formatTicketItemSeat(ticketItem, copy.seatLabel),
        floorLabel: ticketItem.floorLabel,
        qrCheckInUrl,
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
      floorLabel: '',
      qrCheckInUrl: isQrActive ? buildQrCheckInUrl(reservation.qrTicket.token) : null,
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

function TicketBenefitList({
  ticketItemId,
  benefits,
  ticketStatus,
  copy,
  locale,
}: {
  ticketItemId: string;
  benefits: BenefitEntitlement[];
  ticketStatus: TicketItem['status'];
  copy: BenefitCopy;
  locale: BenefitLocale;
}) {
  return (
    <div
      data-testid={`ticket-benefits-${ticketItemId}`}
      className="mt-4 border-t border-gray-100 pt-4"
    >
      <h4 className="text-sm font-semibold text-gray-900">{copy.title}</h4>
      {benefits.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{copy.empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {benefits.map((benefit) => {
            const stateKey = getBenefitStateKey(benefit, ticketStatus);
            return (
              <li
                key={benefit.id}
                className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2"
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-900">
                    {getBenefitName(benefit, locale)}
                  </p>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
                      {getBenefitKindLabel(benefit.kind, copy)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${getBenefitStateClassName(stateKey)}`}
                    >
                      {getBenefitStateLabel(stateKey, copy)}
                    </span>
                  </div>
                </div>
                {stateKey === 'used' && benefit.redeemedAt && (
                  <p className="mt-1 break-words text-xs text-gray-500">
                    {formatTemplate(copy.redeemedAt, {
                      date: formatDateTime(benefit.redeemedAt, '-', locale),
                    })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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

function hasDatePassed(dateString: string | null | undefined): boolean {
  if (!dateString) {
    return false;
  }

  const date = new Date(dateString);
  return !Number.isNaN(date.getTime()) && date < new Date();
}

function formatPaymentMethodLabel(
  method: string | null | undefined,
  copy: ReservationDetailCopy,
): string {
  switch (method) {
    case 'CARD':
      return copy.paymentMethods.card;
    case 'VIRTUAL_ACCOUNT':
      return copy.paymentMethods.virtualAccount;
    case 'TRANSFER':
      return copy.paymentMethods.transfer;
    case 'MOBILE_PHONE':
      return copy.paymentMethods.mobilePhone;
    case 'FOREIGN_EASY_PAY':
      return copy.paymentMethods.foreignEasyPay;
    case 'SIMPLE_PAY':
      return copy.paymentMethods.simplePay;
    case null:
    case undefined:
    case '':
      return copy.paymentMethods.unselected;
    default:
      return method;
  }
}

function getPaymentMethodLabel(
  reservation: ReservationDetailType,
  copy: ReservationDetailCopy,
): string {
  return formatPaymentMethodLabel(
    reservation.paymentInfo?.paymentMethod?.method ??
      reservation.paymentInfo?.method ??
      reservation.paymentMethod,
    copy,
  );
}

function isFailedPaymentStatus(status: PaymentStatus | null | undefined): boolean {
  return status === 'ABORTED' || status === 'EXPIRED' || status === 'CANCELED';
}

function isPaymentConfirmationStatus(status: PaymentStatus | null | undefined): boolean {
  return status === 'IN_PROGRESS' || status === 'DONE';
}

function hasCancellationInProgress(reservation: ReservationDetailType): boolean {
  return reservation.refundTimeline.currentState !== 'COMPLETED' ||
    reservation.ticketItems.some((ticketItem) => ticketItem.status === 'CANCELLATION_PENDING');
}

function getProgressGuidance(
  reservation: ReservationDetailType,
  paymentDeadlineAt: string | null | undefined,
  isPaymentDeadlinePassed: boolean,
  copy: ReservationDetailCopy,
  locale: string,
): ProgressGuidance | null {
  const progress = copy.progress;

  if (reservation.status === 'CANCELLED') {
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
        estimate: reservation.refundTimeline.expectedDepositAt
          ? formatTemplate(progress.expectedDeposit, {
              date: formatDateTime(reservation.refundTimeline.expectedDepositAt, undefined, locale),
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
      estimate: reservation.refundTimeline.expectedDepositAt
        ? formatTemplate(progress.expectedDeposit, {
            date: formatDateTime(reservation.refundTimeline.expectedDepositAt, undefined, locale),
          })
        : progress.refundBusinessDays,
    };
  }

  const paymentStatus = reservation.paymentInfo?.status;
  if (reservation.status === 'PENDING_PAYMENT' && isPaymentConfirmationStatus(paymentStatus)) {
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
    (isPaymentDeadlinePassed || isFailedPaymentStatus(paymentStatus));
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-right text-sm font-semibold text-gray-900">
        {value}
      </span>
    </div>
  );
}

interface ReservationDetailProps {
  reservation: ReservationDetailType;
  onCancel: (reason: string) => void;
  isCancelling: boolean;
  onResumePayment?: (reservation: ReservationDetailType) => void;
}

export function ReservationDetailView({
  reservation,
  onCancel,
  isCancelling,
  onResumePayment,
}: ReservationDetailProps) {
  const router = useRouter();
  const locale = getClientLocale();
  const benefitLocale = resolveVisibleCopyLocale(locale);
  const visibleCopy = getVisibleCopy(locale);
  const copy = visibleCopy.reservation;
  const detailCopy = copy.detail;
  const completeCopy = visibleCopy.bookingExtra.completeCard;
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const statusConfig = STATUS_CONFIG[reservation.status];
  const statusLabel = copy.status[statusConfig.labelKey];
  const paymentMethodLabel = getPaymentMethodLabel(reservation, detailCopy);
  const refundPaymentMethodLabel =
    paymentMethodLabel === detailCopy.paymentMethods.unselected
      ? detailCopy.paymentMethods.fallback
      : paymentMethodLabel;
  const paymentAmount = reservation.paymentInfo?.amount ?? reservation.totalAmount;
  const paymentPaidAt = reservation.paymentInfo?.paidAt ?? reservation.paidAt;
  const paymentDeadlineAt =
    reservation.paymentInfo?.paymentDeadlineAt ?? reservation.paymentDeadlineAt;

  const isDeadlinePassed = new Date(reservation.cancelDeadline) < new Date();
  const isPaymentDeadlinePassed = hasDatePassed(paymentDeadlineAt);
  const canCancel = reservation.status === 'CONFIRMED' && !isDeadlinePassed;
  const hasSeatLevelTicketItems = hasPersistedTicketItems(reservation);
  const ticketItemRefundTotal = hasSeatLevelTicketItems
    ? reservation.ticketItems.reduce(
        (total, ticketItem) => total + (ticketItem.cancellation?.refundableAmount ?? 0),
        0,
      )
    : 0;
  const displayedRefundAmount =
    hasSeatLevelTicketItems && ticketItemRefundTotal > 0
      ? ticketItemRefundTotal
      : reservation.totalAmount;
  const showCancelButton = reservation.status === 'CONFIRMED';
  const progressGuidance = getProgressGuidance(
    reservation,
    paymentDeadlineAt,
    isPaymentDeadlinePassed,
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
  const canResumePayment =
    progressGuidance?.kind === 'payment-pending' &&
    Boolean(onResumePayment);
  const showRefundPreview =
    reservation.status === 'CONFIRMED' ||
    reservation.status === 'CANCELLED';
  const showRefundTimeline =
    reservation.status === 'CANCELLED' ||
    reservation.cancelledAt !== null ||
    reservation.refundTimeline.currentState !== 'COMPLETED';
  const hasExpectedDepositAt =
    Boolean(reservation.refundTimeline.expectedDepositAt) && showRefundTimeline;
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
          <InfoRow
            label={copy.detail.totalAmount}
            value={formatPrice(paymentAmount, locale)}
          />
          <Separator />
          <InfoRow label={copy.detail.paymentMethod} value={paymentMethodLabel} />
          <Separator />
          <InfoRow
            label={completeCopy.paidAt}
            value={formatDateTime(paymentPaidAt, detailCopy.beforePayment, locale)}
          />
        </CardContent>
      </Card>

      {progressGuidance && (
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
                {hasActiveQr ? completeCopy.qrActive : completeCopy.qrPending}
              </Badge>
            </div>

            <div className="space-y-3">
              {qrCards.map((card) => (
                <div
                  key={card.id}
                  data-testid={`qr-ticket-card-${card.id}`}
                  className="rounded-xl border border-white/80 bg-white/90 p-4"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{card.seatLabel}</h3>
                      {card.floorLabel && (
                        <p className="mt-1 text-xs text-gray-500">{card.floorLabel}</p>
                      )}
                    </div>
                    <Badge
                      className={
                        card.qrCheckInUrl
                          ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
                          : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
                      }
                    >
                      {card.qrBadgeLabel}
                    </Badge>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
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
                      <InfoRow label={copy.detail.seatInfo} value={card.seatLabel} />
                      <Separator />
                      <InfoRow
                        label={completeCopy.ticketValid}
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
                    <TicketBenefitList
                      ticketItemId={card.id}
                      benefits={card.benefitEntitlements}
                      ticketStatus={card.status}
                      copy={completeCopy.benefits}
                      locale={benefitLocale}
                    />
                  )}
                </div>
              ))}
            </div>

            <TicketEmailDeliveryPanel
              reservationId={reservation.id}
              delivery={reservation.ticketEmailDelivery}
            />
          </CardContent>
        </Card>
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
                value={formatPrice(displayedRefundAmount, locale)}
              />
              <Separator />
              <InfoRow
                label={copy.cancel.refundMethod}
                value={copy.cancel.refundMethodValue.replace('{paymentMethod}', refundPaymentMethodLabel)}
              />
              {hasExpectedDepositAt && reservation.refundTimeline.expectedDepositAt && (
                <>
                  <Separator />
                  <InfoRow
                    label={copy.cancel.expectedDeposit}
                    value={formatDateTime(reservation.refundTimeline.expectedDepositAt, undefined, locale)}
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

      {showRefundTimeline && (
        <RefundTimeline
          timeline={reservation.refundTimeline}
          cancelledSeatHold={reservation.cancelledSeatHold}
        />
      )}

      {/* Cancel info */}
      <Card className="mt-4 py-4">
        <CardContent>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            {copy.cancel.title}
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
      </Card>

      {/* Cancel button */}
      {showCancelButton && (
        <div className="mt-6">
          {canCancel ? (
            <Button
              variant="destructive"
              className="h-12 w-full"
              onClick={() => setCancelModalOpen(true)}
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
        open={cancelModalOpen}
        onOpenChange={setCancelModalOpen}
        refundAmount={displayedRefundAmount}
        paymentMethod={paymentMethodLabel}
        expectedDepositAt={reservation.refundTimeline.expectedDepositAt ?? null}
        releaseWindowMinutes={reservation.cancelledSeatHold?.releaseWindowMinutes ?? null}
        onConfirm={onCancel}
        isLoading={isCancelling}
      />
    </div>
  );
}
