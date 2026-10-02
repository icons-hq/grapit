import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CATALOG_GENERATION_BUMP_RETRY_DELAY_MS,
  CatalogFreshnessService,
} from '../catalog-freshness.service.js';
import type { CacheService } from '../cache.service.js';

function createService() {
  const cacheService = {
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    bumpGeneration: vi.fn().mockResolvedValue(true),
  };

  return {
    service: new CatalogFreshnessService(cacheService as unknown as CacheService),
    cacheService,
  };
}

describe('CatalogFreshnessService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('deletes the legacy and the generation-scoped banner keys after banner mutations', async () => {
    const { service, cacheService } = createService();

    await service.invalidateBanners();

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:home:banners');
    // A failed generation bump must not keep serving a paused banner.
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('cache:home:banners:*');
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

  it('retries a generation bump that Valkey rejected once', async () => {
    vi.useFakeTimers();
    const { service, cacheService } = createService();
    cacheService.bumpGeneration.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const error = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    const invalidation = service.invalidateBanners();
    await vi.advanceTimersByTimeAsync(CATALOG_GENERATION_BUMP_RETRY_DELAY_MS);
    await invalidation;

    expect(cacheService.bumpGeneration).toHaveBeenCalledTimes(2);
    expect(cacheService.bumpGeneration).toHaveBeenNthCalledWith(2, 'catalog:banner');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an error for the operator when the retry also fails', async () => {
    vi.useFakeTimers();
    const { service, cacheService } = createService();
    cacheService.bumpGeneration.mockResolvedValue(false);
    const error = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    const invalidation = service.invalidatePerformance('performance-1');
    await vi.advanceTimersByTimeAsync(CATALOG_GENERATION_BUMP_RETRY_DELAY_MS);
    await expect(invalidation).resolves.toBeUndefined();

    // list, home and detail: one attempt plus one retry each.
    expect(cacheService.bumpGeneration).toHaveBeenCalledTimes(6);
    expect(error).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'catalog:detail:performance-1' }),
      expect.stringContaining('re-save'),
    );
  });
});
