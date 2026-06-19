import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { BenefitRedemptionService } from './benefit-redemption.service.js';

@Controller('field/benefits')
@UseGuards(RolesGuard)
@Roles('admin')
export class BenefitRedemptionController {
  constructor(private readonly benefitRedemptionService: BenefitRedemptionService) {}

  @Post('redeem')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.scan.consume')
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
