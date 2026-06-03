import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { normalizeSeatIdentity } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingOperationAuditLogs,
  payments,
  refunds,
  reservations,
  seatInventories,
  ticketItems,
  tickets,
} from '../../database/schema/index.js';
import { pickCancelledSeatReleaseDelaySeconds } from '../jobs/cancelled-seat-release.worker.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type ReleaseCancelledSeatJobPayload,
  type SeatIdentityPayload,
} from '../jobs/pgboss.provider.js';

// Keep local to avoid importing RefundService while this split-out module is not wired yet.
export const JOB_ENQUEUE_FAILED = 'JOB_ENQUEUE_FAILED';

const DEFAULT_CANCELLED_SEAT_HOLD_MINUTES = 1;
const DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES = 10;

export interface FullPaymentCancellationContext {
  reservation: {
    id: string;
    showtimeId: string;
    reservationNumber?: string;
  };
  payment: {
    id: string;
    paymentKey: string;
    providerMetadata?: unknown;
  };
  bookingPolicy: {
    cancelledSeatHoldMinMinutes?: number | null;
    cancelledSeatHoldMaxMinutes?: number | null;
  } | null;
  seats: Array<{ seatId: string }>;
}

export type PaymentCancellationActor =
  | { kind: 'user' }
  | { kind: 'admin'; operatorUserId: string }
  | { kind: 'system' };

export interface FinalizeFullPaymentCancellationInput {
  context: FullPaymentCancellationContext;
  refundId?: string;
  reason: string;
  providerResponse?: { status?: string };
  actor?: PaymentCancellationActor;
  source: 'refund_request' | 'refund_retry' | 'cancel_webhook' | 'ticket_item';
}

export interface FinalizeFullPaymentCancellationResult {
  releaseJobId: string;
  releaseEnqueued: boolean;
}

type CancellationSource = FinalizeFullPaymentCancellationInput['source'];

