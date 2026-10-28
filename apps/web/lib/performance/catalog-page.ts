import { PERFORMANCE_QUERY_MAX_PAGE } from '@grabit/shared';

/** Keep the browser's list request within the API's bounded cache-key space. */
export function clampCatalogPage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), PERFORMANCE_QUERY_MAX_PAGE);
}
