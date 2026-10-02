import { Injectable, Logger } from '@nestjs/common';
import {
  catalogFreshnessTargetsForBanners,
  catalogFreshnessTargetsForPerformance,
  type CatalogFreshnessRequest,
} from '@grabit/shared';

import { CacheService } from './cache.service.js';
import { CATALOG_CACHE_GENERATION_SCOPES } from './catalog-cache-keys.js';

/** One short retry covers a transient Valkey write failure after commit. */
export const CATALOG_GENERATION_BUMP_RETRY_DELAY_MS = 200;

@Injectable()
export class CatalogFreshnessService {
  private readonly logger = new Logger(CatalogFreshnessService.name);

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
   * read-through SET cannot republish pre-commit data. The DEL/SCAN pass also
   * removes the current keys (and keys written by revisions that predate
   * generation-scoped keys during a rolling deploy), so a failed bump alone
   * does not keep serving the old payload.
   */
  private async invalidateTargets(
    targets: CatalogFreshnessRequest[],
  ): Promise<void> {
    const ops = targets.map((request) => {
      switch (request.target) {
        case 'list':
          return Promise.all([
            this.bumpGeneration(CATALOG_CACHE_GENERATION_SCOPES.list),
            this.cacheService.invalidatePattern('cache:performances:list:*'),
          ]).then(() => undefined);
        case 'home':
          return Promise.all([
            this.bumpGeneration(CATALOG_CACHE_GENERATION_SCOPES.home),
            this.cacheService.invalidatePattern('cache:home:*'),
          ]).then(() => undefined);
        case 'banner':
          return Promise.all([
            this.bumpGeneration(CATALOG_CACHE_GENERATION_SCOPES.banner),
            // Legacy unscoped key and the generation-scoped banner keys.
            this.cacheService.invalidate('cache:home:banners'),
            this.cacheService.invalidatePattern('cache:home:banners:*'),
          ]).then(() => undefined);
        case 'detail':
          return Promise.all([
            this.bumpGeneration(
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

  /**
   * A detail cache hit does not re-check visibility in PostgreSQL, so a lost
   * bump matters most for unpublish/delete. Retry once, then log an error:
   * the public catalog can serve the old payload until TTL (at most 300s)
   * unless an operator saves the item again once Valkey accepts writes.
   */
  private async bumpGeneration(scope: string): Promise<void> {
    if (await this.cacheService.bumpGeneration(scope)) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CATALOG_GENERATION_BUMP_RETRY_DELAY_MS);
    });
    if (await this.cacheService.bumpGeneration(scope)) return;
    this.logger.error(
      { scope, op: 'bumpGeneration' },
      'catalog cache generation bump failed after retry — public catalog may stay stale until TTL; re-save the item after Valkey recovers',
    );
  }
}
