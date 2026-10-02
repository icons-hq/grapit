import { and, eq, gt, inArray, isNull, lte, ne, not, or, sql, type SQL } from 'drizzle-orm';
import type { PerformanceCardData, PerformanceQuery, PerformanceStatus } from '@grabit/shared';
import { bookingPolicies, performances, priceTiers, showtimes, venues } from '../../database/schema/index.js';
import { isShowtimeSalesClosed, showtimeOnSaleCondition } from '../booking/showtime-sales-cutoff.js';

export const publicCatalogCardSelection = {
  id: performances.id, title: performances.title, genre: performances.genre,
  posterUrl: performances.posterUrl, status: performances.status,
  bookingStartsAt: bookingPolicies.bookingStartsAt,
  startDate: performances.startDate, endDate: performances.endDate, venueName: venues.name,
  minPrice: sql<number | null>`(select min(${priceTiers.price}) from ${priceTiers} where ${priceTiers.performanceId} = ${performances.id})`,
  // Start of the last showtime; null when the performance has no showtime yet.
  lastShowtimeAt: sql<Date | string | null>`(select max(${showtimes.dateTime}) from ${showtimes} where ${showtimes.performanceId} = ${performances.id})`,
};

/**
 * True when the performance has showtimes and every one of them has passed the
 * showtime sales cutoff (C1: `now >= date_time`), so nothing is left to book.
 * A performance without showtimes (null) keeps its operator status.
 */
export function areAllShowtimesSalesClosed(
  lastShowtimeAt: Date | string | null | undefined, now = new Date(),
): boolean {
  if (lastShowtimeAt === null || lastShowtimeAt === undefined) return false;
  const lastStartsAtMs = new Date(lastShowtimeAt).getTime();
  return Number.isFinite(lastStartsAtMs) && isShowtimeSalesClosed(lastShowtimeAt, now);
}

function hasShowtimeCondition(): SQL {
  return sql`exists (select 1 from ${showtimes} where ${eq(showtimes.performanceId, performances.id)})`;
}

function hasShowtimeOnSaleCondition(now: Date): SQL {
  return sql`exists (select 1 from ${showtimes} where ${and(eq(showtimes.performanceId, performances.id), showtimeOnSaleCondition(now))})`;
}

/**
 * Set form of areAllShowtimesSalesClosed being false: a showtime is still on
 * sale, or the performance has no showtime yet.
 */
function catalogShowtimesOpenCondition(now: Date): SQL {
  return or(hasShowtimeOnSaleCondition(now), not(hasShowtimeCondition())) as SQL;
}

/** Set form of areAllShowtimesSalesClosed: the last showtime has already started. */
function catalogAllShowtimesStartedCondition(now: Date): SQL {
  return and(hasShowtimeCondition(), not(hasShowtimeOnSaleCondition(now))) as SQL;
}

export function resolveEffectivePerformanceStatus(
  status: PerformanceStatus, bookingStartsAt: Date | string | null | undefined, now = new Date(),
): PerformanceStatus {
  if (status !== 'upcoming' || !bookingStartsAt) return status;
  const startsAtMs = new Date(bookingStartsAt).getTime();
  return Number.isFinite(startsAtMs) && startsAtMs <= now.getTime() ? 'selling' : status;
}

/**
 * Buyer-facing catalog status. A performance whose showtimes have all started
 * (the last showtime passed the C1 sales cutoff) reads as ended, even while the
 * operator status still says selling. On top of the effective status, a booking
 * start in the future always reads as upcoming (unless ended), so an operator
 * who marks a performance selling ahead of its booking start does not advertise
 * it as on sale before it opens. Must stay in sync with
 * publicCatalogStatusCondition and the web resolveTimeAwarePerformanceStatus.
 */
