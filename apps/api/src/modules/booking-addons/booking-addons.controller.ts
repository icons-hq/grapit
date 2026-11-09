import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { bookingAddonDefinitionSchema, type BookingAddonDefinition } from '@grabit/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';
import { BookingAddonsService, type AddonActor } from './booking-addons.service.js';

const holdSchema = z.object({ showtimeId: z.string().uuid(), addonId: z.string().uuid(), seatKey: z.string().min(1).max(120), selected: z.boolean() }).strict();
type ActorRequest = Request & { user: AddonActor };

@Controller()
export class BookingAddonsController {
  constructor(private readonly addons: BookingAddonsService) {}

  @Get('booking/addons/:showtimeId')
  snapshot(@Param('showtimeId', new ParseUUIDPipe()) id: string, @Req() req: ActorRequest) {
    return this.addons.snapshot(id, req.user);
  }

  @Put('booking/addons/holds')
  @UseGuards(AdmissionGuard)
  hold(@Body(new ZodValidationPipe(holdSchema)) body: z.infer<typeof holdSchema>, @Req() req: ActorRequest) {
    return this.addons.setHold(body.showtimeId, body.addonId, body.seatKey, body.selected, req.user);
  }

  @Put('admin/showtimes/:showtimeId/addons')
  @UseGuards(RolesGuard, AdminCapabilitiesGuard)
  @Roles('admin')
  @AdminCapabilities('event.write')
  save(@Param('showtimeId', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(bookingAddonDefinitionSchema)) body: BookingAddonDefinition, @Req() req: ActorRequest) {
    return this.addons.save(id, body, req.user);
  }
}
