import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrewarmService } from '../ops/prewarm.service.js';
import { PendingPaymentExpirationWorker } from './pending-payment-expiration.worker.js';

@Controller('internal/virtual-account')
export class DepositVerificationController {
  constructor(private readonly scheduler: PrewarmService, private readonly worker: PendingPaymentExpirationWorker) {}

  @Public()
  @SkipThrottle()
  @Post('verify-deposits')
  @HttpCode(200)
  async verifyDueDeposits(@Req() request: Request) {
    await this.scheduler.authorizeDepositScheduler(request);
    return this.worker.sweepVirtualAccounts(new Date(), true);
  }
}
