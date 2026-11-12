import { Module } from '@nestjs/common';
import { AnalyticsDatabaseModule } from './analytics-database.module.js';
import { AnalyticsController, AdminAnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsReportService } from './analytics-report.service.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { RedisModule } from '../booking/providers/redis.module.js';
import { AnalyticsVisitorService } from './analytics-visitor.service.js';
@Module({ imports: [AnalyticsDatabaseModule, FeatureFlagsModule, RedisModule], controllers: [AnalyticsController, AdminAnalyticsController], providers: [AnalyticsService, AnalyticsReportService, AnalyticsVisitorService] })
export class AnalyticsModule {}
