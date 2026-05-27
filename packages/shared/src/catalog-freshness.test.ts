import { describe, expect, it } from 'vitest';

import {
  CATALOG_FRESHNESS_TARGETS,
  catalogFreshnessTargetsForBanners,
  catalogFreshnessTargetsForPerformance,
} from './catalog-freshness';

describe('catalog freshness vocabulary', () => {
  it('names the public catalog targets shared by API and web invalidation', () => {
    expect(CATALOG_FRESHNESS_TARGETS).toEqual([
      'list',
      'detail',
      'home',
      'banner',
    ]);
  });

  it('resolves performance mutations to list, home, and optional detail targets', () => {
    expect(catalogFreshnessTargetsForPerformance()).toEqual([
      { target: 'list' },
      { target: 'home' },
    ]);
    expect(catalogFreshnessTargetsForPerformance('performance-1')).toEqual([
      { target: 'list' },
      { target: 'home' },
      { target: 'detail', performanceId: 'performance-1' },
    ]);
  });

  it('resolves banner mutations to the banner freshness target', () => {
    expect(catalogFreshnessTargetsForBanners()).toEqual([
      { target: 'banner' },
    ]);
  });
});
