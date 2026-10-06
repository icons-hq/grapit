import { ForbiddenException } from '@nestjs/common';
import { gt, type SQL } from 'drizzle-orm';
import { showtimes } from '../../database/schema/showtimes.js';

export const SHOWTIME_STARTED_MESSAGE = '이미 시작된 회차는 예매할 수 없습니다.';

/**
 * Showtime sales close at the scheduled start (`showtimes.date_time`): no
 * offset and no Admin Booking Bypass. An unreadable start time cannot prove the
 * showtime is still on sale, so it counts as closed.
 */
export function isShowtimeSalesClosed(
  showtimeStartsAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (showtimeStartsAt === null || showtimeStartsAt === undefined) {
    return true;
  }

  const startsAtMs = (showtimeStartsAt instanceof Date
    ? showtimeStartsAt
    : new Date(showtimeStartsAt)).getTime();

  return Number.isNaN(startsAtMs) || now.getTime() >= startsAtMs;
}

/** Rejects new seat locks and reservation prepares for a started showtime. */
export function assertShowtimeSalesOpen(
  showtimeStartsAt: Date | string | null | undefined,
  now: Date = new Date(),
): void {
  if (isShowtimeSalesClosed(showtimeStartsAt, now)) {
    throw new ForbiddenException(SHOWTIME_STARTED_MESSAGE);
  }
}

/**
 * Set form of {@link isShowtimeSalesClosed} for queries: matches the showtimes
 * still on sale at `now` (`date_time > now`, the exact negation of
 * `now >= date_time`). Every API sales gate that counts or filters showtimes
 * uses this instead of its own comparison, so the cutoff has one definition.
 */
export function showtimeOnSaleCondition(now: Date = new Date()): SQL {
  return gt(showtimes.dateTime, now);
}
