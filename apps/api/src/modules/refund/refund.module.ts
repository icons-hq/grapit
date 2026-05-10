import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { PgbossModule } from '../jobs/pgboss.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { RefundController } from './refund.controller.js';
import { RefundService } from './refund.service.js';

@Module({
  imports: [PaymentModule, PgbossModule, JobsModule],
  controllers: [RefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
