import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { FieldCheckInService } from './field-check-in.service.js';

@Controller('field/check-in')
@UseGuards(RolesGuard)
@Roles('admin')
export class FieldCheckInController {
  constructor(private readonly fieldCheckInService: FieldCheckInService) {}

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
