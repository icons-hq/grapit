import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PerformanceCardData, PerformanceQuery, PerformanceStatus } from '@grabit/shared';
import { bookingPolicies, performances, priceTiers, venues } from '../../database/schema/index.js';

export const publicCatalogCardSelection = {
  id: performances.id, title: performances.title, genre: performances.genre,
  posterUrl: performances.posterUrl, status: performances.status,
  bookingStartsAt: bookingPolicies.bookingStartsAt,
  startDate: performances.startDate, endDate: performances.endDate, venueName: venues.name,
  minPrice: sql<number | null>`(select min(${priceTiers.price}) from ${priceTiers} where ${priceTiers.performanceId} = ${performances.id})`,
};

export function resolveEffectivePerformanceStatus(
  status: PerformanceStatus, bookingStartsAt: Date | string | null | undefined, now = new Date(),
): PerformanceStatus {
  if (status !== 'upcoming' || !bookingStartsAt) return status;
  const startsAtMs = new Date(bookingStartsAt).getTime();
  return Number.isFinite(startsAtMs) && startsAtMs <= now.getTime() ? 'selling' : status;
}

export function publicCatalogStatusCondition(status: PerformanceQuery['status'], now = new Date()) {
  if (status === 'selling') return or(inArray(performances.status, ['selling', 'closing_soon']),
    and(eq(performances.status, 'upcoming'), lte(bookingPolicies.bookingStartsAt, now)));
  if (status === 'upcoming') return and(eq(performances.status, 'upcoming'),
    or(isNull(bookingPolicies.bookingStartsAt), gt(bookingPolicies.bookingStartsAt, now)));
  if (status === 'ended') return eq(performances.status, 'ended');
  return undefined;
}

type CatalogCardRow = Pick<typeof performances.$inferSelect,
  'id' | 'title' | 'genre' | 'posterUrl' | 'status' | 'startDate' | 'endDate'> & {
    bookingStartsAt?: Date | null; venueName: string | null; minPrice?: number | null;
  };

export function mapPublicCatalogCard(row: CatalogCardRow): PerformanceCardData {
  return {
    id: row.id, title: row.title, genre: row.genre, posterUrl: row.posterUrl,
    status: resolveEffectivePerformanceStatus(row.status, row.bookingStartsAt),
    startDate: row.startDate?.toISOString() ?? '', endDate: row.endDate?.toISOString() ?? '',
    venueName: row.venueName ?? null, minPrice: row.minPrice ?? null,
    bookingStartsAt: row.bookingStartsAt?.toISOString() ?? null,
  };
}
