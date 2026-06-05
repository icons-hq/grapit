import { BadRequestException, Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
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
import { resolvePaymentCancelSecretScope } from './payment-cancel-policy.js';

const paymentStatusPriority = {
  READY: 0,
  IN_PROGRESS: 1,
  DONE: 2,
  ABORTED: 3,
  EXPIRED: 3,
  CANCELED: 4,
} as const;

const tossWebhookDatetimeSchema = z.string().min(1);
const tossWebhookOptionalStringSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().min(1).optional(),
);
const tossWebhookOptionalAmountSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().positive().optional(),
);
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

const tossPaymentStatusChangedWebhookSchema = z.object({
  eventId: z.string().min(1, 'eventId가 필요합니다').optional(),
  eventType: z.literal('PAYMENT_STATUS_CHANGED'),
  createdAt: tossWebhookDatetimeSchema.optional(),
  data: z.object({
    paymentKey: z.string().min(1, 'paymentKey가 필요합니다'),
    orderId: z.string().min(1, 'orderId가 필요합니다'),
    status: z.string().min(1, 'status가 필요합니다'),
    method: tossWebhookOptionalStringSchema,
    provider: tossWebhookProviderSchema,
    currency: tossWebhookOptionalStringSchema,
    totalAmount: tossWebhookOptionalAmountSchema,
    approvedAt: z.preprocess(
      (value) => value === null ? undefined : value,
      tossWebhookDatetimeSchema.optional(),
    ),
    canceledAt: z.preprocess(
      (value) => value === null ? undefined : value,
      tossWebhookDatetimeSchema.optional(),
    ),
    cancelReason: tossWebhookOptionalStringSchema,
    easyPay: tossWebhookOptionalStringSchema,
  }),
});

const tossCancelStatusChangedWebhookSchema = z.object({
  eventId: z.string().min(1, 'eventId가 필요합니다').optional(),
  eventType: z.literal('CANCEL_STATUS_CHANGED'),
  createdAt: tossWebhookDatetimeSchema.optional(),
  data: z.object({
    cancelStatus: z.enum(['IN_PROGRESS', 'DONE', 'ABORTED']),
    cancelRequestId: z.string().min(1, 'cancelRequestId가 필요합니다'),
    paymentKey: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    provider: tossWebhookProviderSchema,
    currency: z.string().min(1).optional(),
    totalAmount: z.number().int().positive().optional(),
    canceledAt: tossWebhookDatetimeSchema.optional(),
    cancelReason: z.string().min(1).optional(),
    cancelAmount: z.number().positive().optional(),
  }),
});

export const tossWebhookSchema = z.discriminatedUnion('eventType', [
  tossPaymentStatusChangedWebhookSchema,
  tossCancelStatusChangedWebhookSchema,
]);

