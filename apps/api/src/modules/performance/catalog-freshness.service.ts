import { Injectable } from '@nestjs/common';
import {
  catalogFreshnessTargetsForBanners,
  catalogFreshnessTargetsForPerformance,
  type CatalogFreshnessRequest,
} from '@grabit/shared';

import { CacheService } from './cache.service.js';
import { CATALOG_CACHE_GENERATION_SCOPES } from './catalog-cache-keys.js';

@Injectable()
export class CatalogFreshnessService {
  constructor(private readonly cacheService: CacheService) {}

  async invalidatePerformance(performanceId?: string): Promise<void> {
    await this.invalidateTargets(
      catalogFreshnessTargetsForPerformance(performanceId),
    );
  }

  async invalidateBanners(): Promise<void> {
    await this.invalidateTargets(catalogFreshnessTargetsForBanners());
  }

  /**
   * Must run after the DB commit. Bumping the generation makes every reader
   * that started before the commit write into a superseded key, so a late
   * read-through SET cannot republish pre-commit data. The DEL/SCAN pass still
   * runs to free memory and to cover keys written by revisions that predate
   * generation-scoped keys during a rolling deploy.
   */
  private async invalidateTargets(
    targets: CatalogFreshnessRequest[],
  ): Promise<void> {
    const ops = targets.map((request) => {
      switch (request.target) {
        case 'list':
          return Promise.all([
            this.cacheService.bumpGeneration(CATALOG_CACHE_GENERATION_SCOPES.list),
            this.cacheService.invalidatePattern('cache:performances:list:*'),
          ]).then(() => undefined);
        case 'home':
          return Promise.all([
            this.cacheService.bumpGeneration(CATALOG_CACHE_GENERATION_SCOPES.home),
            this.cacheService.invalidatePattern('cache:home:*'),
          ]).then(() => undefined);
        case 'banner':
          return Promise.all([
            this.cacheService.bumpGeneration(CATALOG_CACHE_GENERATION_SCOPES.banner),
            // Legacy unscoped key; generation-scoped banner keys expire on TTL.
            this.cacheService.invalidate('cache:home:banners'),
          ]).then(() => undefined);
        case 'detail':
          return Promise.all([
            this.cacheService.bumpGeneration(
              CATALOG_CACHE_GENERATION_SCOPES.detail(request.performanceId),
            ),
            this.cacheService.invalidate(
              `cache:performances:detail:${request.performanceId}`,
            ),
            this.cacheService.invalidatePattern(
              `cache:performances:detail:${request.performanceId}:*`,
            ),
          ]).then(() => undefined);
      }
    });

    await Promise.all(ops);
  }
}
