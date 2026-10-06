import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  fieldCheckInConsumeRequestSchema,
  fieldCheckInVerifyRequestSchema,
  type FieldCheckInConsumeRequest,
  type FieldCheckInVerifyRequest,
} from '@grabit/shared';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { ROUTE_THROTTLES } from '../traffic/route-throttles.js';
import { FieldCheckInService } from './field-check-in.service.js';

@Controller('field/check-in')
@UseGuards(RolesGuard)
@Roles('admin')
// Shared scanner accounts run several gate devices at once; bucket per account
// and network with gate-peak headroom instead of the 60/min default.
@Throttle({ default: ROUTE_THROTTLES.fieldOperations })
export class FieldCheckInController {
  constructor(private readonly fieldCheckInService: FieldCheckInService) {}

  @Get('showtimes')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.scan.verify')
  listShowtimes() {
    return this.fieldCheckInService.listShowtimes();
  }

  @Post('verify')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.scan.verify')
  async verify(
    @CurrentUser('id') scannerUserId: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(fieldCheckInVerifyRequestSchema))
    body: FieldCheckInVerifyRequest,
  ) {
    return this.fieldCheckInService.verify(body, {
      scannerUserId,
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
    });
  }

  @Post('consume')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.scan.consume')
  async consume(
    @CurrentUser('id') scannerUserId: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(fieldCheckInConsumeRequestSchema))
    body: FieldCheckInConsumeRequest,
  ) {
    return this.fieldCheckInService.consume(body, {
      scannerUserId,
      deviceAttemptId: body.deviceAttemptId,
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
