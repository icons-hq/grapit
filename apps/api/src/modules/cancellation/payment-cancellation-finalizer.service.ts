import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
    const seatIdentities = input.context.seats.map((seat) =>
      normalizeReservationSeatIdentity(seat.seatId),
    );
    const preallocatedReleaseJobId = randomUUID();
    const releaseEnqueued = await this.scheduleCancelledSeatRelease(
      input.context,
      seatIdentities,
      releaseAt,
      preallocatedReleaseJobId,
    );
    const releaseJobId = releaseEnqueued
      ? preallocatedReleaseJobId
      : JOB_ENQUEUE_FAILED;

    await this.db.transaction(async (tx) => {
      if (input.refundId) {
        await tx
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
          .where(eq(refunds.id, input.refundId));
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

      await tx
        .update(ticketItems)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: input.reason,
          reopenState: 'held_cancelled',
          reopenHoldUntil: releaseAt,
          reopenJobId: releaseJobId,
          updatedAt: now,
        })
        .where(eq(ticketItems.reservationId, input.context.reservation.id));

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
