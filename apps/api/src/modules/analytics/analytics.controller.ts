import { z } from 'zod';
import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { analyticsCountsSchema, analyticsBatchSchema, analyticsIdentifySchema, analyticsQuerySchema, analyticsSettingsSchema, type AnalyticsCounts, type AnalyticsBatch, type AnalyticsQuery } from '@grabit/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { getFrontendOrigins } from '../../config/frontend-origins.js';
import { ROUTE_THROTTLES } from '../traffic/route-throttles.js';
import { analyticsCursorSchema, analyticsReplayBatchSchema, analyticsVisitorsQuerySchema, type AnalyticsReplayBatch, type AnalyticsVisitorsQuery } from '@grabit/shared';
import { AnalyticsVisitorService } from './analytics-visitor.service.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsReportService } from './analytics-report.service.js';

export function ignoresAnalyticsRequest(req: Request) {
  return /bot|crawler|spider|headless|lighthouse/i.test(req.get('user-agent') ?? '') || req.get('dnt') === '1' || req.get('sec-gpc') === '1'
    || /prefetch/i.test(req.get('purpose') ?? req.get('sec-purpose') ?? '') || req.get('next-router-prefetch') === '1';
}
function assertOrigin(req: Request) {
  if (!getFrontendOrigins(process.env['FRONTEND_URL']).includes(req.get('origin') ?? '')) throw new ForbiddenException('허용되지 않은 출처입니다');
}
@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}
  @Public() @Get('config') @Header('Cache-Control', 'no-store')
  config() { return this.service.config(); }

  @Public() @Post('counts') @HttpCode(204) @Throttle({ default: ROUTE_THROTTLES.analyticsEvents })
  async counts(@Req() req: Request, @Body(new ZodValidationPipe(analyticsCountsSchema)) batch: AnalyticsCounts) {
    assertOrigin(req); if (ignoresAnalyticsRequest(req)) return;
    await this.service.collectCounts(batch);
  }

  @Public() @Post('events') @HttpCode(204) @Throttle({ default: ROUTE_THROTTLES.analyticsEvents })
  async collect(@Req() req: Request, @Body(new ZodValidationPipe(analyticsBatchSchema)) batch: AnalyticsBatch) {
    assertOrigin(req); if (ignoresAnalyticsRequest(req)) return;
    await this.service.collect(batch);
  }
  @Public() @Post('replay') @HttpCode(200) @Throttle({ default: ROUTE_THROTTLES.analyticsEvents })
  async replay(@Req() req: Request, @Body(new ZodValidationPipe(analyticsReplayBatchSchema)) batch: AnalyticsReplayBatch) {
    assertOrigin(req); if (ignoresAnalyticsRequest(req)) return { stored: false };
    return this.service.collectReplay(batch);
  }
  @Post('identify') @HttpCode(200) @Throttle({ default: ROUTE_THROTTLES.analyticsIdentify })
  async identify(@Req() req: Request, @CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(analyticsIdentifySchema)) input: { visitorId: string; sessionId: string; consentVersion: string }) {
    assertOrigin(req); if (ignoresAnalyticsRequest(req)) return { linked: false };
    return { linked: await this.service.identify(input, user) };
  }
  @Public() @Post('withdraw') @HttpCode(200) @Throttle({ default: ROUTE_THROTTLES.analyticsIdentify })
  withdraw(@Req() req: Request, @Body(new ZodValidationPipe(analyticsIdentifySchema)) input: { visitorId: string; sessionId: string }) {
    assertOrigin(req); return this.service.withdraw(input);
  }
}
@Controller('admin/analytics') @UseGuards(RolesGuard, AdminCapabilitiesGuard) @Roles('admin')
export class AdminAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService, @Inject(AnalyticsReportService) private readonly reports: AnalyticsReportService, @Inject(AnalyticsVisitorService) private readonly visitors: AnalyticsVisitorService) {}
  @Get() @AdminCapabilities('audit.read') @Header('Cache-Control', 'no-store')
  report(@Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery) { return this.reports.report(query); }
  @Get('visitors') @AdminCapabilities('audit.read', 'security.manage') @Header('Cache-Control', 'no-store')
  sessions(@Query(new ZodValidationPipe(analyticsVisitorsQuerySchema)) query: AnalyticsVisitorsQuery) { return this.visitors.sessions(query); }
  @Get('sessions/:id') @AdminCapabilities('audit.read', 'security.manage') @Header('Cache-Control', 'no-store')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(z.object({ before: analyticsCursorSchema.optional() }).strict())) query: { before?: string }) { return this.visitors.detail(id, query.before); }
  @Get('replays/:id') @AdminCapabilities('audit.read', 'security.manage') @Header('Cache-Control', 'no-store')
  replay(@Param('id', new ParseUUIDPipe()) id: string) { return this.visitors.replay(id); }
  @Put('aggregate-settings') @AdminCapabilities('security.manage')
  aggregateSettings(@CurrentUser() actor: RequestUser, @Body(new ZodValidationPipe(z.object({ enabled: z.boolean() }).strict())) input: { enabled: boolean }) { return this.service.configureAggregate(input.enabled, actor); }
  @Put('settings') @AdminCapabilities('security.manage')
  settings(@CurrentUser() actor: RequestUser, @Body(new ZodValidationPipe(analyticsSettingsSchema)) input: { enabled: boolean }) { return this.service.configure(input.enabled, actor); }
}
