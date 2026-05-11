import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { TossPaymentsClient } from './toss-payments.client.js';
import { PaymentService } from './payment.service.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';

@Module({
  imports: [BookingModule, TicketModule],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [TossPaymentsClient, PaymentService, TossWebhookGuard],
  exports: [TossPaymentsClient, PaymentService],
})
export class PaymentModule {}
