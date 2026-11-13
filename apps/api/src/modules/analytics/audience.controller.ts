import { Body, Controller, Delete, Get, Header, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  audiencePerformanceTagsSchema, audiencePreferencesInputSchema, audienceProfilesQuerySchema, audienceQuerySchema, audienceTagInputSchema,
  type AudiencePreferencesInput, type AudienceProfilesQuery, type AudienceQuery, type AudienceTagInput,
} from '@grabit/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AudienceService } from './audience.service.js';
import { CreativeReportService } from './creative-report.service.js';
import { Ga4InterestService } from './ga4-interest.service.js';

@Controller('analytics/audience')
export class AudienceController {
  constructor(@Inject(AudienceService) private readonly audience: AudienceService, @Inject(Ga4InterestService) private readonly ga4: Ga4InterestService) {}
  @Public() @Get('catalog') @Header('Cache-Control', 'no-store')
  catalog() { return this.audience.tags(); }
  @Public() @Get('ga4-config') @Header('Cache-Control', 'no-store')
  config() { return this.ga4.publicConfig(); }
  @Get('me') @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: RequestUser) { return this.audience.preferences(user.id); }
  @Put('me') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Header('Cache-Control', 'no-store')
  save(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(audiencePreferencesInputSchema)) input: AudiencePreferencesInput) { return this.audience.savePreferences(user.id, input); }
  @Delete('me') @Header('Cache-Control', 'no-store')
  withdraw(@CurrentUser() user: RequestUser) { return this.audience.withdraw(user.id); }
}

@Controller('admin/analytics/audience') @UseGuards(RolesGuard, AdminCapabilitiesGuard) @Roles('admin')
export class AdminAudienceController {
  constructor(@Inject(AudienceService) private readonly audience: AudienceService,
    @Inject(CreativeReportService) private readonly creatives: CreativeReportService, @Inject(Ga4InterestService) private readonly ga4: Ga4InterestService) {}
  @Get('overview') @AdminCapabilities('audit.read') @Header('Cache-Control', 'no-store')
  overview() { return this.audience.overview(); }
  @Get('tags') @AdminCapabilities('audit.read') @Header('Cache-Control', 'no-store')
  tags() { return this.audience.tags(true); }
  @Post('tags') @AdminCapabilities('security.manage')
  createTag(@CurrentUser() actor: RequestUser, @Body(new ZodValidationPipe(audienceTagInputSchema)) input: AudienceTagInput) { return this.audience.saveTag(input, actor.id); }
  @Put('tags/:id') @AdminCapabilities('security.manage')
  updateTag(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: RequestUser, @Body(new ZodValidationPipe(audienceTagInputSchema)) input: AudienceTagInput) { return this.audience.saveTag(input, actor.id, id); }
  @Get('performances') @AdminCapabilities('security.manage') @Header('Cache-Control', 'no-store')
  performances() { return this.audience.performances(); }
  @Put('performances/:id/tags') @AdminCapabilities('security.manage')
  saveTags(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: RequestUser, @Body(new ZodValidationPipe(audiencePerformanceTagsSchema)) input: { tagIds: string[] }) { return this.audience.savePerformanceTags(id, input.tagIds, actor.id); }
  @Get('profiles') @AdminCapabilities('audit.read', 'security.manage') @Header('Cache-Control', 'no-store')
  profiles(@Query(new ZodValidationPipe(audienceProfilesQuerySchema)) query: AudienceProfilesQuery) { return this.audience.profiles(query); }
  @Get('profiles/:id') @AdminCapabilities('audit.read', 'security.manage') @Header('Cache-Control', 'no-store')
  profile(@Param('id', new ParseUUIDPipe()) id: string) { return this.audience.profile(id); }
  @Get('creatives') @AdminCapabilities('audit.read') @Header('Cache-Control', 'no-store')
  creativeReport(@Query(new ZodValidationPipe(audienceQuerySchema)) query: AudienceQuery) { return this.creatives.report(query); }
  @Get('ga4') @AdminCapabilities('audit.read') @Header('Cache-Control', 'no-store')
  googleReport(@Query(new ZodValidationPipe(audienceQuerySchema)) query: AudienceQuery) { return this.ga4.report(query); }
}
