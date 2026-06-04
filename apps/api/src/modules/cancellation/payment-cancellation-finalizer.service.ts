import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
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
  seats: Array<{
    seatId: string;
    floorKey?: string | null;
    seatKey?: string | null;
  }>;
}

export type PaymentCancellationActor =
  | { kind: 'user' }
  | { kind: 'admin'; operatorUserId: string }
  | { kind: 'system' };

export interface FinalizeFullPaymentCancellationInput {
  context: FullPaymentCancellationContext;
  refundId?: string;
  ticketItemCancellation?: {
    ticketItemId: string;
    cancellationFee: number;
    serviceFeeRefund: number;
    refundableAmount: number;
  };
  reason: string;
  providerResponse?: PaymentCancellationProviderResponse;
  actor?: PaymentCancellationActor;
  source: 'refund_request' | 'refund_retry' | 'cancel_webhook' | 'ticket_item';
}

export type PaymentCancellationProviderResponse = {
  status?: string;
} & Record<string, unknown>;

export interface FinalizeFullPaymentCancellationResult {
  releaseJobId: string;
  releaseEnqueued: boolean;
}

type CancellationSource = FinalizeFullPaymentCancellationInput['source'];
type SeatReleaseState = {
  seatIdentity: SeatIdentityPayload;
  reopenJobId: string | null;
};

const RESULT_MESSAGE_BY_SOURCE: Record<CancellationSource, string> = {
  refund_request: 'PG cancel completed',
  refund_retry: 'PG cancel completed after retry',
  cancel_webhook: 'PG cancel completed from webhook',
  ticket_item: 'PG cancel completed for ticket item',
};

