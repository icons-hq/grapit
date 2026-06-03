import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { CancellationModule } from '../cancellation/cancellation.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { CancelledSeatReleaseWorker } from './cancelled-seat-release.worker.js';
import { PgbossModule } from './pgboss.module.js';
import { RefundCancelRetryWorker } from './refund-cancel-retry.worker.js';

@Module({
  imports: [PgbossModule, PaymentModule, CancellationModule, BookingModule],
  providers: [CancelledSeatReleaseWorker, RefundCancelRetryWorker],
  exports: [CancelledSeatReleaseWorker, RefundCancelRetryWorker],
})
export class JobsModule {}
