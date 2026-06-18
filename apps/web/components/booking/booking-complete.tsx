'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { TicketEmailDeliveryPanel } from '@/components/reservation/ticket-email-delivery-panel';
import {
  buildQrCheckInUrl,
  QrTicketImage,
} from '@/components/field/qr-ticket-image';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
  type VisibleCopy,
} from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import type { BenefitEntitlement, ReservationDetail, TicketItem } from '@grabit/shared';

interface BookingCompleteProps {
  booking: ReservationDetail;
}

type CompleteCardCopy = VisibleCopy['bookingExtra']['completeCard'];
type BenefitCopy = CompleteCardCopy['benefits'];
type BenefitLocale = keyof BenefitEntitlement['displayCopy'];

function formatDateTime(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatPrice(amount: number, locale: string): string {
  if (locale === 'ko') return `${amount.toLocaleString('ko-KR')}원`;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTemplate(template: string, values: object) {
  const record = values as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(record[key] ?? ''),
  );
}

function formatSeats(booking: ReservationDetail, copy: CompleteCardCopy): string {
  return booking.seats
    .map((seat) => formatTemplate(copy.seatLabel, seat))
    .join(', ');
}

function formatTicketItemSeat(ticketItem: TicketItem, copy: CompleteCardCopy): string {
  return formatTemplate(copy.seatLabel, ticketItem);
}

function getQrStatusLabel(
  status: ReservationDetail['qrTicket']['status'],
  copy: CompleteCardCopy,
): string {
  switch (status) {
    case 'ACTIVE':
      return copy.qrActive;
    case 'USED':
      return copy.used;
    case 'REVOKED':
      return copy.revoked;
    case 'EXPIRED':
      return copy.expired;
    default:
      return copy.qrPending;
  }
}

function getTicketItemStatusLabel(status: TicketItem['status'], copy: CompleteCardCopy): string {
  switch (status) {
    case 'ACTIVE':
      return copy.ticketValid;
    case 'CANCELLATION_PENDING':
      return copy.cancellationPending;
    case 'CANCELLED':
      return copy.cancelled;
    case 'EXPIRED':
      return copy.expired;
    default:
      return copy.qrPending;
  }
}

function getAdmissionStateLabel(
  admissionState: TicketItem['admissionState'] | ReservationDetail['qrTicket']['entryStatus'],
  copy: CompleteCardCopy,
): string {
  return admissionState === 'ENTERED' ? copy.entered : copy.notEntered;
}

function getTicketItemQrBadgeLabel(
  status: TicketItem['status'],
  hasActiveQr: boolean,
  copy: CompleteCardCopy,
): string {
  if (hasActiveQr) {
    return copy.qrActive;
  }
  if (status === 'CANCELLATION_PENDING') {
    return copy.cancellationPending;
  }
  if (status === 'CANCELLED') {
    return copy.cancelled;
  }
  if (status === 'EXPIRED') {
    return copy.expired;
  }

  return copy.qrPending;
}

function getTicketItemQrUnavailableCopy(status: TicketItem['status'], copy: CompleteCardCopy) {
  if (status === 'CANCELLATION_PENDING') {
    return {
      title: copy.unavailablePendingTitle,
      description: copy.unavailablePendingDescription,
    };
  }
  if (status === 'CANCELLED') {
    return {
      title: copy.unavailableCancelledTitle,
      description: copy.unavailableCancelledDescription,
    };
  }
  if (status === 'EXPIRED') {
    return {
      title: copy.unavailableExpiredTitle,
      description: copy.unavailableExpiredDescription,
    };
  }

  return {
    title: copy.unavailableDefaultTitle,
    description: copy.unavailableDefaultDescription,
  };
}

function getBenefitKindLabel(kind: BenefitEntitlement['kind'], copy: BenefitCopy): string {
  return kind === 'included' ? copy.included : copy.limited;
}

function getBenefitStateKey(
  entitlement: BenefitEntitlement,
  ticketStatus: TicketItem['status'],
): 'available' | 'used' | 'inactive' {
  if (entitlement.state === 'redeemed') {
    return 'used';
  }
  if (ticketStatus !== 'ACTIVE' || entitlement.state === 'inactive') {
    return 'inactive';
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
  status: TicketItem['status'];
  benefitEntitlements: BenefitEntitlement[];
};

function getBuyerQrCards(booking: ReservationDetail, copy: CompleteCardCopy): BuyerQrCard[] {
  const ticketItems = Array.isArray(booking.ticketItems) ? booking.ticketItems : [];
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
        seatLabel: formatTicketItemSeat(ticketItem, copy),
        floorLabel: ticketItem.floorLabel,
        qrCheckInUrl,
        qrBadgeLabel: getTicketItemQrBadgeLabel(ticketItem.status, Boolean(qrCheckInUrl), copy),
        qrUnavailableTitle: unavailableCopy.title,
        qrUnavailableDescription: unavailableCopy.description,
        ticketStatusLabel: getTicketItemStatusLabel(ticketItem.status, copy),
        admissionStatusLabel: getAdmissionStateLabel(ticketItem.admissionState, copy),
        status: ticketItem.status,
        benefitEntitlements: Array.isArray(ticketItem.benefitEntitlements)
          ? ticketItem.benefitEntitlements
          : [],
      };
    });
  }

  const isQrActive = booking.qrTicket?.status === 'ACTIVE' && booking.qrTicket.token;
  return [
    {
      id: 'legacy-qr-ticket',
      isTicketItem: false,
      seatLabel: formatSeats(booking, copy),
      floorLabel: '',
      qrCheckInUrl: isQrActive ? buildQrCheckInUrl(booking.qrTicket.token) : null,
      qrBadgeLabel: isQrActive ? copy.qrActive : copy.qrPending,
      qrUnavailableTitle: copy.unavailableDefaultTitle,
      qrUnavailableDescription: copy.unavailableDefaultDescription,
      ticketStatusLabel: getQrStatusLabel(booking.qrTicket.status, copy),
      admissionStatusLabel: getAdmissionStateLabel(booking.qrTicket.entryStatus, copy),
      status: booking.qrTicket.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE',
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
                      date: formatDateTime(benefit.redeemedAt, locale),
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

export function BookingComplete({ booking }: BookingCompleteProps) {
  const router = useRouter();
  const locale = getClientLocale();
  const benefitLocale = resolveVisibleCopyLocale(locale);
  const visibleCopy = getVisibleCopy(locale);
  const copy = visibleCopy.bookingExtra.completeCard;
  const qrCards = getBuyerQrCards(booking, copy);
  const hasActiveQr = qrCards.some((card) => card.qrCheckInUrl);

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Success icon and heading */}
      <div className="flex flex-col items-center gap-3 pt-4">
        <CheckCircle2 className="h-16 w-16 text-success" />
        <h1 className="text-xl font-semibold" tabIndex={-1} id="booking-complete-heading">
          {copy.title}
        </h1>
      </div>

      {/* Reservation number */}
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-2 py-6">
          <span className="text-sm text-gray-500">{copy.reservationNumber}</span>
          <span
            className="text-2xl font-semibold text-primary"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            aria-label={formatTemplate(copy.reservationNumberAria, {
              reservationNumber: booking.reservationNumber,
            })}
          >
            {booking.reservationNumber}
          </span>
        </CardContent>
      </Card>

      {/* Performance info */}
      <Card className="w-full">
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold">{copy.performanceInfo}</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{copy.performanceName}</span>
              <span className="text-right font-semibold text-gray-900">{booking.performanceTitle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{copy.performanceDate}</span>
              <span className="text-right text-gray-900">{formatDateTime(booking.showDateTime, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{copy.venue}</span>
              <span className="text-right text-gray-900">{booking.venue}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seat info */}
      <Card className="w-full">
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold">{copy.seatInfo}</h2>
          <ul className="space-y-2">
            {booking.seats.map((seat) => (
              <li key={seat.seatId} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">
                  {formatTemplate(copy.seatLabel, seat)}
                </span>
                <span className="text-gray-900">{formatPrice(seat.price, locale)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Payment info */}
      <Card className="w-full">
        <CardContent className="space-y-3">
          <h2 className="text-base font-semibold">{copy.paymentInfo}</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{copy.totalAmount}</span>
              <span className="font-semibold text-primary">{formatPrice(booking.totalAmount, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{copy.paymentMethod}</span>
              <span className="text-gray-900">{booking.paymentMethod}</span>
            </div>
            {booking.paidAt && (
              <div className="flex justify-between">
                <span className="text-gray-500">{copy.paidAt}</span>
                <span className="text-gray-900">{formatDateTime(booking.paidAt, locale)}</span>
              </div>
            )}
            {booking.cancelDeadline && (
              <div className="flex justify-between">
                <span className="text-gray-500">{copy.cancellationDeadline}</span>
                <span className="text-gray-900">{formatDateTime(booking.cancelDeadline, locale)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="w-full border-[#E9DFFF] bg-[#F8F5FF]">
        <CardContent className="space-y-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-[#6C3CE0]" />
                <h2 className="text-base font-semibold text-gray-900">{copy.qrTicket}</h2>
              </div>
              <p className="text-sm text-gray-700">
                {hasActiveQr
                  ? copy.qrReady
                  : copy.qrChecking}
              </p>
            </div>
            <Badge
              className={
                hasActiveQr
                  ? 'bg-[#F0FDF4] text-[#15803D] border-transparent'
                  : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'
              }
            >
              {hasActiveQr ? copy.qrActive : copy.qrPending}
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
                      title={`${card.seatLabel} ${copy.qrTicket}`}
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
                        {copy.fieldCheckResult}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <span className="block text-gray-500">{copy.reservationNumber}</span>
                      <span className="font-semibold text-gray-900">{booking.reservationNumber}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500">{copy.performanceName}</span>
                      <span className="font-semibold text-gray-900">{booking.performanceTitle}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500">{copy.performanceDate}</span>
                      <span className="font-semibold text-gray-900">
                        {formatDateTime(booking.showDateTime, locale)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-gray-500">{copy.seatInfo}</span>
                      <span className="font-semibold text-gray-900">{card.seatLabel}</span>
                    </div>
                    <div>
                      <span className="block text-gray-500">{copy.ticketValid}</span>
                      <span className="font-semibold text-gray-900">
                        {card.ticketStatusLabel}
                      </span>
                    </div>
                    <div>
                      <span className="block text-gray-500">{visibleCopy.reservation.detail.entryStatus}</span>
                      <span className="font-semibold text-gray-900">
                        {card.admissionStatusLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {card.isTicketItem && (
                  <TicketBenefitList
                    ticketItemId={card.id}
                    benefits={card.benefitEntitlements}
                    ticketStatus={card.status}
                    copy={copy.benefits}
                    locale={benefitLocale}
                  />
                )}
              </div>
            ))}
          </div>

          <TicketEmailDeliveryPanel
            reservationId={booking.id}
            delivery={booking.ticketEmailDelivery}
          />
        </CardContent>
      </Card>

      <Separator />

      {/* CTA buttons */}
      <div className="flex w-full flex-col gap-3 pb-8">
        <Button
          className="h-12 w-full"
          onClick={() =>
            router.push(getLocalizedPathname(`/mypage/reservations/${booking.id}`, locale))
          }
        >
          {copy.qrTicket}
        </Button>
        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => router.push(`${getLocalizedPathname('/mypage', locale)}?tab=reservations`)}
        >
          {copy.mypageCta}
        </Button>
        <Button
          variant="ghost"
          className="h-12 w-full"
          onClick={() => router.push(getLocalizedPathname('/', locale))}
        >
          {copy.homeCta}
        </Button>
      </div>
    </div>
  );
}
