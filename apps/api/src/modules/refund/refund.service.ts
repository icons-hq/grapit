import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { RefundTimeline } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingPolicies,
  payments,
  refunds,
  reservationSeats,
  reservations,
  seatInventories,
  showtimes,
} from '../../database/schema/index.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type ReleaseCancelledSeatJobPayload,
  type SeatIdentityPayload,
} from '../jobs/pgboss.provider.js';
import { TossPaymentError, TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';

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
export const SEAT_RELEASE_PENDING_JOB_ID = 'PENDING_ENQUEUE';
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
  if (seatId.includes(':')) {
    const separatorIndex = seatId.indexOf(':');
    const floorKey = seatId.slice(0, separatorIndex) || '1F';
    const rawSeatId = seatId.slice(separatorIndex + 1);

    return {
      floorKey,
      seatId: rawSeatId,
      seatKey: `${floorKey}:${rawSeatId}`,
    };
  }

  return {
    floorKey: '1F',
    seatId,
    seatKey: `1F:${seatId}`,
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

export function isTossCancelCompleted(response: TossPaymentResponse): boolean {
  return response.status === 'DONE' || response.status.includes('CANCELED');
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
    if (existingRefund) {
      return this.buildRequestResponse(context, existingRefund, {
        idempotent: true,
        retryEnqueued: existingRefund.status === 'sent_to_pg' || existingRefund.status === 'processing_at_pg',
      });
    }

    if (context.reservation.status !== 'CONFIRMED') {
      throw new BadRequestException('환불 가능한 예매 상태가 아닙니다');
    }

    const requestedRefund = await this.insertRequestedRefund(context, reason);

    try {
      const cancelResult = await this.tossPaymentsClient.cancelPayment(
        context.payment.paymentKey,
        reason,
      );

      if (isTossCancelCompleted(cancelResult)) {
        const completedRefund = await this.finalizeRefundSuccess(
          context,
          requestedRefund.id,
          reason,
          cancelResult,
        );

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
      const jobId = await this.scheduleRefundCancelRetry(processingRefund.id, processingRefund.retryCount);

      return this.buildRequestResponse(context, processingRefund, {
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
        const jobId = await this.scheduleRefundCancelRetry(retryableRefund.id, retryableRefund.retryCount);

        return this.buildRequestResponse(context, retryableRefund, {
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

  protected async findExistingRefund(
    reservationId: string,
  ): Promise<RefundRecord | null> {
    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.reservationId, reservationId));

    return refund ?? null;
  }

  protected async insertRequestedRefund(
    context: ReservationRefundContext,
    reason: string,
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
        resultMessage: 'Refund requested by user',
        providerMetadata: {
          cancelReason: reason,
          reservationNumber: context.reservation.reservationNumber,
          paymentKey: context.payment.paymentKey,
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

  protected async finalizeRefundSuccess(
    context: ReservationRefundContext,
    refundId: string,
    reason: string,
    response: TossPaymentResponse,
  ): Promise<RefundRecord> {
    const now = new Date();
    const holdWindow = this.resolveHoldWindowMinutes(context.bookingPolicy);
    const delaySeconds = pickCancelledSeatReleaseDelaySeconds(
      holdWindow.min,
      holdWindow.max,
    );
    const releaseAt = new Date(now.getTime() + delaySeconds * 1000);
    const seatIdentities = context.seats.map((seat) =>
      normalizeReservationSeatIdentity(seat.seatId),
    );

    const [completedRefund] = await this.db.transaction(async (tx) => {
      const [updatedRefund] = await tx
        .update(refunds)
        .set({
          status: 'completed',
          sentToPgAt: now,
          completedAt: now,
          resultCode: response.status,
          resultMessage: 'PG cancel completed',
          failureReason: null,
          expectedDepositAt: calculateExpectedRefundDepositAt(now),
          customerServiceCtaVisible: false,
          providerMetadata: {
            cancelReason: reason,
            paymentStatus: response.status,
          },
          updatedAt: now,
        })
        .where(eq(refunds.id, refundId))
        .returning();

      await tx
        .update(reservations)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: reason,
          updatedAt: now,
        })
        .where(eq(reservations.id, context.reservation.id));

      await tx
        .update(payments)
        .set({
          status: 'CANCELED',
          cancelledAt: now,
          cancelReason: reason,
          providerMetadata: {
            ...(context.payment.providerMetadata as Record<string, unknown> | null),
            refundCompletedAt: now.toISOString(),
          },
        })
        .where(eq(payments.id, context.payment.id));

      for (const seatIdentity of seatIdentities) {
        await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            heldCancelledAt: now,
            reopenHoldUntil: releaseAt,
            reopenJobId: SEAT_RELEASE_PENDING_JOB_ID,
            soldAt: null,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
            ),
          );
      }

      return [updatedRefund];
    });

    if (!completedRefund) {
      throw new NotFoundException('완료된 환불 상태를 저장하지 못했습니다');
    }

    const releaseJobId = await this.scheduleCancelledSeatRelease(
      context,
      seatIdentities,
      releaseAt,
    );

    if (releaseJobId) {
      await this.updateSeatReleaseJobId(
        context.reservation.showtimeId,
        seatIdentities,
        releaseJobId,
      );
    } else {
      await this.updateSeatReleaseJobId(
        context.reservation.showtimeId,
        seatIdentities,
        SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID,
      );
    }

    return completedRefund;
  }

  protected async scheduleCancelledSeatRelease(
    context: ReservationRefundContext,
    seatIdentities: SeatIdentityPayload[],
    releaseAt: Date,
  ): Promise<string | null> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(
        `pg-boss unavailable. release-cancelled-seat job skipped for reservationId=${context.reservation.id}`,
      );
      return null;
    }

    const payload: ReleaseCancelledSeatJobPayload = {
      reservationId: context.reservation.id,
      showtimeId: context.reservation.showtimeId,
      releaseAt: releaseAt.toISOString(),
      seatIdentities,
    };

    return this.pgBoss.send(PG_BOSS_JOB_NAMES.releaseCancelledSeat, payload, {
      startAfter: releaseAt,
      singletonKey: context.reservation.id,
      retryLimit: 3,
      retryBackoff: true,
      retryDelay: 30,
    });
  }

  protected async updateSeatReleaseJobId(
    showtimeId: string,
    seatIdentities: SeatIdentityPayload[],
    jobId: string,
  ): Promise<void> {
    for (const seatIdentity of seatIdentities) {
      await this.db
        .update(seatInventories)
        .set({ reopenJobId: jobId })
        .where(
          and(
            eq(seatInventories.showtimeId, showtimeId),
            eq(seatInventories.floorKey, seatIdentity.floorKey),
            eq(seatInventories.seatKey, seatIdentity.seatKey),
          ),
        );
    }
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

    return this.pgBoss.send(
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
  }
}
