import { BadRequestException, Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type AsyncPaymentProgressSnapshot,
  PaymentService,
  type TossWebhookRequestBody,
} from './payment.service.js';
import {
  TossPaymentsClient,
  type TossPaymentRequestOptions,
  type TossPaymentResponse,
} from './toss-payments.client.js';
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
    'ALIPAY',
    'ALIPAY_PLUS',
    'TRUEMONEY',
    'PAYPAL',
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
  constructor(
    private readonly paymentService: PaymentService,
    private readonly tossPaymentsClient: TossPaymentsClient,
  ) {}

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
      const {
        webhook: providerVerifiedWebhook,
        providerResponse,
      } = await this.withProviderVerifiedState(webhook);
      const progress = await this.paymentService.findAsyncPaymentProgress(
        providerVerifiedWebhook.data.orderId,
        providerVerifiedWebhook.data.paymentKey,
      );
      const processingResult = await this.processEvent(
        providerVerifiedWebhook,
        progress,
        providerResponse,
      );

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
    providerResponse: TossPaymentResponse,
  ): Promise<{ code: string; message?: string }> {
    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      if (
        progress?.reservationStatus === 'FAILED'
        || progress?.reservationStatus === 'CANCELLED'
        || (
          progress?.paymentStatus === 'CANCELED'
          && progress.reservationStatus !== 'CONFIRMED'
        )
      ) {
        return {
          code: 'IGNORED_DUPLICATE_CANCEL_EVENT',
          message: 'cancel event already applied',
        };
      }

      if (!progress) {
        return {
          code: 'IGNORED_CANCEL_EVENT_NO_LOCAL_MATCH',
          message: 'cancel event has no matching local reservation',
        };
      }

      if (progress.reservationStatus === 'CONFIRMED' && body.data.status === 'CANCELED') {
        const result = await this.paymentService.finalizeConfirmedCancelWebhook(
          body,
          providerResponse,
        );

        if (result === 'finalized') {
          return { code: 'CANCEL_STATUS_CHANGED_FINALIZED' };
        }

        if (result === 'already_finalized') {
          return {
            code: 'IGNORED_DUPLICATE_CANCEL_EVENT',
            message: 'cancel event already applied',
          };
        }

        return {
          code: 'IGNORED_CANCEL_EVENT_NO_LOCAL_MATCH',
          message: 'cancel event has no matching local payment/reservation',
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

  private async withProviderVerifiedState(
    body: TossWebhookRequestBody,
  ): Promise<{ webhook: TossWebhookRequestBody; providerResponse: TossPaymentResponse }> {
    const queryOptions = this.getProviderQueryOptions(body);
    const queried = queryOptions
      ? await this.tossPaymentsClient.queryPayment(body.data.paymentKey, queryOptions)
      : await this.tossPaymentsClient.queryPayment(body.data.paymentKey);
    this.assertProviderStateMatchesWebhook(body, queried);

    const providerData: TossWebhookRequestBody['data'] = {
      ...body.data,
      paymentKey: queried.paymentKey,
      orderId: queried.orderId,
      status: queried.status,
      method: queried.method ?? body.data.method,
      totalAmount: queried.totalAmount,
    };

    if (body.eventType === 'PAYMENT_STATUS_CHANGED' && queried.approvedAt) {
      providerData.approvedAt = queried.approvedAt;
    }

    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      const latestCancel = queried.cancels?.[queried.cancels.length - 1];
      providerData.canceledAt = latestCancel?.canceledAt ?? body.data.canceledAt;
      providerData.cancelReason = latestCancel?.cancelReason ?? body.data.cancelReason;
    }

    return {
      webhook: {
        ...body,
        data: providerData,
      },
      providerResponse: queried,
    };
  }

  private getProviderQueryOptions(
    body: TossWebhookRequestBody,
  ): TossPaymentRequestOptions | undefined {
    if (
      body.data.method === 'FOREIGN_EASY_PAY'
      || body.data.provider === 'ALIPAY'
      || body.data.provider === 'ALIPAY_PLUS'
      || body.data.provider === 'TRUEMONEY'
    ) {
      return { secretKeyScope: 'foreign-easy-pay' };
    }

    return undefined;
  }

  private assertProviderStateMatchesWebhook(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
  ): void {
    const mismatches: string[] = [];

    if (queried.paymentKey !== body.data.paymentKey) {
      mismatches.push('paymentKey');
    }

    if (queried.orderId !== body.data.orderId) {
      mismatches.push('orderId');
    }

    if (queried.status !== body.data.status) {
      mismatches.push('status');
    }

    if (
      typeof body.data.totalAmount === 'number'
      && queried.totalAmount !== body.data.totalAmount
    ) {
      mismatches.push('totalAmount');
    }

    if (mismatches.length > 0) {
      throw new BadRequestException(
        `Toss provider state mismatch: ${mismatches.join(', ')}`,
      );
    }
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
