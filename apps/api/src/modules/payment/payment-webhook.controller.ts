import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type AsyncPaymentProgressSnapshot,
  PaymentService,
  type TossWebhookRequestBody,
} from './payment.service.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';

const paymentStatusPriority = {
  READY: 0,
  IN_PROGRESS: 1,
  DONE: 2,
  ABORTED: 3,
  EXPIRED: 3,
  CANCELED: 4,
} as const;

const tossWebhookDatetimeSchema = z.string().min(1);
const tossWebhookProviderSchema = z
  .enum([
    'CARD',
    'TOSS_PAY',
    'NAVER_PAY',
    'KAKAOPAY',
    'ALIPAY_PLUS',
    'TRUEMONEY',
  ])
  .optional()
  .catch(undefined);

export const tossWebhookSchema = z.object({
  eventId: z.string().min(1, 'eventId가 필요합니다').optional(),
  eventType: z.enum(['PAYMENT_STATUS_CHANGED', 'CANCEL_STATUS_CHANGED']),
  createdAt: tossWebhookDatetimeSchema.optional(),
  data: z.object({
    paymentKey: z.string().min(1, 'paymentKey가 필요합니다'),
    orderId: z.string().min(1, 'orderId가 필요합니다'),
    status: z.string().min(1, 'status가 필요합니다'),
    method: z.string().min(1).optional(),
    provider: tossWebhookProviderSchema,
    currency: z.string().min(1).optional(),
    totalAmount: z.number().int().positive().optional(),
    approvedAt: tossWebhookDatetimeSchema.optional(),
    canceledAt: tossWebhookDatetimeSchema.optional(),
    cancelReason: z.string().min(1).optional(),
  }),
});

type TossWebhookDto = z.infer<typeof tossWebhookSchema>;

@Controller('payments/toss')
export class PaymentWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Public()
  @UseGuards(TossWebhookGuard)
  @Post('webhook')
  async handleTossWebhook(
    @Body(new ZodValidationPipe(tossWebhookSchema))
    body: TossWebhookDto,
    @Headers('tosspayments-webhook-transmission-id') transmissionId?: string,
  ) {
    const webhook = this.withEventId(body, transmissionId);
    const ledger = await this.paymentService.recordWebhookEvent(webhook);

    if (ledger.state === 'duplicate-processed') {
      return {
        acknowledged: true,
        duplicate: true,
        processingResultCode: ledger.processingResultCode ?? 'ALREADY_PROCESSED',
      };
    }

    try {
      const progress = await this.paymentService.findAsyncPaymentProgress(
        webhook.data.orderId,
        webhook.data.paymentKey,
      );
      const processingResult = await this.processEvent(webhook, progress);

      await this.paymentService.markWebhookEventProcessed(
        webhook.eventId,
        processingResult.code,
        processingResult.message,
      );

      return {
        acknowledged: true,
        duplicate: false,
        processingResultCode: processingResult.code,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'webhook processing failed';
      await this.paymentService.markWebhookEventFailed(
        webhook.eventId,
        'PROCESSING_FAILED',
        message,
      );
      throw error;
    }
  }

  private withEventId(
    body: TossWebhookDto,
    transmissionId?: string,
  ): TossWebhookRequestBody {
    return {
      ...body,
      eventId:
        body.eventId
        ?? transmissionId
        ?? [
          body.eventType,
          body.data.orderId,
          body.data.paymentKey,
          body.data.status,
          body.createdAt ?? 'unknown-created-at',
        ].join(':'),
    };
  }

  private async processEvent(
    body: TossWebhookRequestBody,
    progress: AsyncPaymentProgressSnapshot | null,
  ): Promise<{ code: string; message?: string }> {
    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      if (
        progress?.paymentStatus === 'CANCELED'
        || progress?.reservationStatus === 'FAILED'
        || progress?.reservationStatus === 'CANCELLED'
      ) {
        return {
          code: 'IGNORED_DUPLICATE_CANCEL_EVENT',
          message: 'cancel event already applied',
        };
      }

      await this.paymentService.upsertAsyncPaymentProgress(
        body,
        'CANCELED',
        'cancelled_webhook',
      );

      return { code: 'CANCEL_STATUS_CHANGED_APPLIED' };
    }

    const incomingStatus = this.normalizePaymentStatus(body.data.status);
    if (this.shouldIgnorePaymentEvent(progress, incomingStatus)) {
      return {
        code: 'IGNORED_STALE_PAYMENT_EVENT',
        message: 'stale payment event after cancel/failure terminal state',
      };
    }

    await this.paymentService.upsertAsyncPaymentProgress(
      body,
      incomingStatus,
      `payment_status_changed:${incomingStatus.toLowerCase()}`,
    );

    return { code: `PAYMENT_STATUS_CHANGED_${incomingStatus}_APPLIED` };
  }

  private normalizePaymentStatus(status: string) {
    switch (status) {
      case 'DONE':
        return 'DONE' as const;
      case 'CANCELED':
        return 'CANCELED' as const;
      case 'ABORTED':
        return 'ABORTED' as const;
      case 'EXPIRED':
        return 'EXPIRED' as const;
      default:
        return 'IN_PROGRESS' as const;
    }
  }

  private shouldIgnorePaymentEvent(
    progress: AsyncPaymentProgressSnapshot | null,
    incomingStatus: keyof typeof paymentStatusPriority,
  ): boolean {
    if (!progress) {
      return false;
    }

    if (
      progress.paymentStatus === 'CANCELED'
      || progress.reservationStatus === 'FAILED'
      || progress.reservationStatus === 'CANCELLED'
    ) {
      return true;
    }

    if (!progress.paymentStatus) {
      return false;
    }

    if (!this.isPrioritizedPaymentStatus(progress.paymentStatus)) {
      return false;
    }

    if (
      incomingStatus === 'DONE'
      && progress.paymentStatus === 'DONE'
      && (
        progress.reservationStatus === 'PENDING_PAYMENT'
        || progress.reservationStatus === 'CONFIRMED'
      )
    ) {
      return false;
    }

    return (
      paymentStatusPriority[incomingStatus]
      <= paymentStatusPriority[progress.paymentStatus]
    );
  }

  private isPrioritizedPaymentStatus(
    status: string,
  ): status is keyof typeof paymentStatusPriority {
    return status in paymentStatusPriority;
  }
}
