import { Injectable } from '@nestjs/common';
import {
  catalogFreshnessTargetsForBanners,
  catalogFreshnessTargetsForPerformance,
  type CatalogFreshnessRequest,
} from '@grabit/shared';

import { CacheService } from './cache.service.js';

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

  private async invalidateTargets(
    targets: CatalogFreshnessRequest[],
  ): Promise<void> {
    const ops = targets.map((request) => {
      switch (request.target) {
        case 'list':
          return this.cacheService.invalidatePattern('cache:performances:list:*');
        case 'home':
          return this.cacheService.invalidatePattern('cache:home:*');
        case 'banner':
          return this.cacheService.invalidate('cache:home:banners');
        case 'detail':
          return Promise.all([
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
