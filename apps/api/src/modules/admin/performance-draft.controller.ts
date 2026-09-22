import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { applyPerformanceDraftSchema, createPerformanceDraftSchema, savePerformanceDraftSchema, type CreatePerformanceDraftInput, type SavePerformanceDraftInput } from '@grabit/shared';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PerformanceDraftService } from './performance-draft.service.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';

@Controller('admin/performance-drafts')
@Roles('admin')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@AdminCapabilities('event.write')
export class PerformanceDraftController {
  constructor(private readonly drafts: PerformanceDraftService) {}

  @Post()
  create(@CurrentUser('id') owner: string, @Body(new ZodValidationPipe(createPerformanceDraftSchema)) input: CreatePerformanceDraftInput) {
    return this.drafts.create(owner, input);
  }

  @Get()
  list(@CurrentUser('id') owner: string, @Query('performanceId', new ParseUUIDPipe({ optional: true })) performanceId?: string) {
    return this.drafts.list(owner, performanceId);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') owner: string) {
    return this.drafts.get(id, owner);
  }

  @Put(':id')
  save(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') owner: string,
    @Body(new ZodValidationPipe(savePerformanceDraftSchema)) input: SavePerformanceDraftInput) {
    return this.drafts.save(id, owner, input);
  }

  @Post(':id/apply')
  apply(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') owner: string,
    @Body(new ZodValidationPipe(applyPerformanceDraftSchema)) input: { expectedRevision: number }, @Req() req: Request) {
    return this.drafts.apply(id, input.expectedRevision, { actorUserId: owner, reason: '검수한 공연 초안 반영',
      ipAddress: resolveTrustedRequestIp(req), userAgent: req.get('user-agent'), requestId: req.get('x-request-id') });
  }
}
