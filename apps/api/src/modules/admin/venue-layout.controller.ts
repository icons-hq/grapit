import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createVenueLayoutSchema, type CreateVenueLayoutInput, type AdminCapabilityUser } from '@grabit/shared';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { VenueLayoutService } from './venue-layout.service.js';

@Controller('admin/venue-layouts')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('event.write')
export class VenueLayoutController {
  constructor(private readonly layouts: VenueLayoutService) {}

  @Get()
  list(@Query('venueName') venueName = '') { return this.layouts.list(venueName); }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.layouts.get(id); }

  @Post()
  create(@Body(new ZodValidationPipe(createVenueLayoutSchema)) input: CreateVenueLayoutInput,
    @Req() req: Request & { user?: AdminCapabilityUser }) {
    return this.layouts.create(input, { actorUserId: req.user!.id,
      ipAddress: resolveTrustedRequestIp(req), userAgent: req.get('user-agent') ?? null,
      requestId: req.get('x-request-id') ?? null });
  }
}
