import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module.js';
import { CancelledSeatReleaseWorker } from './cancelled-seat-release.worker.js';
import { pgbossProvider } from './pgboss.provider.js';
import { RefundCancelRetryWorker } from './refund-cancel-retry.worker.js';

@Module({
  imports: [PaymentModule],
  providers: [pgbossProvider, CancelledSeatReleaseWorker, RefundCancelRetryWorker],
  exports: [pgbossProvider, CancelledSeatReleaseWorker, RefundCancelRetryWorker],
})
export class JobsModule {}
