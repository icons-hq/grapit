import { Module } from '@nestjs/common';
import { PgbossModule } from '../jobs/pgboss.module.js';
import { PaymentCancellationFinalizerService } from './payment-cancellation-finalizer.service.js';

@Module({
  imports: [PgbossModule],
  providers: [PaymentCancellationFinalizerService],
  exports: [PaymentCancellationFinalizerService],
})
export class CancellationModule {}