const RESULT_MESSAGE_BY_SOURCE: Record<CancellationSource, string> = {
  refund_request: 'PG cancel completed',
  refund_retry: 'PG cancel completed after retry',
  cancel_webhook: 'PG cancel completed from webhook',
  ticket_item: 'PG cancel completed for ticket item',
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeReservationSeatIdentity(seatId: string): SeatIdentityPayload {
  const identity = normalizeSeatIdentity({ seatId });
  return {
    floorKey: identity.floorKey,
    seatId: identity.seatId,
    seatKey: identity.seatKey,
  };
}

function uniqueSeatIdentities(seats: Array<{ seatId: string }>): SeatIdentityPayload[] {
  const seen = new Set<string>();
  const seatIdentities: SeatIdentityPayload[] = [];

  for (const seat of seats) {
    const seatIdentity = normalizeReservationSeatIdentity(seat.seatId);
    if (seen.has(seatIdentity.seatKey)) {
      continue;
    }
    seen.add(seatIdentity.seatKey);
    seatIdentities.push(seatIdentity);
  }

  return seatIdentities;
}

@Injectable()
export class PaymentCancellationFinalizerService {
  private readonly logger = new Logger(PaymentCancellationFinalizerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
  ) {}

  async finalizeFullPaymentCancellation(
    input: FinalizeFullPaymentCancellationInput,
  ): Promise<FinalizeFullPaymentCancellationResult> {
    const now = new Date();
    const holdWindow = this.resolveHoldWindowMinutes(input.context.bookingPolicy);
    const delaySeconds = pickCancelledSeatReleaseDelaySeconds(
      holdWindow.min,
      holdWindow.max,
    );
    const releaseAt = new Date(now.getTime() + delaySeconds * 1000);
    const seatIdentities = uniqueSeatIdentities(input.context.seats);
    const preallocatedReleaseJobId = randomUUID();
    let releaseEnqueued = false;
    let releaseJobId = JOB_ENQUEUE_FAILED;

    await this.db.transaction(async (tx) => {
      if (input.refundId) {
        const updatedRefunds = await tx
          .update(refunds)
          .set({
            status: 'completed',
            sentToPgAt: now,
            completedAt: now,
            updatedAt: now,
            resultCode: input.providerResponse?.status ?? 'CANCELED',
            resultMessage: RESULT_MESSAGE_BY_SOURCE[input.source],
            failureReason: null,
            expectedDepositAt: addDays(now, 3),
            customerServiceCtaVisible: false,
            providerMetadata: {
              cancelReason: input.reason,
              paymentStatus: input.providerResponse?.status ?? 'CANCELED',
              source: input.source,
            },
          })
          .where(
            and(
              eq(refunds.id, input.refundId),
              eq(refunds.reservationId, input.context.reservation.id),
              eq(refunds.paymentId, input.context.payment.id),
            ),
          )
          .returning({ id: refunds.id });

        if (updatedRefunds.length === 0) {
          throw new NotFoundException('환불 정보를 찾을 수 없습니다');
        }
      }

      await tx
        .update(reservations)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: input.reason,
          updatedAt: now,
        })
        .where(eq(reservations.id, input.context.reservation.id));

      await tx
        .update(payments)
        .set({
          status: 'CANCELED',
          cancelledAt: now,
          cancelReason: input.reason,
          providerMetadata: {
            ...toRecord(input.context.payment.providerMetadata),
            refundCompletedAt: now.toISOString(),
            cancellationSource: input.source,
          },
        })
        .where(eq(payments.id, input.context.payment.id));

      await tx
        .update(tickets)
        .set({
          status: 'revoked',
          revokedAt: now,
          updatedAt: now,
        })
        .where(eq(tickets.reservationId, input.context.reservation.id));

      if (seatIdentities.length > 0) {
        const updatedTicketItems = await tx
          .update(ticketItems)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            cancelReason: input.reason,
            cancellationFee: 0,
            serviceFeeRefund: sql`${ticketItems.serviceFee}`,
            refundableAmount: sql`${ticketItems.price} + ${ticketItems.serviceFee}`,
            reopenState: 'not_required',
            reopenHoldUntil: null,
            reopenJobId: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(ticketItems.reservationId, input.context.reservation.id),
              eq(ticketItems.paymentId, input.context.payment.id),
              eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
              inArray(
                ticketItems.seatKey,
                seatIdentities.map((seatIdentity) => seatIdentity.seatKey),
              ),
              inArray(ticketItems.status, ['active', 'cancellation_pending']),
            ),
          )
          .returning({ id: ticketItems.id });

        if (updatedTicketItems.length < seatIdentities.length) {
          throw new BadRequestException('취소할 티켓 항목 수가 일치하지 않습니다');
        }
      }

      releaseEnqueued = await this.scheduleCancelledSeatRelease(
        input.context,
        seatIdentities,
        releaseAt,
        preallocatedReleaseJobId,
      );
      releaseJobId = releaseEnqueued
        ? preallocatedReleaseJobId
        : JOB_ENQUEUE_FAILED;

      for (const seatIdentity of seatIdentities) {
        await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: now,
            reopenHoldUntil: releaseAt,
            reopenJobId: releaseJobId,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
            ),
          );
      }

      if (input.actor?.kind === 'admin' && seatIdentities.length > 0) {
        const { operatorUserId } = input.actor;
        await tx.insert(bookingOperationAuditLogs).values(
          seatIdentities.map((seatIdentity) => ({
            operatorUserId,
            action: 'admin_refund' as const,
            seatKey: seatIdentity.seatKey,
            reservationId: input.context.reservation.id,
            createdAt: now,
          })),
        );
      }
    });

    return {
      releaseJobId,
      releaseEnqueued,
    };
  }

  private resolveHoldWindowMinutes(
    bookingPolicy: FullPaymentCancellationContext['bookingPolicy'],
  ): { min: number; max: number } {
    return {
      min:
        bookingPolicy?.cancelledSeatHoldMinMinutes ??
        DEFAULT_CANCELLED_SEAT_HOLD_MINUTES,
      max:
        bookingPolicy?.cancelledSeatHoldMaxMinutes ??
        DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES,
    };
  }

  private async scheduleCancelledSeatRelease(
    context: FullPaymentCancellationContext,
    seatIdentities: SeatIdentityPayload[],
    releaseAt: Date,
    releaseJobId: string,
  ): Promise<boolean> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(
        `pg-boss unavailable. release-cancelled-seat job skipped for reservationId=${context.reservation.id}`,
      );
      return false;
    }

    const payload: ReleaseCancelledSeatJobPayload = {
      reservationId: context.reservation.id,
      showtimeId: context.reservation.showtimeId,
      releaseAt: releaseAt.toISOString(),
      seatIdentities,
    };

    try {
      const jobId = await this.pgBoss.send(
        PG_BOSS_JOB_NAMES.releaseCancelledSeat,
        payload,
        {
          id: releaseJobId,
          startAfter: releaseAt,
          singletonKey: context.reservation.id,
          retryLimit: 3,
          retryBackoff: true,
          retryDelay: 30,
        },
      );
      return jobId === releaseJobId;
    } catch (error) {
      this.logger.error(
        `pg-boss release-cancelled-seat enqueue failed for reservationId=${context.reservation.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
