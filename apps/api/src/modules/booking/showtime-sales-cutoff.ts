import { ForbiddenException } from '@nestjs/common';

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
