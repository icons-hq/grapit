import { describe, expect, it, vi } from 'vitest';

import { CatalogFreshnessService } from '../catalog-freshness.service.js';
import type { CacheService } from '../cache.service.js';

function createService() {
  const cacheService = {
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    bumpGeneration: vi.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;

  return {
    service: new CatalogFreshnessService(cacheService),
    cacheService,
  };
}

describe('CatalogFreshnessService', () => {
  it('invalidates list, home, and locale-scoped detail caches after performance mutations', async () => {
    const { service, cacheService } = createService();

    await service.invalidatePerformance('performance-1');

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
      'cache:performances:list:*',
    );
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('cache:home:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith(
      'cache:performances:detail:performance-1',
    );
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
      'cache:performances:detail:performance-1:*',
    );
  });

  it('invalidates only list and home caches when no performance id exists yet', async () => {
    const { service, cacheService } = createService();

    await service.invalidatePerformance();

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
      'cache:performances:list:*',
    );
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('cache:home:*');
    expect(cacheService.invalidate).not.toHaveBeenCalled();
  });

  it('invalidates public banner cache with the existing explicit key', async () => {
    const { service, cacheService } = createService();

    await service.invalidateBanners();

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:home:banners');
  });

  it('bumps list, home and detail generations so a racing read cannot republish pre-commit data', async () => {
    const { service, cacheService } = createService();

    await service.invalidatePerformance('performance-1');

    expect(cacheService.bumpGeneration).toHaveBeenCalledWith('catalog:list');
    expect(cacheService.bumpGeneration).toHaveBeenCalledWith('catalog:home');
    expect(cacheService.bumpGeneration).toHaveBeenCalledWith('catalog:detail:performance-1');
    expect(cacheService.bumpGeneration).not.toHaveBeenCalledWith('catalog:banner');
  });

  it('bumps only the banner generation after banner mutations', async () => {
    const { service, cacheService } = createService();

    await service.invalidateBanners();

    expect(cacheService.bumpGeneration).toHaveBeenCalledTimes(1);
    expect(cacheService.bumpGeneration).toHaveBeenCalledWith('catalog:banner');
  });
});
