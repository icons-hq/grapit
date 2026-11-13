import { Module } from '@nestjs/common';
import { AnalyticsDatabaseModule } from './analytics-database.module.js';
import { AnalyticsController, AdminAnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsReportService } from './analytics-report.service.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { RedisModule } from '../booking/providers/redis.module.js';
import { AnalyticsVisitorService } from './analytics-visitor.service.js';
import { AudienceController, AdminAudienceController } from './audience.controller.js';
import { AudienceService } from './audience.service.js';
import { CreativeReportService } from './creative-report.service.js';
import { Ga4InterestService } from './ga4-interest.service.js';
@Module({ imports: [AnalyticsDatabaseModule, FeatureFlagsModule, RedisModule],
  controllers: [AnalyticsController, AdminAnalyticsController, AudienceController, AdminAudienceController],
  providers: [AnalyticsService, AnalyticsReportService, AnalyticsVisitorService, AudienceService, CreativeReportService, Ga4InterestService] })
export class AnalyticsModule {}