export function resolvePublicCatalogStatus(
  status: PerformanceStatus, bookingStartsAt: Date | string | null | undefined, now = new Date(),
  lastShowtimeAt?: Date | string | null,
): PerformanceStatus {
  if (status === 'ended') return status;
  // Every showtime already started: nothing can be booked, whatever the
  // operator status or booking start says.
  if (areAllShowtimesSalesClosed(lastShowtimeAt, now)) return 'ended';
  if (!bookingStartsAt) return status;
  const startsAtMs = new Date(bookingStartsAt).getTime();
  if (Number.isFinite(startsAtMs) && startsAtMs > now.getTime()) return 'upcoming';
  return resolveEffectivePerformanceStatus(status, bookingStartsAt, now);
}

/**
 * Public detail response with the buyer-facing catalog status, so the detail
 * API agrees with list and search cards. Applied at response time on the public
 * read only; the admin detail read keeps its own status for the edit form.
 * Idempotent on top of the effective status findById computes.
 */
export function withPublicCatalogStatus<T extends {
  status: PerformanceStatus;
  bookingPolicy?: { bookingStartsAt?: string | null } | null;
  showtimes?: ReadonlyArray<{ dateTime: string }> | null;
}>(detail: T, now = new Date()): T {
  const status = resolvePublicCatalogStatus(
    detail.status, detail.bookingPolicy?.bookingStartsAt, now, latestShowtimeAt(detail.showtimes),
  );
  return status === detail.status ? detail : { ...detail, status };
}

function latestShowtimeAt(
  values: ReadonlyArray<{ dateTime: string }> | null | undefined,
): Date | null {
  let latestMs: number | null = null;
  for (const { dateTime } of values ?? []) {
    const startsAtMs = Date.parse(dateTime);
    if (Number.isFinite(startsAtMs) && (latestMs === null || startsAtMs > latestMs)) latestMs = startsAtMs;
  }
  return latestMs === null ? null : new Date(latestMs);
}

export function publicCatalogStatusCondition(status: PerformanceQuery['status'], now = new Date()) {
  if (status === 'selling') return and(or(
    and(inArray(performances.status, ['selling', 'closing_soon']),
      or(isNull(bookingPolicies.bookingStartsAt), lte(bookingPolicies.bookingStartsAt, now))),
    and(eq(performances.status, 'upcoming'), lte(bookingPolicies.bookingStartsAt, now))),
  catalogShowtimesOpenCondition(now));
  if (status === 'upcoming') return and(or(
    and(eq(performances.status, 'upcoming'),
      or(isNull(bookingPolicies.bookingStartsAt), gt(bookingPolicies.bookingStartsAt, now))),
    and(inArray(performances.status, ['selling', 'closing_soon']), gt(bookingPolicies.bookingStartsAt, now))),
  catalogShowtimesOpenCondition(now));
  if (status === 'ended') return or(eq(performances.status, 'ended'), catalogAllShowtimesStartedCondition(now));
  return undefined;
}

/**
 * Rows that do not read as ended (see resolvePublicCatalogStatus), for lists
 * that hide ended performances. Uses only performances and showtimes, so it
 * also works in count queries without the booking policy join.
 */
export function publicCatalogNotEndedCondition(now = new Date()): SQL {
  return and(ne(performances.status, 'ended'), catalogShowtimesOpenCondition(now)) as SQL;
}

type CatalogCardRow = Pick<typeof performances.$inferSelect,
  'id' | 'title' | 'genre' | 'posterUrl' | 'status' | 'startDate' | 'endDate'> & {
    bookingStartsAt?: Date | null; venueName: string | null; minPrice?: number | null;
    lastShowtimeAt?: Date | string | null;
  };

// Used directly as an Array#map callback, so it takes no extra parameters.
export function mapPublicCatalogCard(row: CatalogCardRow): PerformanceCardData {
  return {
    id: row.id, title: row.title, genre: row.genre, posterUrl: row.posterUrl,
    status: resolvePublicCatalogStatus(row.status, row.bookingStartsAt, new Date(), row.lastShowtimeAt),
    startDate: row.startDate?.toISOString() ?? '', endDate: row.endDate?.toISOString() ?? '',
    venueName: row.venueName ?? null, minPrice: row.minPrice ?? null,
    bookingStartsAt: row.bookingStartsAt?.toISOString() ?? null,
  };
}
