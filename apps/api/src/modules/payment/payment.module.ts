import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { TossPaymentsClient } from './toss-payments.client.js';
import { PaymentService } from './payment.service.js';

@Module({
  controllers: [PaymentController, PaymentWebhookController],
  providers: [TossPaymentsClient, PaymentService],
  exports: [TossPaymentsClient, PaymentService],
})
export class PaymentModule {}
