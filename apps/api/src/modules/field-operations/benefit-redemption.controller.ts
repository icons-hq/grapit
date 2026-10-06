import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  benefitRedemptionRequestSchema,
  type BenefitRedemptionRequest,
  type BenefitRedemptionResponse,
} from '@grabit/shared';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { ROUTE_THROTTLES } from '../traffic/route-throttles.js';
import { BenefitRedemptionService } from './benefit-redemption.service.js';

@Controller('field/benefits')
@UseGuards(RolesGuard)
@Roles('admin')
// Shared scanner accounts run several gate devices at once; bucket per account
// and network with gate-peak headroom instead of the 60/min default.
@Throttle({ default: ROUTE_THROTTLES.fieldOperations })
export class BenefitRedemptionController {
  constructor(private readonly benefitRedemptionService: BenefitRedemptionService) {}

  @Post('redeem')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.benefits.redeem')
  async redeem(
    @CurrentUser('id') scannerUserId: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(benefitRedemptionRequestSchema))
    body: BenefitRedemptionRequest,
  ): Promise<BenefitRedemptionResponse> {
    return this.benefitRedemptionService.redeem(body, {
      scannerUserId,
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
