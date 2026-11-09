import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { benefitRedemptionRequestSchema, type BenefitRedemptionRequest } from '@grabit/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BenefitRedemptionService } from './benefit-redemption.service.js';

/**
 * Authenticated buyer-device confirmation. The global JWT guard authenticates
 * the account and the service checks ownership. This is deliberately separate
 * from scanner redemption: a person tapping the buyer's phone is not authenticated
 * as staff, and audit records must never claim otherwise.
 */
@Controller('tickets/benefits')
export class BuyerBenefitRedemptionController {
  constructor(private readonly benefitRedemptionService: BenefitRedemptionService) {}

  @Post('redeem')
  // One buyer can present four tickets, each with included and purchased
  // coupons. Leave room for consecutive field handoffs and safe retries.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  redeem(
    @CurrentUser('id') buyerUserId: string,
    @Body(new ZodValidationPipe(benefitRedemptionRequestSchema)) input: BenefitRedemptionRequest,
  ) {
    return this.benefitRedemptionService.redeemForBuyer(input, buyerUserId);
  }
}
