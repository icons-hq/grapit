import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module.js';
import { CancelledSeatReleaseWorker } from './cancelled-seat-release.worker.js';
import { PgbossModule } from './pgboss.module.js';
import { RefundCancelRetryWorker } from './refund-cancel-retry.worker.js';

@Module({
  imports: [PgbossModule, PaymentModule],
  providers: [CancelledSeatReleaseWorker, RefundCancelRetryWorker],
  exports: [CancelledSeatReleaseWorker, RefundCancelRetryWorker],
})
export class JobsModule {}
