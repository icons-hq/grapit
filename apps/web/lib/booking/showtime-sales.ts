import type { Showtime } from '@grabit/shared';

/**
 * Server message for a lock/prepare rejected because the showtime already
 * started. Web branches on HTTP status + message (exception extra fields are
 * not part of the contract yet).
 */
export const SHOWTIME_SALES_CLOSED_MESSAGE = '이미 시작된 회차는 예매할 수 없습니다.';

/** setTimeout delays above 2^31-1 ms overflow and fire immediately. */
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

function parseShowtimeStart(dateTime: string): number {
  return Date.parse(dateTime);
}

/**
 * Sales cutoff for a showtime: once `now >= showtimes.date_time` the showtime
 * can no longer be booked. No offset and no admin bypass. An unparseable
 * date is left to the server to decide.
 */
export function isShowtimeSalesClosed(dateTime: string, now: number = Date.now()): boolean {
  const startsAt = parseShowtimeStart(dateTime);
  return Number.isFinite(startsAt) && now >= startsAt;
}

export function filterBookableShowtimes<T extends Pick<Showtime, 'dateTime'>>(
  showtimes: readonly T[],
  now: number = Date.now(),
): T[] {
  return showtimes.filter((showtime) => !isShowtimeSalesClosed(showtime.dateTime, now));
}

/** Earliest future cutoff, used to re-evaluate the list exactly when a showtime closes. */
export function getNextShowtimeCutoffAt(
  showtimes: readonly Pick<Showtime, 'dateTime'>[],
  now: number = Date.now(),
): number | null {
  let next: number | null = null;
  for (const showtime of showtimes) {
    const startsAt = parseShowtimeStart(showtime.dateTime);
    if (!Number.isFinite(startsAt) || startsAt <= now) {
      continue;
    }
    next = next === null ? startsAt : Math.min(next, startsAt);
  }
  return next;
}

export function getCutoffTimerDelay(cutoffAt: number, now: number = Date.now()): number {
  return Math.min(Math.max(0, cutoffAt - now), MAX_TIMEOUT_DELAY_MS);
}

export function isShowtimeSalesClosedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { statusCode?: unknown; message?: unknown };
  return candidate.statusCode === 403
    && typeof candidate.message === 'string'
    && candidate.message.trim() === SHOWTIME_SALES_CLOSED_MESSAGE;
}
