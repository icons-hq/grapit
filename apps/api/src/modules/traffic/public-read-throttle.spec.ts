import { describe, expect, it } from 'vitest';
import { HealthController } from '../../health/health.controller.js';
import { BookingController } from '../booking/booking.controller.js';
import { PerformanceController } from '../performance/performance.controller.js';
import { SearchController } from '../search/search.controller.js';

const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';

describe('public read endpoint throttling', () => {
  it('skips the coarse default throttler for catalog read endpoints', () => {
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, PerformanceController)).toBe(true);
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, SearchController)).toBe(true);
  });

  it('skips the coarse default throttler for health reads', () => {
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, HealthController.prototype.check)).toBe(true);
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, HealthController.prototype.live)).toBe(true);
  });

  it('keeps public seat status reads on a dedicated default-throttler budget (audit #8)', () => {
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, BookingController.prototype.getSeatStatus))
      .toBeUndefined();
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', BookingController.prototype.getSeatStatus))
      .toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', BookingController.prototype.getSeatStatus))
      .toBe(10_000);
    expect(Reflect.getMetadata('THROTTLER:TRACKERdefault', BookingController.prototype.getSeatStatus))
      .toEqual(expect.any(Function));
  });

  it('keeps write-side booking throttling eligible for the global guard', () => {
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, BookingController.prototype.lockSeat))
      .toBeUndefined();
  });
});
