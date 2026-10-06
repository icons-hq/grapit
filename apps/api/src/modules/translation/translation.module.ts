import { Module } from '@nestjs/common';
import { PerformanceModule } from '../performance/performance.module.js';
import { DeepLClient } from './deepl.client.js';
import { TranslationController } from './translation.controller.js';
import { TranslationService } from './translation.service.js';

@Module({
  // CatalogFreshnessService: publishing a performance translation must
  // invalidate the cached public catalog that overlays it.
  imports: [PerformanceModule],
  controllers: [TranslationController],
  providers: [DeepLClient, TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
