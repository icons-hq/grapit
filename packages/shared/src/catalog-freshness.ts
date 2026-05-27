export const CATALOG_FRESHNESS_TARGETS = [
  'list',
  'detail',
  'home',
  'banner',
] as const;

export type CatalogFreshnessTarget = typeof CATALOG_FRESHNESS_TARGETS[number];

export type CatalogFreshnessRequest =
  | { target: 'list' }
  | { target: 'home' }
  | { target: 'banner' }
  | { target: 'detail'; performanceId: string };

export function catalogFreshnessTargetsForPerformance(
  performanceId?: string,
): CatalogFreshnessRequest[] {
  const targets: CatalogFreshnessRequest[] = [
    { target: 'list' },
    { target: 'home' },
  ];

  if (performanceId) {
    targets.push({ target: 'detail', performanceId });
  }

  return targets;
}

export function catalogFreshnessTargetsForBanners(): CatalogFreshnessRequest[] {
  return [{ target: 'banner' }];
}
