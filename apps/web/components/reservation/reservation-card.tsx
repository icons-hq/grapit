'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { getVisibleCopy, type VisibleCopy } from '@/lib/i18n/visible-copy';
import type { ReservationListItem, ReservationStatus } from '@grabit/shared';

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

function formatDate(dateString: string, locale: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatSeatSummary(
  seats: ReservationListItem['seats'],
  seatTemplate: string,
  locale: string,
): string {
  if (seats.length === 0) return '';
  const first = seats[0];
  const base = seatTemplate
    .replace('{tierName}', first.tierName)
    .replace('{row}', first.row)
    .replace('{number}', first.number);
  if (seats.length === 1) return base;
  return locale === 'ko' ? `${base} 외 ${seats.length - 1}석` : `${base} + ${seats.length - 1}`;
}

interface ReservationCardProps {
  reservation: ReservationListItem;
}

export function ReservationCard({ reservation }: ReservationCardProps) {
  const router = useRouter();
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale);
  const statusConfig = STATUS_CONFIG[reservation.status];
  const statusLabel = copy.reservation.status[statusConfig.labelKey];
  const dateFormatted = formatDate(reservation.showDateTime, locale);
  const seatSummary = formatSeatSummary(
    reservation.seats,
    copy.reservation.detail.seatLabel,
    locale,
  );
  const detailHref = getLocalizedPathname(`/mypage/reservations/${reservation.id}`, locale);

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${reservation.performanceTitle} ${dateFormatted} ${statusLabel}`}
      className="relative min-h-[44px] cursor-pointer rounded-lg border bg-white p-4 transition-shadow hover:shadow-md"
      onClick={() => router.push(detailHref)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(detailHref);
        }
      }}
    >
      <Badge className={`absolute right-4 top-4 ${statusConfig.className}`}>
        {statusLabel}
      </Badge>

      <div className="flex gap-4">
        {reservation.posterUrl ? (
          <div className="relative h-[84px] w-[60px] shrink-0 overflow-hidden rounded-md">
            <Image
              src={reservation.posterUrl}
              alt={`${reservation.performanceTitle} ${copy.performance.posterAltSuffix}`}
              fill
              className="object-cover"
              sizes="60px"
            />
          </div>
        ) : (
          <div className="flex h-[84px] w-[60px] shrink-0 items-center justify-center rounded-md bg-gray-200 text-xs text-gray-400">
            N/A
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-between pr-16">
          <div>
            <p className="truncate text-base font-semibold text-gray-900">
              {reservation.performanceTitle}
            </p>
            <p className="mt-1 text-sm text-gray-600">{dateFormatted}</p>
            {seatSummary && (
              <p className="mt-0.5 text-sm text-gray-600">{seatSummary}</p>
            )}
          </div>
          <p className="text-base font-semibold text-gray-900">
            {new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: 'KRW',
              maximumFractionDigits: 0,
            }).format(reservation.totalAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}
