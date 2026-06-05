'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ReservationListSkeleton } from '@/components/skeletons';
import { ReservationCard } from '@/components/reservation/reservation-card';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import type { ReservationListItem } from '@grabit/shared';

const FILTER_OPTIONS = [
  { value: 'all', labelKey: 'all' },
  { value: 'CONFIRMED', labelKey: 'confirmed' },
  { value: 'CANCELLED', labelKey: 'cancelled' },
] as const;

interface ReservationListProps {
  reservations: ReservationListItem[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  filter: string;
  onFilterChange: (filter: string) => void;
}

export function ReservationList({
  reservations,
  isLoading,
  isFetching,
  filter,
  onFilterChange,
}: ReservationListProps) {
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).reservation;

  return (
    <div>
      {/* Filter chips */}
      <div className="flex gap-2" role="group" aria-label={copy.list.filterAria}>
        {FILTER_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? 'default' : 'ghost'}
            size="sm"
            className={
              filter === option.value
                ? ''
                : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
            }
            onClick={() => onFilterChange(option.value)}
            aria-pressed={filter === option.value}
          >
            {option.labelKey === 'all'
              ? copy.list.all
              : copy.status[option.labelKey]}
          </Button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="mt-4">
          <ReservationListSkeleton />
        </div>
      )}

      {/* Reservation cards */}
      {!isLoading && reservations && reservations.length > 0 && (
        <div
          className="mt-4 flex flex-col gap-4 transition-opacity duration-150"
          style={{ opacity: isFetching ? 0.5 : 1 }}
        >
          {reservations.map((reservation) => (
            <ReservationCard
              key={reservation.id}
              reservation={reservation}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && reservations && reservations.length === 0 && (
        <div className="mt-12 flex flex-col items-center text-center">
          <p className="text-base font-semibold text-gray-900">
            {copy.list.emptyTitle}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            {copy.list.emptyBody}
          </p>
          <Link href={getLocalizedPathname('/', locale)}>
            <Button className="mt-6">{copy.list.browse}</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
