import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceController } from '../performance.controller.js';

describe('PerformanceController public detail (u17 cache keys x w3 status)', () => {
  it('reads an upper-case UUID through the same lower-case cache identity', async () => {
    const findById = vi.fn().mockResolvedValue({
      id: '0b9f2d4e-7c1a-4f3e-9a2b-1c2d3e4f5a6b',
      status: 'selling',
      bookingStartsAt: null,
    });
    const controller = new PerformanceController({ findById } as never);

    await controller.getPerformance('0B9F2D4E-7C1A-4F3E-9A2B-1C2D3E4F5A6B', { locale: 'ko' } as never);

    // catalog freshness invalidates only this spelling; a second spelling would
    // be a separate cache entry that survives the withdrawal.
    expect(findById).toHaveBeenCalledWith('0b9f2d4e-7c1a-4f3e-9a2b-1c2d3e4f5a6b', 'ko');
  });

  it('still rejects a malformed id before any lookup', async () => {
    const findById = vi.fn();
    const controller = new PerformanceController({ findById } as never);

    await expect(controller.getPerformance('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    expect(findById).not.toHaveBeenCalled();
  });
});
