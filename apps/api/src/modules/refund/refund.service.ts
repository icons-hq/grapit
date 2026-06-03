import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { normalizeSeatIdentity } from '@grabit/shared';
import type { RefundTimeline } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingPolicies,
  payments,
  refunds,
  reservationSeats,
  reservations,
  showtimes,
} from '../../database/schema/index.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type SeatIdentityPayload,
} from '../jobs/pgboss.provider.js';
import { TossPaymentError, TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import { buildFullPaymentCancelRequest } from '../payment/payment-cancel-policy.js';

type RefundRecord = typeof refunds.$inferSelect;
type ReservationRecord = typeof reservations.$inferSelect;
type PaymentRecord = typeof payments.$inferSelect;
type ReservationSeatRecord = typeof reservationSeats.$inferSelect;
type ShowtimeRecord = typeof showtimes.$inferSelect;
type BookingPolicyRecord = typeof bookingPolicies.$inferSelect;

type RefundStateMachineStatus =
  | 'requested'
  | 'sent_to_pg'
  | 'processing_at_pg'
  | 'completed'
  | 'failed';

type ReservationRefundContext = {
  reservation: ReservationRecord;
  payment: PaymentRecord;
  showtime: ShowtimeRecord;
  bookingPolicy: BookingPolicyRecord | null;
  seats: ReservationSeatRecord[];
};

type RefundRequestActor =
  | { kind: 'user' }
  | { kind: 'admin'; operatorUserId: string };

export interface RefundPreviewResponse {
  reservationId: string;
  reservationNumber: string;
  paymentKey: string;
  refundableAmount: number;
  canRequestRefund: boolean;
  cancelledSeatHoldWindowMinutes: {
    min: number;
    max: number;
  };
  refundTimeline: RefundTimeline | null;
}

export interface RefundRequestResponse extends RefundPreviewResponse {
  idempotent: boolean;
  retryEnqueued: boolean;
}

export const REFUND_VISIBLE_STATES: readonly RefundStateMachineStatus[] = [
  'requested',
  'sent_to_pg',
  'processing_at_pg',
  'completed',
  'failed',
] as const;

export const DEFAULT_CANCELLED_SEAT_HOLD_MINUTES = 1;
export const DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES = 10;
export const REFUND_CANCEL_MAX_RETRIES = 3;
export const SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID = 'JOB_ENQUEUE_FAILED';

const REFUND_TIMELINE_STATE_MAP: Record<
  RefundStateMachineStatus,
  RefundTimeline['currentState']
> = {
  requested: 'REQUESTED',
  sent_to_pg: 'SENT_TO_PG',
  processing_at_pg: 'PROCESSING_AT_PG',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

const TRANSIENT_TOSS_CANCEL_CODES = new Set([
  'INTERNAL_SERVER_ERROR',
  'INTERNAL_SYSTEM_PROCESSING_ERROR',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
]);

export function normalizeReservationSeatIdentity(seatId: string): SeatIdentityPayload {
  const identity = normalizeSeatIdentity({ seatId });
  return {
    floorKey: identity.floorKey,
    seatId: identity.seatId,
    seatKey: identity.seatKey,
  };
}

export function calculateExpectedRefundDepositAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
}

export function isTransientRefundCancelFailure(error: unknown): boolean {
  if (error instanceof TossPaymentError) {
    return TRANSIENT_TOSS_CANCEL_CODES.has(error.code);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return [
      'timeout',
      'timed out',
      'network',
      'fetch failed',
      'econnreset',
      'socket hang up',
      'temporar',
      '5xx',
    ].some((token) => message.includes(token));
  }

  return false;
}

export function getRefundErrorCode(error: unknown): string {
  if (error instanceof TossPaymentError) {
    return error.code;
  }

  if (error instanceof Error) {
    if (isTransientRefundCancelFailure(error)) {
      return 'NETWORK_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

export function getRefundErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '알 수 없는 환불 오류';
}

export function isTossCancelCompleted(
  response: TossPaymentResponse,
  cancelRequestId?: string,
): boolean {
  if (cancelRequestId) {
    return response.cancels?.some((cancel) =>
      cancel.cancelRequestId === cancelRequestId && cancel.cancelStatus === 'DONE'
    ) ?? false;
  }

  return response.status === 'CANCELED';
}

const REFUND_CANCEL_RETRY_METADATA_KEY = 'refundCancelRetry';

function getRefundProviderMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function getRefundCancelRetryJobId(refund: Pick<RefundRecord, 'providerMetadata'>): string | null {
  const metadata = getRefundProviderMetadata(refund.providerMetadata);
  const retryMetadata = metadata[REFUND_CANCEL_RETRY_METADATA_KEY];
  if (
    retryMetadata
    && typeof retryMetadata === 'object'
    && !Array.isArray(retryMetadata)
    && typeof (retryMetadata as { jobId?: unknown }).jobId === 'string'
  ) {
    return (retryMetadata as { jobId: string }).jobId;
  }

  return null;
}

function pickCancelledSeatReleaseDelaySeconds(
  minMinutes: number,
  maxMinutes: number,
  rng: () => number = Math.random,
): number {
  const minSeconds = Math.max(60, Math.floor(minMinutes * 60));
  const maxSeconds = Math.max(minSeconds, Math.floor(maxMinutes * 60));
  return Math.floor(rng() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

function toTimeline(refund: RefundRecord, now: Date = new Date()): RefundTimeline {
  const expectedDepositAt =
    refund.expectedDepositAt instanceof Date ? refund.expectedDepositAt : null;
  const isDelayed =
    expectedDepositAt instanceof Date &&
    refund.status !== 'completed' &&
    expectedDepositAt.getTime() < now.getTime();

  return {
    currentState: REFUND_TIMELINE_STATE_MAP[refund.status],
    requestedAt: refund.requestedAt.toISOString(),
    sentToPgAt: refund.sentToPgAt?.toISOString() ?? null,
    processedAtPgAt: refund.processingAtPgAt?.toISOString() ?? null,
    completedAt: refund.completedAt?.toISOString() ?? null,
    failedAt: refund.failedAt?.toISOString() ?? null,
    expectedDepositAt: expectedDepositAt?.toISOString() ?? null,
    customerServiceCtaVisible: refund.customerServiceCtaVisible || isDelayed,
  };
}

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossPaymentsClient: TossPaymentsClient,
    private readonly paymentCancellationFinalizer: PaymentCancellationFinalizerService,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
  ) {}

  async getRefundPreview(
    reservationId: string,
    userId: string,
  ): Promise<RefundPreviewResponse> {
    const context = await this.loadReservationContext(reservationId, userId);
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.buildPreview(context, existingRefund);
  }

  async requestRefund(
    reservationId: string,
    userId: string,
    reason: string,
  ): Promise<RefundRequestResponse> {
    const context = await this.loadReservationContext(reservationId, userId);
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.requestRefundWithContext(context, existingRefund, reason, { kind: 'user' });
  }

  async requestAdminRefund(
    reservationId: string,
    operatorUserId: string,
    reason: string,
  ): Promise<RefundRequestResponse> {
    const context = await this.loadReservationContextByReservationId(reservationId);
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.requestRefundWithContext(context, existingRefund, reason, {
      kind: 'admin',
      operatorUserId,
    });
  }

  protected async requestRefundWithContext(
    context: ReservationRefundContext,
    existingRefund: RefundRecord | null,
    reason: string,
    actor: RefundRequestActor,
  ): Promise<RefundRequestResponse> {
    if (existingRefund) {
      const refund = await this.ensureRefundCancelRetryScheduled(existingRefund);

      return this.buildRequestResponse(context, refund, {
        idempotent: true,
        retryEnqueued:
          (refund.status === 'sent_to_pg' || refund.status === 'processing_at_pg')
          && Boolean(getRefundCancelRetryJobId(refund)),
      });
    }

    if (context.reservation.status !== 'CONFIRMED') {
      throw new BadRequestException('환불 가능한 예매 상태가 아닙니다');
    }

    const requestedRefund = await this.insertRequestedRefund(context, reason, actor);
    const command = buildFullPaymentCancelRequest({
      payment: context.payment,
      reason,
      idempotencyKey: this.buildRefundCancelIdempotencyKey(requestedRefund.id),
      cancelRequestIdSeed: requestedRefund.id,
    });

    try {
      const cancelResult = await this.tossPaymentsClient.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );

      if (isTossCancelCompleted(cancelResult, command.options.cancelRequestId)) {
        await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
          source: 'refund_request',
          refundId: requestedRefund.id,
          context: this.toFullPaymentCancellationContext(context),
          reason,
          providerResponse: cancelResult as unknown as Record<string, unknown>,
          actor,
        });
        const completedRefund = await this.loadRefundById(requestedRefund.id);

        return this.buildRequestResponse(context, completedRefund, {
          idempotent: false,
          retryEnqueued: false,
        });
      }

      const processingRefund = await this.markRefundProcessing(
        requestedRefund.id,
        cancelResult,
        reason,
        requestedRefund.retryCount,
      );
      const jobId = await this.scheduleRefundCancelRetry(
        processingRefund.id,
        processingRefund.retryCount,
      );
      const scheduledRefund = await this.recordRefundCancelRetrySchedule(
        processingRefund,
        jobId,
      );

      return this.buildRequestResponse(context, scheduledRefund, {
        idempotent: false,
        retryEnqueued: Boolean(jobId),
      });
    } catch (error) {
      if (isTransientRefundCancelFailure(error)) {
        const retryableRefund = await this.markRefundSentToPg(
          requestedRefund.id,
          error,
          reason,
          requestedRefund.retryCount,
        );
        const jobId = await this.scheduleRefundCancelRetry(
          retryableRefund.id,
          retryableRefund.retryCount,
        );
        const scheduledRefund = await this.recordRefundCancelRetrySchedule(
          retryableRefund,
          jobId,
        );

        return this.buildRequestResponse(context, scheduledRefund, {
          idempotent: false,
          retryEnqueued: Boolean(jobId),
        });
      }

      const failedRefund = await this.markRefundFailed(requestedRefund.id, error);
      return this.buildRequestResponse(context, failedRefund, {
        idempotent: false,
        retryEnqueued: false,
      });
    }
  }

  protected buildPreview(
    context: ReservationRefundContext,
    refund: RefundRecord | null,
  ): RefundPreviewResponse {
    const holdWindow = this.resolveHoldWindowMinutes(context.bookingPolicy);

    return {
      reservationId: context.reservation.id,
      reservationNumber: context.reservation.reservationNumber,
      paymentKey: context.payment.paymentKey,
      refundableAmount: context.payment.amount,
      canRequestRefund: context.reservation.status === 'CONFIRMED' && refund === null,
      cancelledSeatHoldWindowMinutes: holdWindow,
      refundTimeline: refund ? toTimeline(refund) : null,
    };
  }

  protected buildRequestResponse(
    context: ReservationRefundContext,
    refund: RefundRecord,
    options: { idempotent: boolean; retryEnqueued: boolean },
  ): RefundRequestResponse {
    return {
      ...this.buildPreview(context, refund),
      idempotent: options.idempotent,
      retryEnqueued: options.retryEnqueued,
    };
  }

  protected resolveHoldWindowMinutes(bookingPolicy: BookingPolicyRecord | null) {
    return {
      min:
        bookingPolicy?.cancelledSeatHoldMinMinutes ??
        DEFAULT_CANCELLED_SEAT_HOLD_MINUTES,
      max:
        bookingPolicy?.cancelledSeatHoldMaxMinutes ??
        DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES,
    };
  }

  protected async loadReservationContext(
    reservationId: string,
    userId: string,
  ): Promise<ReservationRefundContext> {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.userId, userId)));

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다');
    }

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));

    if (!payment) {
      throw new BadRequestException('환불할 결제 정보가 없습니다');
    }

    const [showtime] = await this.db
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));

    if (!showtime) {
      throw new NotFoundException('회차 정보를 찾을 수 없습니다');
    }

    const [bookingPolicy] = await this.db
      .select()
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const seats = await this.db
      .select()
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));

    return {
      reservation,
      payment,
      showtime,
      bookingPolicy: bookingPolicy ?? null,
      seats,
    };
  }

  protected async loadReservationContextByReservationId(
    reservationId: string,
  ): Promise<ReservationRefundContext> {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다');
    }

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));

    if (!payment) {
      throw new BadRequestException('환불할 결제 정보가 없습니다');
    }

    const [showtime] = await this.db
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));

    if (!showtime) {
      throw new NotFoundException('회차 정보를 찾을 수 없습니다');
    }

    const [bookingPolicy] = await this.db
      .select()
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const seats = await this.db
      .select()
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));

    return {
      reservation,
      payment,
      showtime,
      bookingPolicy: bookingPolicy ?? null,
      seats,
    };
  }

  protected async findExistingRefund(
    reservationId: string,
  ): Promise<RefundRecord | null> {
    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.reservationId, reservationId));

    return refund ?? null;
  }

  protected async loadRefundById(refundId: string): Promise<RefundRecord> {
    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId));

    if (!refund) {
      throw new NotFoundException('환불 상태를 찾을 수 없습니다');
    }

    return refund;
  }

  protected buildRefundCancelIdempotencyKey(refundId: string): string {
    return `refund-cancel:${refundId}`;
  }

  protected toFullPaymentCancellationContext(context: ReservationRefundContext) {
    return {
      reservation: {
        id: context.reservation.id,
        showtimeId: context.reservation.showtimeId,
        reservationNumber: context.reservation.reservationNumber,
      },
      payment: {
        id: context.payment.id,
        paymentKey: context.payment.paymentKey,
        providerMetadata: context.payment.providerMetadata,
      },
      bookingPolicy: context.bookingPolicy,
      seats: context.seats.map((seat) => ({ seatId: seat.seatId })),
    };
  }

  protected async insertRequestedRefund(
    context: ReservationRefundContext,
    reason: string,
    actor: RefundRequestActor = { kind: 'user' },
  ): Promise<RefundRecord> {
    const now = new Date();
    const [created] = await this.db
      .insert(refunds)
      .values({
        reservationId: context.reservation.id,
        paymentId: context.payment.id,
        status: 'requested',
        provider: 'toss_payments',
        resultCode: 'REQUESTED',
        resultMessage:
          actor.kind === 'admin' ? 'Refund requested by admin' : 'Refund requested by user',
        providerMetadata: {
          cancelReason: reason,
          reservationNumber: context.reservation.reservationNumber,
          paymentKey: context.payment.paymentKey,
          requestedBy: actor.kind,
          ...(actor.kind === 'admin' ? { operatorUserId: actor.operatorUserId } : {}),
        },
        requestedAt: now,
        expectedDepositAt: calculateExpectedRefundDepositAt(now),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: refunds.reservationId })
      .returning();

    if (created) {
      return created;
    }

    const existingRefund = await this.findExistingRefund(context.reservation.id);
    if (existingRefund) {
      return existingRefund;
    }

    throw new BadRequestException('환불 상태를 초기화하지 못했습니다');
  }

  protected async markRefundSentToPg(
    refundId: string,
    error: unknown,
    reason: string,
    retryCount: number,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'sent_to_pg',
      sentToPgAt: now,
      resultCode: getRefundErrorCode(error),
      resultMessage: getRefundErrorMessage(error),
      failureReason: getRefundErrorMessage(error),
      retryCount,
      expectedDepositAt: calculateExpectedRefundDepositAt(now),
      providerMetadata: {
        cancelReason: reason,
        lastTransientError: getRefundErrorMessage(error),
      },
      updatedAt: now,
    });
  }

  protected async markRefundProcessing(
    refundId: string,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'processing_at_pg',
      sentToPgAt: now,
      processingAtPgAt: now,
      resultCode: response.status,
      resultMessage: 'PG cancel accepted and is processing',
      retryCount,
      expectedDepositAt: calculateExpectedRefundDepositAt(now),
      providerMetadata: {
        cancelReason: reason,
        paymentStatus: response.status,
      },
      updatedAt: now,
    });
  }

  protected async markRefundFailed(
    refundId: string,
    error: unknown,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'failed',
      failedAt: now,
      resultCode: getRefundErrorCode(error),
      resultMessage: getRefundErrorMessage(error),
      failureReason: getRefundErrorMessage(error),
      customerServiceCtaVisible: true,
      updatedAt: now,
    });
  }

  protected async updateRefund(
    refundId: string,
    values: Partial<typeof refunds.$inferInsert>,
  ): Promise<RefundRecord> {
    const [updated] = await this.db
      .update(refunds)
      .set(values)
      .where(eq(refunds.id, refundId))
      .returning();

    if (!updated) {
      throw new NotFoundException('환불 상태를 찾을 수 없습니다');
    }

    return updated;
  }

  protected async ensureRefundCancelRetryScheduled(
    refund: RefundRecord,
  ): Promise<RefundRecord> {
    if (
      (refund.status !== 'sent_to_pg' && refund.status !== 'processing_at_pg')
      || refund.retryCount >= REFUND_CANCEL_MAX_RETRIES
      || getRefundCancelRetryJobId(refund)
    ) {
      return refund;
    }

    const jobId = await this.scheduleRefundCancelRetry(refund.id, refund.retryCount);
    return this.recordRefundCancelRetrySchedule(refund, jobId);
  }

  protected async recordRefundCancelRetrySchedule(
    refund: RefundRecord,
    jobId: string | null,
  ): Promise<RefundRecord> {
    const now = new Date();
    const providerMetadata = getRefundProviderMetadata(refund.providerMetadata);

    return this.updateRefund(refund.id, {
      providerMetadata: {
        ...providerMetadata,
        [REFUND_CANCEL_RETRY_METADATA_KEY]: {
          status: jobId ? 'scheduled' : 'schedule_failed',
          jobId,
          attempt: refund.retryCount + 1,
          scheduledAt: jobId ? now.toISOString() : null,
          failedAt: jobId ? null : now.toISOString(),
        },
      },
      customerServiceCtaVisible: !jobId,
      updatedAt: now,
    });
  }

  protected async scheduleRefundCancelRetry(
    refundId: string,
    retryCount: number,
  ): Promise<string | null> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(
        `pg-boss unavailable. refund-cancel-retry job skipped for refundId=${refundId}`,
      );
      return null;
    }

    const nextAttempt = retryCount + 1;
    const delaySeconds = Math.min(600, 60 * Math.max(1, nextAttempt));
    const startAfter = new Date(Date.now() + delaySeconds * 1000);

    try {
      return await this.pgBoss.send(
        PG_BOSS_JOB_NAMES.refundCancelRetry,
        {
          refundId,
          attempt: nextAttempt,
        },
        {
          startAfter,
          singletonKey: refundId,
          retryLimit: REFUND_CANCEL_MAX_RETRIES,
          retryBackoff: true,
          retryDelay: 60,
        },
      );
    } catch (error) {
      this.logger.error(
        `pg-boss refund-cancel-retry enqueue failed for refundId=${refundId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
