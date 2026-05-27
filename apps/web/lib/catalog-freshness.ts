import {
  catalogFreshnessTargetsForBanners,
  catalogFreshnessTargetsForPerformance,
  type CatalogFreshnessRequest,
} from '@grabit/shared';

type QueryInvalidator = {
  invalidateQueries(input: { queryKey: readonly unknown[] }): unknown;
};

export function invalidatePublicPerformanceQueries(
  queryClient: QueryInvalidator,
  performanceId?: string,
) {
  invalidateCatalogFreshnessRequests(
    queryClient,
    catalogFreshnessTargetsForPerformance(performanceId),
  );
}

export function invalidatePublicBannerQueries(queryClient: QueryInvalidator) {
  invalidateCatalogFreshnessRequests(
    queryClient,
    catalogFreshnessTargetsForBanners(),
  );
}

function invalidateCatalogFreshnessRequests(
  queryClient: QueryInvalidator,
  requests: CatalogFreshnessRequest[],
) {
  for (const request of requests) {
    switch (request.target) {
      case 'list':
        queryClient.invalidateQueries({ queryKey: ['performances'] });
        break;
      case 'home':
        queryClient.invalidateQueries({ queryKey: ['home'] });
        break;
      case 'banner':
        queryClient.invalidateQueries({ queryKey: ['home', 'banners'] });
        break;
      case 'detail':
        queryClient.invalidateQueries({
          queryKey: ['performance', request.performanceId],
        });
        break;
    }
  }
}