const REDACTED_PROVIDER_METADATA_VALUE = '[REDACTED]';
const SENSITIVE_PROVIDER_METADATA_KEY =
  /(secret|password|authorization|credential|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key)/i;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeProviderMetadata(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_PROVIDER_METADATA_KEY.test(key)) {
    return REDACTED_PROVIDER_METADATA_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderMetadata(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeProviderMetadata(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function sanitizeProviderCancellationPayload(
  providerResponse: PaymentCancellationProviderResponse | undefined,
): Record<string, unknown> | undefined {
  if (!providerResponse) {
    return undefined;
  }

  return sanitizeProviderMetadata(providerResponse) as Record<string, unknown>;
}

function normalizeReservationSeatIdentity(seat: {
  seatId: string;
  floorKey?: string | null;
  seatKey?: string | null;
}): SeatIdentityPayload {
  const identity = normalizeSeatIdentity(seat);
  return {
    floorKey: identity.floorKey,
    seatId: identity.seatId,
    seatKey: identity.seatKey,
  };
}

function uniqueSeatIdentities(
  seats: FullPaymentCancellationContext['seats'],
): SeatIdentityPayload[] {
  const seen = new Set<string>();
  const seatIdentities: SeatIdentityPayload[] = [];

  for (const seat of seats) {
    const seatIdentity = normalizeReservationSeatIdentity(seat);
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
    const providerCancellation = sanitizeProviderCancellationPayload(
      input.providerResponse,
    );
    const isPartialTicketItemCancellation =
      input.ticketItemCancellation !== undefined
      && input.providerResponse?.status === 'PARTIAL_CANCELED';
    const seatReleaseStates: SeatReleaseState[] = [];

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
              ...(providerCancellation ? { providerCancellation } : {}),
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
        if (updatedRefunds.length !== 1) {
          throw new BadRequestException('환불 업데이트 결과가 유효하지 않습니다');
        }
      }

      if (!isPartialTicketItemCancellation) {
        const updatedReservations = await tx
          .update(reservations)
          .set({
            status: 'CANCELLED',
            cancelledAt: now,
            cancelReason: input.reason,
            updatedAt: now,
          })
          .where(eq(reservations.id, input.context.reservation.id))
          .returning({ id: reservations.id });

        if (updatedReservations.length === 0) {
          throw new NotFoundException('예매 정보를 찾을 수 없습니다');
        }
        if (updatedReservations.length !== 1) {
          throw new BadRequestException('예매 취소 업데이트 결과가 유효하지 않습니다');
        }

        const updatedPayments = await tx
          .update(payments)
          .set({
            status: 'CANCELED',
            cancelledAt: now,
            cancelReason: input.reason,
            providerMetadata: {
              ...toRecord(input.context.payment.providerMetadata),
              refundCompletedAt: now.toISOString(),
              cancellationSource: input.source,
              ...(providerCancellation ? { providerCancellation } : {}),
            },
          })
          .where(eq(payments.id, input.context.payment.id))
          .returning({ id: payments.id });

        if (updatedPayments.length === 0) {
          throw new NotFoundException('결제 정보를 찾을 수 없습니다');
        }
        if (updatedPayments.length !== 1) {
          throw new BadRequestException('결제 취소 업데이트 결과가 유효하지 않습니다');
        }
      }

      if (seatIdentities.length > 0) {
        const ticketItemCancellation = input.ticketItemCancellation;
        const ticketItemUpdateValues = ticketItemCancellation
          ? {
              status: 'cancelled' as const,
              cancelledAt: now,
              cancelReason: input.reason,
              cancellationFee: ticketItemCancellation.cancellationFee,
              serviceFeeRefund: ticketItemCancellation.serviceFeeRefund,
              refundableAmount: ticketItemCancellation.refundableAmount,
              reopenState: 'not_required' as const,
              reopenHoldUntil: null,
              reopenJobId: null,
              updatedAt: now,
            }
          : {
              status: 'cancelled' as const,
              cancelledAt: now,
              cancelReason: input.reason,
              cancellationFee: 0,
              serviceFeeRefund: sql`${ticketItems.serviceFee}`,
              refundableAmount: sql`${ticketItems.price} + ${ticketItems.serviceFee}`,
              reopenState: 'not_required' as const,
              reopenHoldUntil: null,
              reopenJobId: null,
              updatedAt: now,
            };
        const ticketItemScope = ticketItemCancellation
          ? eq(ticketItems.id, ticketItemCancellation.ticketItemId)
          : inArray(
              ticketItems.seatKey,
              seatIdentities.map((seatIdentity) => seatIdentity.seatKey),
            );
        const updatedTicketItems = await tx
          .update(ticketItems)
          .set(ticketItemUpdateValues)
          .where(
            and(
              eq(ticketItems.reservationId, input.context.reservation.id),
              eq(ticketItems.paymentId, input.context.payment.id),
              eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
              ticketItemScope,
              inArray(ticketItems.status, ['active', 'cancellation_pending', 'cancelled']),
            ),
          )
          .returning({ id: ticketItems.id });

        if (updatedTicketItems.length < seatIdentities.length) {
          throw new BadRequestException('취소할 티켓 항목 수가 일치하지 않습니다');
        }

        const targetTicketItemIds = updatedTicketItems.map(
          (ticketItem) => ticketItem.id,
        );

        const updatedTickets = await tx
          .update(tickets)
          .set({
            status: 'revoked',
            revokedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(tickets.reservationId, input.context.reservation.id),
              eq(tickets.paymentId, input.context.payment.id),
              eq(tickets.showtimeId, input.context.reservation.showtimeId),
              inArray(tickets.ticketItemId, targetTicketItemIds),
              inArray(tickets.status, ['active', 'revoked']),
            ),
          )
          .returning({ id: tickets.id });

        if (updatedTickets.length !== targetTicketItemIds.length) {
          throw new BadRequestException('취소할 티켓 수가 일치하지 않습니다');
        }
      }

      for (const seatIdentity of seatIdentities) {
        const updatedSoldSeatInventory = await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: now,
            reopenHoldUntil: releaseAt,
            reopenJobId: JOB_ENQUEUE_FAILED,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'sold'),
            ),
          )
          .returning({ id: seatInventories.id });

        if (updatedSoldSeatInventory.length === 1) {
          seatReleaseStates.push({
            seatIdentity,
            reopenJobId: JOB_ENQUEUE_FAILED,
          });
          continue;
        }

        if (updatedSoldSeatInventory.length > 1) {
          throw new BadRequestException('취소할 좌석 재고 상태가 유효하지 않습니다');
        }

        const updatedHeldCancelledSeatInventory = await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: sql`coalesce(${seatInventories.heldCancelledAt}, ${now})`,
            reopenHoldUntil: sql`case when ${seatInventories.reopenJobId} is not null and ${seatInventories.reopenJobId} <> ${JOB_ENQUEUE_FAILED} then ${seatInventories.reopenHoldUntil} else ${releaseAt} end`,
            reopenJobId: sql`case when ${seatInventories.reopenJobId} is not null and ${seatInventories.reopenJobId} <> ${JOB_ENQUEUE_FAILED} then ${seatInventories.reopenJobId} else ${JOB_ENQUEUE_FAILED} end`,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'held_cancelled'),
            ),
          )
          .returning({
            id: seatInventories.id,
            reopenJobId: seatInventories.reopenJobId,
          });

        if (updatedHeldCancelledSeatInventory.length !== 1) {
          throw new BadRequestException('취소할 좌석 재고 상태가 유효하지 않습니다');
        }

        seatReleaseStates.push({
          seatIdentity,
          reopenJobId: updatedHeldCancelledSeatInventory[0]?.reopenJobId ?? JOB_ENQUEUE_FAILED,
        });
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

    const seatIdentitiesNeedingReleaseJob = seatReleaseStates
      .filter((state) =>
        !state.reopenJobId || state.reopenJobId === JOB_ENQUEUE_FAILED
      )
      .map((state) => state.seatIdentity);
    const existingReleaseJobId = seatReleaseStates
      .map((state) => state.reopenJobId)
      .find((reopenJobId) =>
        Boolean(reopenJobId) && reopenJobId !== JOB_ENQUEUE_FAILED
      );

    if (seatIdentities.length > 0 && seatIdentitiesNeedingReleaseJob.length === 0) {
      return {
        releaseJobId: existingReleaseJobId ?? JOB_ENQUEUE_FAILED,
        releaseEnqueued: Boolean(existingReleaseJobId),
      };
    }

    const releaseTargetSeatIdentities =
      seatIdentitiesNeedingReleaseJob.length > 0
        ? seatIdentitiesNeedingReleaseJob
        : seatIdentities;

    const releaseEnqueued = await this.scheduleCancelledSeatRelease(
      input.context,
      releaseTargetSeatIdentities,
      releaseAt,
      preallocatedReleaseJobId,
    );
    if (releaseEnqueued) {
      const actualJobIdPersisted = await this.persistReleaseJobEnqueueSuccess(
        input.context,
        releaseTargetSeatIdentities,
        preallocatedReleaseJobId,
      );
      if (actualJobIdPersisted) {
        return {
          releaseJobId: preallocatedReleaseJobId,
          releaseEnqueued: true,
        };
      }
    }

    return {
      releaseJobId: JOB_ENQUEUE_FAILED,
      releaseEnqueued: false,
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

  private async persistReleaseJobEnqueueSuccess(
    context: FullPaymentCancellationContext,
    seatIdentities: SeatIdentityPayload[],
    releaseJobId: string,
  ): Promise<boolean> {
    if (seatIdentities.length === 0) {
      return true;
    }

    try {
      await this.db.transaction(async (tx) => {
        const seatIdentityFilter =
          seatIdentities.length === 1
            ? and(
                eq(seatInventories.floorKey, seatIdentities[0]!.floorKey),
                eq(seatInventories.seatKey, seatIdentities[0]!.seatKey),
              )
            : or(
                ...seatIdentities.map((seatIdentity) =>
                  and(
                    eq(seatInventories.floorKey, seatIdentity.floorKey),
                    eq(seatInventories.seatKey, seatIdentity.seatKey),
                  ),
                ),
              );

        const updatedSeatInventories = await tx
          .update(seatInventories)
          .set({ reopenJobId: releaseJobId })
          .where(
            and(
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.status, 'held_cancelled'),
              eq(seatInventories.reopenJobId, JOB_ENQUEUE_FAILED),
              seatIdentityFilter,
            ),
          )
          .returning({ id: seatInventories.id });

        if (updatedSeatInventories.length !== seatIdentities.length) {
          throw new Error(
            `Expected ${seatIdentities.length} released seat rows, updated ${updatedSeatInventories.length}`,
          );
        }
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Manual reconciliation required: release-cancelled-seat job was enqueued but seat reopen job id was not persisted for reservationId=${context.reservation.id}, releaseJobId=${releaseJobId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
