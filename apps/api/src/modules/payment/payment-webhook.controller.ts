import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
import {
  REJECTED_DONE_ASYNC_STATUSES,
  isSettledOrCompensatedPaymentState,
} from './async-done-compensation.js';
import {
  normalizeTossApprovedMethod,
  readTossEasyPayProvider,
} from './payment-method-policy.js';

const paymentStatusPriority = {
  READY: 0,
  IN_PROGRESS: 1,
  DONE: 2,
  ABORTED: 3,
  EXPIRED: 3,
  CANCELED: 4,
  PARTIAL_CANCELED: 4,
} as const;

/**
 * Provider payment states each webhook status can legitimately advance to.
 * Terminal statuses (ABORTED, EXPIRED, CANCELED) have no successors, so a
 * disagreement with them is never treated as an out-of-order delivery.
 */
const PROVIDER_PAYMENT_STATUS_SUCCESSORS: Record<string, readonly string[]> = {
  READY: ['IN_PROGRESS', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED'],
  IN_PROGRESS: ['WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED'],
  WAITING_FOR_DEPOSIT: ['DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED'],
  DONE: ['PARTIAL_CANCELED', 'CANCELED'],
  PARTIAL_CANCELED: ['CANCELED'],
};

function isProviderPaymentStatusAhead(
  webhookStatus: string | undefined,
  providerStatus: string,
): boolean {
  return webhookStatus !== undefined
    && (PROVIDER_PAYMENT_STATUS_SUCCESSORS[webhookStatus]?.includes(providerStatus) ?? false);
}

const tossWebhookDatetimeSchema = z.string().min(1);
const tossWebhookOptionalStringSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().min(1).optional(),
);
/**
 * Foreign wallet callbacks carry `easyPay` as a string; a Payment object
 * carries `{ provider, amount, discountAmount }`. Both read as the provider
 * label, so a domestic easy pay callback is not rejected as malformed.
 */
