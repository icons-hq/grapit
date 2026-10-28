import { eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { PerformanceQuery } from '@grabit/shared';
import { performances, venues } from '../../database/schema/index.js';

const REGION_PREFIXES: Record<string, string> = {
  충북: '충청북', 충남: '충청남', 전북: '전라북', 전남: '전라남',
  경북: '경상북', 경남: '경상남',
};

/** Filters run before count/pagination; calendar dates always mean Korea time. */
export function catalogFilterConditions(
  query: Pick<PerformanceQuery, 'region' | 'venueId' | 'dateFrom' | 'dateTo'>,
): SQL[] {
  const conditions: SQL[] = [];
  if (query.venueId) conditions.push(eq(performances.venueId, query.venueId));
  if (query.region) {
    // Jeonbuk's official address prefix changed; accept both stored spellings.
    conditions.push(query.region === '전북'
      ? sql`(${venues.address} ilike '전북%' or ${venues.address} ilike '전라북%')`
      : ilike(venues.address, `${REGION_PREFIXES[query.region] ?? query.region}%`));
  }
  if (query.dateFrom) conditions.push(sql`${performances.endDate} >= ${`${query.dateFrom}T00:00:00+09:00`}::timestamptz`);
  if (query.dateTo) conditions.push(sql`${performances.startDate} < ${`${query.dateTo}T00:00:00+09:00`}::timestamptz + interval '1 day'`);
  // An inverted range returns no rows instead of silently broadening the search.
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) conditions.push(sql`false`);
  return conditions;
}
