import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { CancellationModule } from '../cancellation/cancellation.module.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { TossPaymentsClient } from './toss-payments.client.js';
import { PaymentService } from './payment.service.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';
import { ProviderChargeQuoteService } from './provider-charge-quote.service.js';

@Module({
  imports: [BookingModule, TicketModule, CancellationModule],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    TossPaymentsClient,
    PaymentService,
    TossWebhookGuard,
    ProviderChargeQuoteService,
  ],
  exports: [TossPaymentsClient, PaymentService, ProviderChargeQuoteService],
})
export class PaymentModule {}