const tossWebhookEasyPaySchema = z.preprocess(
  (value) => value === null || typeof value === 'object' ? readTossEasyPayProvider(value) : value,
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
    easyPay: tossWebhookEasyPaySchema,
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
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(TossPaymentsClient)
    private readonly tossPaymentsClient: TossPaymentsClient,
  ) {}

  @Public()
  // Toss sends every webhook from a few fixed IPs, so an IP bucket would 429
  // (and delay by Toss' retry backoff) legitimate events at ticket-open peaks.
  // TossWebhookGuard's secret check and the webhook event ledger guard abuse.
  @SkipThrottle()
  @UseGuards(TossWebhookGuard)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
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
      const verified = await this.withProviderVerifiedState(
        webhook,
        request?.tossWebhookSecretScope,
      );
      if (verified.stale) {
        // An out-of-order delivery whose state the provider has already moved
        // past is authentic but obsolete; the later event carries the outcome.
        await this.paymentService.markWebhookEventProcessed(
          webhook.eventId,
          'IGNORED_STALE_PROVIDER_STATE',
          verified.staleMessage,
        );
        return {
          acknowledged: true,
          duplicate: false,
          processingResultCode: 'IGNORED_STALE_PROVIDER_STATE',
        };
      }
      const {
        webhook: providerVerifiedWebhook,
        providerResponse,
      } = verified;
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
    if (body.eventType === 'CANCEL_STATUS_CHANGED' || this.hasTerminalFullCancel(body, providerResponse)) {
      if (body.eventType === 'CANCEL_STATUS_CHANGED' && body.data.cancelStatus === 'ABORTED') {
        // A compensation cancel the PG aborted leaves the captured money in
        // place; record it so the recovery sweep re-requests the cancel.
        const aborted = await this.paymentService.recordCompensationCancelAborted(body);
        if (aborted) {
          return {
            code: 'ASYNC_DONE_COMPENSATION_CANCEL_ABORTED',
            message: `${aborted} payment compensation cancel aborted; recovery scheduled`,
          };
        }
      }

      if (
        progress?.reservationStatus === 'CANCELLED'
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

    if (this.hasCompletedPartialCancelSnapshot(body, providerResponse)) {
      const result = await this.paymentService.finalizePaymentStatusPartialCancelWebhook(
        body,
        providerResponse,
      );

      if (result === 'finalized') {
        return { code: 'PAYMENT_STATUS_CHANGED_PARTIAL_CANCEL_FINALIZED' };
      }

      if (result === 'already_finalized') {
        return {
          code: 'IGNORED_DUPLICATE_CANCEL_EVENT',
          message: 'partial cancel payment event already applied',
        };
      }

      return {
        code: 'IGNORED_PARTIAL_CANCEL_EVENT_NO_LOCAL_MATCH',
        message: 'partial cancel payment event has no matching local ticket cancellation',
      };
    }

    const incomingStatus = this.normalizePaymentStatus(this.requirePaymentStatus(body));
    if (this.shouldIgnorePaymentEvent(body, progress, incomingStatus)) {
      return {
        code: 'IGNORED_STALE_PAYMENT_EVENT',
        message: 'stale payment event after cancel/failure terminal state',
      };
    }

    const serviceProcessingCode = await this.paymentService.upsertAsyncPaymentProgress(
      body,
      incomingStatus,
      `payment_status_changed:${incomingStatus.toLowerCase()}`,
    );

    return {
      code: serviceProcessingCode ?? `PAYMENT_STATUS_CHANGED_${incomingStatus}_APPLIED`,
    };
  }

  private async withProviderVerifiedState(
    body: TossWebhookRequestBody,
    webhookSecretScope?: 'overseas-card',
  ): Promise<
    | { stale: false; webhook: TossWebhookRequestBody; providerResponse: TossPaymentResponse }
    | { stale: true; staleMessage: string }
  > {
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
    const verification = this.assertProviderStateMatchesWebhook(body, queried);
    if (verification.stale) {
      return { stale: true, staleMessage: verification.message };
    }

    // The payment method (and easy pay provider) the provider reports decides
    // the payment method policy; callback values only fill what it omits for
    // routing and storage.
    const verifiedEasyPayProvider = readTossEasyPayProvider(queried.easyPay);
    const providerData: TossWebhookRequestBody['data'] = {
      ...body.data,
      paymentKey: queried.paymentKey,
      orderId: queried.orderId,
      status: queried.status,
      method: queried.method ?? body.data.method,
      // Amount checks must compare the provider's currency, not the callback's.
      currency: queried.currency ?? body.data.currency,
      totalAmount: queried.totalAmount,
      ...this.resolveVerifiedWalletFields(body, queried, verifiedEasyPayProvider),
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
      stale: false,
      webhook: {
        ...body,
        providerVerified: {
          method: queried.method ?? null,
          easyPayProvider: verifiedEasyPayProvider ?? null,
        },
        data: providerData,
      },
      providerResponse: queried,
    };
  }

  /**
   * The wallet fields (`provider`, `easyPay`) the payment service stores the
   * payment with (its provider and method, and with them the refund and
   * compensation cancel scope). When the lookup reports a method, only a
   * provider-verified foreign easy pay keeps a wallet: a domestic card, transfer
   * or easy pay drops the callback's `provider`/`easyPay`, so a callback naming
   * ALIPAY cannot store a card payment as ALIPAY_PLUS/FOREIGN_EASY_PAY. Both
   * keys are always returned so they overwrite the spread callback data. Only a
   * lookup without a method falls back to the callback values.
   */
  private resolveVerifiedWalletFields(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
    verifiedEasyPayProvider: string | undefined,
  ): Pick<TossWebhookRequestBody['data'], 'provider' | 'easyPay'> {
    if (queried.method == null) {
      return {
        provider: body.data.provider,
        easyPay: verifiedEasyPayProvider ?? body.data.easyPay,
      };
    }

    const verifiedMethod = normalizeTossApprovedMethod(queried.method, queried.easyPay);
    if (verifiedMethod.category === 'FOREIGN_EASY_PAY') {
      const verifiedWallet = verifiedMethod.provider === 'ALIPAY_PLUS'
        ? 'ALIPAY' as const
        : verifiedMethod.provider;
      return {
        provider: verifiedWallet ?? body.data.provider,
        easyPay: verifiedEasyPayProvider ?? body.data.easyPay,
      };
    }

    return { provider: undefined, easyPay: verifiedEasyPayProvider };
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
        || this.isTrueMoneyWebhook(body)
      ))
    ) {
      return { secretKeyScope: 'foreign-easy-pay' };
    }

    return undefined;
  }

  /** Live payloads carry TrueMoney only as easyPay with a null provider. */
  private isTrueMoneyWebhook(body: TossWebhookRequestBody): boolean {
    const easyPay = body.data.easyPay?.trim().toUpperCase();
    return easyPay === 'TRUEMONEY' || easyPay === '트루머니';
  }

  private isOverseasCardWebhook(body: TossWebhookRequestBody): boolean {
    if (body.data.currency === 'MUSD') {
      return true;
    }

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

  /**
   * Identity disagreements (paymentKey, orderId, amount, unknown cancel) stay
   * 400. A status-only disagreement where the provider has already advanced
   * past the event is an out-of-order delivery and is acknowledged as stale.
   */
  private assertProviderStateMatchesWebhook(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
  ): { stale: false } | { stale: true; message: string } {
    if (body.eventType === 'CANCEL_STATUS_CHANGED') {
      return this.assertProviderCancelStateMatchesWebhook(body, queried);
    }

    const mismatches: string[] = [];

    if (queried.paymentKey !== body.data.paymentKey) {
      mismatches.push('paymentKey');
    }

    if (queried.orderId !== body.data.orderId) {
      mismatches.push('orderId');
    }

    if (
      typeof body.data.totalAmount === 'number'
      && queried.totalAmount !== body.data.totalAmount
      && body.eventType !== 'PAYMENT_STATUS_CHANGED'
    ) {
      mismatches.push('totalAmount');
    }

    const statusDiffers = queried.status !== body.data.status;
    if (
      mismatches.length === 0
      && statusDiffers
      && isProviderPaymentStatusAhead(body.data.status, queried.status)
    ) {
      return {
        stale: true,
        message: `provider status ${queried.status} is ahead of webhook status ${body.data.status ?? 'unknown'}`,
      };
    }

    if (statusDiffers) {
      mismatches.push('status');
    }

    if (mismatches.length > 0) {
      throw new BadRequestException(
        `Toss provider state mismatch: ${mismatches.join(', ')}`,
      );
    }

    return { stale: false };
  }

  private assertProviderCancelStateMatchesWebhook(
    body: TossWebhookRequestBody,
    queried: TossPaymentResponse,
  ): { stale: false } | { stale: true; message: string } {
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
      const sameRequest = body.eventType === 'CANCEL_STATUS_CHANGED'
        ? queried.cancels?.filter((cancel) => cancel.cancelRequestId === body.data.cancelRequestId) ?? []
        : [];
      if (
        mismatches.length === 0
        && body.data.cancelStatus === 'IN_PROGRESS'
        && sameRequest.some((cancel) => cancel.cancelStatus === 'DONE' || cancel.cancelStatus === 'ABORTED')
      ) {
        // The same cancel request already reached a final result.
        return {
          stale: true,
          message: `cancel ${body.data.cancelRequestId} already ${sameRequest.at(-1)?.cancelStatus ?? 'final'} at provider`,
        };
      }
      mismatches.push('cancel');
    }

    if (mismatches.length > 0) {
      throw new BadRequestException(
        `Toss provider state mismatch: ${mismatches.join(', ')}`,
      );
    }

    return { stale: false };
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
    if (body.eventType === 'PAYMENT_STATUS_CHANGED') {
      return providerResponse.status === 'CANCELED'
        && (providerResponse.cancels?.some((cancel) => cancel.cancelStatus === undefined || cancel.cancelStatus === 'DONE') ?? false);
    }
    return body.eventType === 'CANCEL_STATUS_CHANGED'
      && body.data.cancelStatus === 'DONE'
      && providerResponse.status === 'CANCELED'
      && this.findMatchingCancel(body, providerResponse) !== undefined;
  }

  private hasTerminalCompletedCancel(
    body: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): boolean {
    if (body.eventType === 'PAYMENT_STATUS_CHANGED') return this.hasTerminalFullCancel(body, providerResponse);
    return body.eventType === 'CANCEL_STATUS_CHANGED'
      && body.data.cancelStatus === 'DONE'
      && (
        providerResponse.status === 'CANCELED'
        || providerResponse.status === 'PARTIAL_CANCELED'
      )
      && this.findMatchingCancel(body, providerResponse) !== undefined;
  }

  private hasCompletedPartialCancelSnapshot(
    body: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): boolean {
    return body.eventType === 'PAYMENT_STATUS_CHANGED'
      && providerResponse.status === 'PARTIAL_CANCELED'
      && (providerResponse.cancels?.some((cancel) =>
        cancel.cancelStatus === undefined || cancel.cancelStatus === 'DONE'
      ) ?? false);
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
      case 'PARTIAL_CANCELED':
        return 'PARTIAL_CANCELED' as const;
      case 'ABORTED':
        return 'ABORTED' as const;
      case 'EXPIRED':
        return 'EXPIRED' as const;
      default:
        return 'IN_PROGRESS' as const;
    }
  }

  private shouldIgnorePaymentEvent(
    body: TossWebhookRequestBody,
    progress: AsyncPaymentProgressSnapshot | null,
    incomingStatus: keyof typeof paymentStatusPriority,
  ): boolean {
    if (!progress) {
      return false;
    }

    if (
      incomingStatus === 'DONE'
      && progress.paymentKey
      && progress.paymentKey !== body.data.paymentKey
      && isSettledOrCompensatedPaymentState(progress)
    ) {
      // A provider-verified DONE for another paymentKey of an order whose
      // payment is already accepted, cancelled or compensated is a second
      // charge. The service refunds it; ignoring it here would leave it at the PG.
      return false;
    }

    if (
      progress.paymentStatus === 'CANCELED'
      || progress.paymentStatus === 'PARTIAL_CANCELED'
    ) {
      return true;
    }

    if (
      incomingStatus === 'DONE'
      && progress.paymentStatus === 'ABORTED'
      && REJECTED_DONE_ASYNC_STATUSES.has(progress.paymentAsyncStatus ?? '')
    ) {
      // A rejected DONE whose compensating cancel did not complete must be
      // re-applied so the service can refund the captured charge.
      return false;
    }

    if (
      incomingStatus === 'DONE'
      && progress.reservationStatus === 'FAILED'
      && this.isAlipayDonePaymentEvent(body)
    ) {
      return false;
    }

    if (
      progress.reservationStatus === 'FAILED'
      && (
        incomingStatus === 'ABORTED'
        || incomingStatus === 'EXPIRED'
        || incomingStatus === 'CANCELED'
      )
      && (
        !progress.paymentStatus
        || progress.paymentStatus === 'READY'
        || progress.paymentStatus === 'IN_PROGRESS'
      )
    ) {
      return false;
    }

    if (
      progress.reservationStatus === 'FAILED'
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

  private isAlipayDonePaymentEvent(body: TossWebhookRequestBody): boolean {
    if (
      body.eventType !== 'PAYMENT_STATUS_CHANGED'
      || body.data.status !== 'DONE'
    ) {
      return false;
    }

    const provider = body.data.provider?.trim().toUpperCase();
    const easyPay = body.data.easyPay?.trim().toUpperCase();

    return provider === 'ALIPAY'
      || provider === 'ALIPAY_PLUS'
      || easyPay === 'ALIPAY'
      || easyPay === '알리페이';
  }
}
