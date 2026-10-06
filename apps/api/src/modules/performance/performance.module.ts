import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { PerformanceController } from './performance.controller.js';
import { PerformanceService } from './performance.service.js';
import { CacheService } from './cache.service.js';
import { CatalogFreshnessService } from './catalog-freshness.service.js';
import { PerformanceViewCounter } from './performance-view-counter.service.js';

@Module({
  imports: [BookingModule],
  controllers: [PerformanceController],
  providers: [
    PerformanceService,
    CacheService,
    CatalogFreshnessService,
    PerformanceViewCounter,
  ],
  exports: [PerformanceService, CacheService, CatalogFreshnessService],
})
export class PerformanceModule {}
