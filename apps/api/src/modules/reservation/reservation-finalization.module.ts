import { Module } from '@nestjs/common';

import { BookingModule } from '../booking/booking.module.js';
import { PgbossModule } from '../jobs/pgboss.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { PaymentConfirmReconcileWorker } from './payment-confirm-reconcile.worker.js';
import { ReservationFinalizationService } from './reservation-finalization.service.js';

/**
 * Payment confirm finalization and its reconcile job. Imported by the API
 * (ReservationModule) and by the bounded background worker, so reconcile
 * jobs run in whichever process pg-boss processes jobs.
 */
@Module({
  imports: [PaymentModule, BookingModule, TicketModule, PgbossModule],
  providers: [ReservationFinalizationService, PaymentConfirmReconcileWorker],
  exports: [ReservationFinalizationService],
})
export class ReservationFinalizationModule {}
