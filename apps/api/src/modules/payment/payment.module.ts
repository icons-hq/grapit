import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { CancellationModule } from '../cancellation/cancellation.module.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { TossPaymentsClient } from './toss-payments.client.js';
import { PaymentService } from './payment.service.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';
import { ProviderChargeQuoteService } from './provider-charge-quote.service.js';
import { AbandonedPaymentHandoffService } from './abandoned-payment-handoff.service.js';

@Module({
  // QueueModule provides the QueueService of the AdmissionGuard on the provider
  // handoff; imported explicitly like BookingModule does for its guard.
  // FeatureFlagsModule backs the Sitewide Booking Gate on the handoff.
  imports: [BookingModule, TicketModule, CancellationModule, QueueModule, FeatureFlagsModule],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    TossPaymentsClient,
    PaymentService,
    TossWebhookGuard,
    ProviderChargeQuoteService,
    AbandonedPaymentHandoffService,
  ],
  exports: [
    TossPaymentsClient,
    PaymentService,
    ProviderChargeQuoteService,
    AbandonedPaymentHandoffService,
  ],
})
export class PaymentModule {}