type TossWebhookDto = z.infer<typeof tossWebhookSchema>;
type TossWebhookRequest = {
  tossWebhookSecretScope?: 'overseas-card';
};

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
    @Req() request?: TossWebhookRequest,
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
      } = await this.withProviderVerifiedState(
        webhook,
        request?.tossWebhookSecretScope,
      );
      const progress = await this.paymentService.findAsyncPaymentProgress(
        this.requireWebhookOrderId(providerVerifiedWebhook),
        this.requireWebhookPaymentKey(providerVerifiedWebhook),
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
          body.data.orderId
          ?? ('cancelRequestId' in body.data ? body.data.cancelRequestId : undefined),
          body.data.paymentKey ?? 'unknown-payment-key',
          body.data.status
          ?? ('cancelStatus' in body.data ? body.data.cancelStatus : undefined),
          body.createdAt ?? 'unknown-created-at',
        ].join(':'),
    } as TossWebhookRequestBody;
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

      if (
        progress.reservationStatus === 'CONFIRMED'
        && this.hasTerminalCompletedCancel(body, providerResponse)
      ) {
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

      if (this.hasTerminalFullCancel(body, providerResponse)) {
        await this.paymentService.upsertAsyncPaymentProgress(
          body,
          'CANCELED',
          'cancelled_webhook',
        );
      }

      return { code: 'CANCEL_STATUS_CHANGED_APPLIED' };
    }

    const incomingStatus = this.normalizePaymentStatus(this.requirePaymentStatus(body));
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
    webhookSecretScope?: 'overseas-card',
  ): Promise<{ webhook: TossWebhookRequestBody; providerResponse: TossPaymentResponse }> {
    const cancelPaymentSnapshot = body.eventType === 'CANCEL_STATUS_CHANGED'
      ? await this.resolveCancelPaymentSnapshot(body)
      : null;
    const queryPaymentKey = this.getProviderQueryPaymentKey(body, cancelPaymentSnapshot);
    const queryOptions = this.getProviderQueryOptions(
      body,
      cancelPaymentSnapshot,
      webhookSecretScope,
    );
    const queried = queryOptions
      ? await this.tossPaymentsClient.queryPayment(queryPaymentKey, queryOptions)
      : await this.tossPaymentsClient.queryPayment(queryPaymentKey);
    this.assertProviderStateMatchesWebhook(body, queried);

    const providerData: TossWebhookRequestBody['data'] = {
      ...body.data,
      paymentKey: queried.paymentKey,
      orderId: queried.orderId,
      status: queried.status,
      method: queried.method ?? body.data.method,
      totalAmount: queried.totalAmount,
      easyPay: body.data.easyPay,
    };

    if (body.eventType === 'PAYMENT_STATUS_CHANGED' && queried.approvedAt) {
      providerData.approvedAt = queried.approvedAt;
    }

    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      const matchingCancel = this.findMatchingCancel(body, queried);
      providerData.cancelStatus = body.data.cancelStatus;
      providerData.cancelRequestId = body.data.cancelRequestId;
      providerData.canceledAt = matchingCancel?.canceledAt ?? body.data.canceledAt;
      providerData.cancelReason = matchingCancel?.cancelReason ?? body.data.cancelReason;
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
    cancelPaymentSnapshot: Awaited<ReturnType<PaymentWebhookController['resolveCancelPaymentSnapshot']>> = null,
    webhookSecretScope?: 'overseas-card',
  ): TossPaymentRequestOptions | undefined {
    if (webhookSecretScope === 'overseas-card') {
      return { secretKeyScope: 'overseas-card' };
    }

    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      const payment = cancelPaymentSnapshot;

      if (payment) {
        return { secretKeyScope: resolvePaymentCancelSecretScope(payment) };
      }

      return this.getWebhookProviderQueryOptions(body, true);
    }

    return this.getWebhookProviderQueryOptions(body, false);
  }

  private getProviderQueryPaymentKey(
    body: TossWebhookRequestBody,
    cancelPaymentSnapshot: Awaited<ReturnType<PaymentWebhookController['resolveCancelPaymentSnapshot']>> = null,
  ): string {
    if (body.data.paymentKey) {
      return body.data.paymentKey;
    }

    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      if (cancelPaymentSnapshot) {
        return cancelPaymentSnapshot.paymentKey;
      }
    }

    throw new BadRequestException('cancel webhook local payment lookup failed');
  }

  private async resolveCancelPaymentSnapshot(
    body: TossWebhookRequestBody,
  ) {
    if (body.eventType !== 'CANCEL_STATUS_CHANGED') {
      return null;
    }

    const byCancelRequestId =
      await this.paymentService.findPaymentCancelSnapshotByCancelRequestId(
        body.data.cancelRequestId ?? '',
      );

    if (byCancelRequestId) {
      return byCancelRequestId;
    }

    if (body.data.orderId && body.data.paymentKey) {
      return await this.paymentService.findPaymentCancelSnapshot(
        body.data.orderId,
        body.data.paymentKey,
      );
    }

    return null;
  }

  private getWebhookProviderQueryOptions(
    body: TossWebhookRequestBody,
    isCancelEvent: boolean,
  ): TossPaymentRequestOptions | undefined {
    if (this.isOverseasCardWebhook(body)) {
      return { secretKeyScope: 'overseas-card' };
    }

    if (
      body.data.provider === 'ALIPAY'
      || body.data.provider === 'ALIPAY_PLUS'
      || body.data.provider === 'TRUEMONEY'
      || (!isCancelEvent && (
        body.data.method === 'FOREIGN_EASY_PAY'
        || this.isAlipayWebhook(body)
      ))
    ) {
      return { secretKeyScope: 'foreign-easy-pay' };
    }

    return undefined;
  }

  private isOverseasCardWebhook(body: TossWebhookRequestBody): boolean {
    return (
      body.data.provider === 'CARD'
      && body.data.method === 'CARD'
      && body.data.currency === 'USD'
    );
  }

  private isAlipayWebhook(body: TossWebhookRequestBody): boolean {
    const easyPay = body.data.easyPay?.trim().toUpperCase();
    return easyPay === 'ALIPAY' || easyPay === '알리페이';
  }

  private assertProviderStateMatchesWebhook(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
  ): void {
    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      this.assertProviderCancelStateMatchesWebhook(body, queried);
      return;
    }

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

  private assertProviderCancelStateMatchesWebhook(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
  ): void {
    const mismatches: string[] = [];

    if (body.data.paymentKey && queried.paymentKey !== body.data.paymentKey) {
      mismatches.push('paymentKey');
    }

    if (body.data.orderId && queried.orderId !== body.data.orderId) {
      mismatches.push('orderId');
    }

    if (
      typeof body.data.totalAmount === 'number'
      && queried.totalAmount !== body.data.totalAmount
    ) {
      mismatches.push('totalAmount');
    }

    if (!this.findMatchingCancel(body, queried)) {
      mismatches.push('cancel');
    }

    if (mismatches.length > 0) {
      throw new BadRequestException(
        `Toss provider state mismatch: ${mismatches.join(', ')}`,
      );
    }
  }

  private findMatchingCancel(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
  ) {
    if (body.eventType !== 'CANCEL_STATUS_CHANGED') {
      return undefined;
    }

    return queried.cancels?.find((cancel) =>
      cancel.cancelRequestId === body.data.cancelRequestId
      && cancel.cancelStatus === body.data.cancelStatus
    );
  }

  private hasTerminalFullCancel(
    body: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): boolean {
    return body.eventType === 'CANCEL_STATUS_CHANGED'
      && body.data.cancelStatus === 'DONE'
      && providerResponse.status === 'CANCELED'
      && this.findMatchingCancel(body, providerResponse) !== undefined;
  }

  private hasTerminalCompletedCancel(
    body: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): boolean {
    return body.eventType === 'CANCEL_STATUS_CHANGED'
      && body.data.cancelStatus === 'DONE'
      && (
        providerResponse.status === 'CANCELED'
        || providerResponse.status === 'PARTIAL_CANCELED'
      )
      && this.findMatchingCancel(body, providerResponse) !== undefined;
  }

  private requirePaymentStatus(body: TossWebhookRequestBody): string {
    if (!body.data.status) {
      throw new BadRequestException('payment status webhook status is required');
    }

    return body.data.status;
  }

  private requireWebhookOrderId(body: TossWebhookRequestBody): string {
    if (!body.data.orderId) {
      throw new BadRequestException('webhook orderId is required after provider verification');
    }

    return body.data.orderId;
  }

  private requireWebhookPaymentKey(body: TossWebhookRequestBody): string {
    if (!body.data.paymentKey) {
      throw new BadRequestException('webhook paymentKey is required after provider verification');
    }

    return body.data.paymentKey;
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
