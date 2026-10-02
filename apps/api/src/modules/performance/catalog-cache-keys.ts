/**
 * Generation scopes for public catalog caches. Readers embed the scope's
 * current token in their cache key; CatalogFreshnessService bumps the token
 * after every committed mutation (see CacheService.getGeneration).
 */
export const CATALOG_CACHE_GENERATION_SCOPES = {
  list: 'catalog:list',
  home: 'catalog:home',
  banner: 'catalog:banner',
  detail: (performanceId: string) => `catalog:detail:${performanceId}`,
} as const;
