import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { PgbossModule } from '../jobs/pgboss.module.js';
import { HeldCancelledSeatRecoveryWorker } from './held-cancelled-seat-recovery.worker.js';
import { PaymentCancellationFinalizerService } from './payment-cancellation-finalizer.service.js';

@Module({
  imports: [PgbossModule, BookingModule],
  providers: [PaymentCancellationFinalizerService, HeldCancelledSeatRecoveryWorker],
  exports: [PaymentCancellationFinalizerService, HeldCancelledSeatRecoveryWorker],
})
export class CancellationModule {}
