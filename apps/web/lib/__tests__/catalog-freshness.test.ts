import { describe, expect, it, vi } from 'vitest';

import {
  invalidatePublicBannerQueries,
  invalidatePublicPerformanceQueries,
} from '../catalog-freshness';

function createQueryClient() {
  return {
    invalidateQueries: vi.fn(),
  };
}

describe('catalog freshness query invalidation', () => {
  it('invalidates public performance list, home, and optional detail queries', () => {
    const queryClient = createQueryClient();

    invalidatePublicPerformanceQueries(queryClient, 'performance-1');

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['performances'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['home'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['performance', 'performance-1'],
    });
  });

  it('invalidates the public banner query', () => {
    const queryClient = createQueryClient();

    invalidatePublicBannerQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['home', 'banners'],
    });
  });
});
