import { GENRES, PERFORMANCE_REGIONS, type PerformanceQuery } from '@grabit/shared';
import { clampCatalogPage } from './catalog-page';

export function getCatalogOptions(params: Pick<URLSearchParams, 'get'>): Partial<PerformanceQuery> {
  const genre = params.get('genre');
  const sort = params.get('sort');
  const status = params.get('status');
  const region = params.get('region');
  return {
    page: clampCatalogPage(Number(params.get('page') ?? '1')),
    genre: GENRES.find((value) => value === genre),
    sort: sort === 'popular' || sort === 'opening' || sort === 'date' ? sort : 'latest',
    status: status === 'selling' || status === 'upcoming' || status === 'ended' ? status : 'all',
    ended: params.get('ended') !== 'false',
    region: PERFORMANCE_REGIONS.find((value) => value === region),
    venueId: /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(params.get('venueId') ?? '') ? params.get('venueId')! : undefined,
    dateFrom: validDate(params.get('dateFrom')),
    dateTo: validDate(params.get('dateTo')),
  };
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
