import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { TicketItemCancellationCommand } from '../../database/schema/ticket-items.js';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { normalizeSeatIdentity } from '@grabit/shared';
import type { CancellationQuote } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingOperationAuditLogs,
  payments,
  refunds,
  reservations,
  seatInventories,
  ticketBenefitEntitlements,
  ticketItems,
  tickets,
} from '../../database/schema/index.js';
import {
  ACTIVE_TICKET_ITEM_STATUSES,
  noActiveTicketItemOnSeat,
} from '../../database/seat-ownership.js';
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
    cancellationCommand?: TicketItemCancellationCommand | null;
  };
  fullReservationCancellationQuote?: CancellationQuote;
  reason: string;
  providerResponse?: PaymentCancellationProviderResponse;
  actor?: PaymentCancellationActor;
  source: 'refund_request' | 'refund_retry' | 'cancel_webhook' | 'ticket_item';
  /**
   * The refundable amount is zero, so no provider cancellation was requested. The reservation and items are
   * cancelled locally while the captured payment keeps its provider status (the whole balance is retained).
   */
  localOnly?: boolean;
}

export type PaymentCancellationProviderResponse = {
  status?: string;
  balanceAmount?: number;
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
const LOCAL_ONLY_RESULT_CODE = 'NO_PROVIDER_REFUND';
const SENSITIVE_PROVIDER_METADATA_KEY =
  /(secret|password|authorization|credential|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key)/i;


function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveLocalPaymentStatus(
  providerResponse: PaymentCancellationProviderResponse | undefined,
): 'CANCELED' | 'PARTIAL_CANCELED' {
  if (providerResponse?.status === 'CANCELED' || providerResponse?.balanceAmount === 0) {
    return 'CANCELED';
  }

  if (
    providerResponse?.status === 'PARTIAL_CANCELED'
    && typeof providerResponse.balanceAmount === 'number'
    && providerResponse.balanceAmount > 0
  ) {
    return 'PARTIAL_CANCELED';
  }

  return 'CANCELED';
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
    let seatIdentities = uniqueSeatIdentities(input.context.seats);
    const preallocatedReleaseJobId = randomUUID();
    const providerCancellation = sanitizeProviderCancellationPayload(
      input.providerResponse,
    );
    const fullReservationCancellationQuote = input.fullReservationCancellationQuote;
    const localPaymentStatus = resolveLocalPaymentStatus(input.providerResponse);
    const seatReleaseStates: SeatReleaseState[] = [];

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM reservations WHERE id = ${input.context.reservation.id} FOR UPDATE`);
      const remainingTicketItems = input.ticketItemCancellation
        ? await tx.select({ id: ticketItems.id }).from(ticketItems).where(and(
            eq(ticketItems.reservationId, input.context.reservation.id),
            ne(ticketItems.id, input.ticketItemCancellation.ticketItemId),
            inArray(ticketItems.status, [...ACTIVE_TICKET_ITEM_STATUSES]),
          )).limit(1)
        : [];
      const preservesRemainingTickets = remainingTicketItems.length > 0;
      const command = input.ticketItemCancellation?.cancellationCommand;
      if (command) {
        const cancellations = Array.isArray(input.providerResponse?.cancels)
          ? input.providerResponse.cancels as Array<Record<string, unknown>> : [];
        const completed = cancellations.find((cancel) => cancel.cancelStatus === 'DONE'
          && cancel.cancelReason === command.reason
          && typeof cancel.cancelAmount === 'number'
          && Math.round(cancel.cancelAmount * (command.currency === 'USD' ? 100 : 1)) === command.amountMinor
          && (!command.options.cancelRequestId || cancel.cancelRequestId === command.options.cancelRequestId));
        if (!completed) throw new BadRequestException('취소 요청에 대응하는 결제사 완료 근거를 확인할 수 없습니다');
        await tx.update(ticketItems).set({
          cancellationCommand: sql`${ticketItems.cancellationCommand} || ${JSON.stringify({
            completedAt: typeof completed.canceledAt === 'string' ? completed.canceledAt : now.toISOString(),
            ...(typeof completed.transactionKey === 'string' ? { transactionKey: completed.transactionKey } : {}),
          })}::jsonb`,
        }).where(and(eq(ticketItems.id, input.ticketItemCancellation!.ticketItemId),
          eq(ticketItems.paymentId, input.context.payment.id)));
      }
      if (input.refundId) {
        const updatedRefunds = await tx
          .update(refunds)
          .set({
            status: 'completed',
            sentToPgAt: sql`coalesce(${refunds.sentToPgAt}, ${now.toISOString()}::timestamptz)`,
            completedAt: now,
            updatedAt: now,
            resultCode: input.localOnly
              ? LOCAL_ONLY_RESULT_CODE
              : input.providerResponse?.status ?? 'CANCELED',
            resultMessage: input.localOnly
              ? 'Cancelled locally without a provider refund because nothing is refundable'
              : RESULT_MESSAGE_BY_SOURCE[input.source],
            failureReason: null,
            expectedDepositAt: null,
            customerServiceCtaVisible: false,
            providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
              cancelReason: input.reason,
              paymentStatus: input.localOnly ? null : input.providerResponse?.status ?? 'CANCELED',
              source: input.source,
              ...(input.localOnly ? { localOnlyCancellation: true } : {}),
              ...(fullReservationCancellationQuote
                ? { cancellationQuote: fullReservationCancellationQuote }
                : {}),
              ...(providerCancellation ? { providerCancellation } : {}),
            })}::jsonb`,
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

      if (!preservesRemainingTickets) {
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

        const updatedPayments = input.localOnly ? [{ id: input.context.payment.id }] : await tx
          .update(payments)
          .set({
            status: localPaymentStatus,
            cancelledAt: now,
            cancelReason: input.reason,
            providerMetadata: {
              ...toRecord(input.context.payment.providerMetadata),
              refundCompletedAt: now.toISOString(),
              cancellationSource: input.source,
              ...(fullReservationCancellationQuote
                ? { cancellationQuote: fullReservationCancellationQuote }
                : {}),
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
        const targetTicketItemIds: string[] = [];
        const quoteSeatIdentities: SeatReleaseState['seatIdentity'][] = [];

        if (fullReservationCancellationQuote) {
          for (const item of fullReservationCancellationQuote.items) {
            const updatedTicketItems = await tx
              .update(ticketItems)
              .set({
                status: 'cancelled' as const,
                cancelledAt: now,
                cancelReason: input.reason,
                cancellationFee: item.cancellationFee,
                serviceFeeRefund: item.serviceFeeRefund,
                refundableAmount: item.refundableAmount,
                reopenState: 'not_required' as const,
                reopenHoldUntil: null,
                reopenJobId: null,
                updatedAt: now,
              })
              .where(
                and(
                  eq(ticketItems.reservationId, input.context.reservation.id),
                  eq(ticketItems.paymentId, input.context.payment.id),
                  eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
                  eq(ticketItems.id, item.ticketItemId),
                  inArray(ticketItems.status, ['active', 'cancellation_pending', 'cancelled']),
                ),
              )
              .returning({
                id: ticketItems.id,
                seatId: ticketItems.seatId,
                floorKey: ticketItems.floorKey,
                seatKey: ticketItems.seatKey,
              });

            if (updatedTicketItems.length !== 1) {
              throw new BadRequestException('취소할 티켓 항목 수가 일치하지 않습니다');
            }
            const updatedTicketItem = updatedTicketItems[0]!;
            targetTicketItemIds.push(updatedTicketItem.id);
            if (updatedTicketItem.seatId) {
              quoteSeatIdentities.push(normalizeReservationSeatIdentity(updatedTicketItem));
            }
          }
          if (quoteSeatIdentities.length > 0) {
            seatIdentities = uniqueSeatIdentities(quoteSeatIdentities);
          }
        } else if (ticketItemCancellation) {
          const updatedTicketItems = await tx
            .update(ticketItems)
            .set({
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
            })
            .where(
              and(
                eq(ticketItems.reservationId, input.context.reservation.id),
                eq(ticketItems.paymentId, input.context.payment.id),
                eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
                eq(ticketItems.id, ticketItemCancellation.ticketItemId),
                inArray(ticketItems.status, ['active', 'cancellation_pending', 'cancelled']),
              ),
            )
            .returning({ id: ticketItems.id });

          if (updatedTicketItems.length < seatIdentities.length) {
            throw new BadRequestException('취소할 티켓 항목 수가 일치하지 않습니다');
          }

          targetTicketItemIds.push(...updatedTicketItems.map(
            (ticketItem) => ticketItem.id,
          ));
        } else {
          // A provider cancellation without a stored quote (for example a PG console cancel) only cancels
          // still-valid items. Items cancelled earlier keep their own fee, refund and cancellation time,
          // their credentials are not touched again and their seats are not re-held.
          const seatKeys = seatIdentities.map((seatIdentity) => seatIdentity.seatKey);
          const updatedTicketItems = await tx
            .update(ticketItems)
            .set({
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
            })
            .where(
              and(
                eq(ticketItems.reservationId, input.context.reservation.id),
                eq(ticketItems.paymentId, input.context.payment.id),
                eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
                inArray(ticketItems.seatKey, seatKeys),
                inArray(ticketItems.status, ['active', 'cancellation_pending']),
              ),
            )
            .returning({
              id: ticketItems.id,
              seatId: ticketItems.seatId,
              floorKey: ticketItems.floorKey,
              seatKey: ticketItems.seatKey,
              price: ticketItems.price,
              serviceFee: ticketItems.serviceFee,
            });
          const cancelledTicketItems = await tx
            .select({
              id: ticketItems.id,
              seatKey: ticketItems.seatKey,
              refundableAmount: ticketItems.refundableAmount,
            })
            .from(ticketItems)
            .where(
              and(
                eq(ticketItems.reservationId, input.context.reservation.id),
                eq(ticketItems.paymentId, input.context.payment.id),
                eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
                eq(ticketItems.status, 'cancelled'),
              ),
            );
          const newlyCancelledIds = new Set(updatedTicketItems.map((ticketItem) => ticketItem.id));
          const coveredSeatKeys = new Set([
            ...updatedTicketItems.map((ticketItem) => ticketItem.seatKey),
            ...cancelledTicketItems.map((ticketItem) => ticketItem.seatKey),
          ]);

          if (seatKeys.some((seatKey) => !coveredSeatKeys.has(seatKey))) {
            throw new BadRequestException('취소할 티켓 항목 수가 일치하지 않습니다');
          }

          await this.attributeQuotelessProviderRefund(tx, input, now, updatedTicketItems,
            cancelledTicketItems.filter((ticketItem) => !newlyCancelledIds.has(ticketItem.id)));

          targetTicketItemIds.push(...updatedTicketItems.map(
            (ticketItem) => ticketItem.id,
          ));
          seatIdentities = uniqueSeatIdentities(updatedTicketItems);
        }

        await this.inactivateBenefitEntitlementsForTicketItems(
          tx,
          targetTicketItemIds,
          now,
        );

        // A provider-backed full cancellation (stored quote or quote-less provider cancel) closes the whole
        // reservation, so legacy reservation-level credentials are revoked with the target items.
        const fullCancellation = !ticketItemCancellation;
        const credentialScope = fullCancellation
          ? targetTicketItemIds.length > 0
            ? or(
                inArray(tickets.ticketItemId, targetTicketItemIds),
                isNull(tickets.ticketItemId),
              )
            : isNull(tickets.ticketItemId)
          : inArray(tickets.ticketItemId, targetTicketItemIds);

        await tx
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
              credentialScope,
              inArray(
                tickets.status,
                fullCancellation
                  ? ['active', 'revoked', 'used']
                  : ['active', 'revoked'],
              ),
            ),
          )
          .returning({ id: tickets.id, ticketItemId: tickets.ticketItemId });

        // The invariant is "no cancelled Ticket Item keeps a valid QR credential". A target item that never
        // received a credential (issuance failed and was never backfilled) has nothing to revoke and must not
        // keep a provider-cancelled refund from finalizing. A credential left valid because it belongs to
        // another payment/showtime still aborts the whole cancellation.
        const remainingValidCredentials = await tx
          .select({ id: tickets.id })
          .from(tickets)
          .where(
            and(
              eq(tickets.reservationId, input.context.reservation.id),
              credentialScope,
              inArray(tickets.status, ['active', 'used']),
            ),
          )
          .limit(1);

        if (remainingValidCredentials.length > 0) {
          throw new BadRequestException('취소할 티켓 수가 일치하지 않습니다');
        }
      }

      for (const seatIdentity of seatIdentities) {
        const recordTicketHold = async (holdUntil: Date, jobId: string | null) => {
          await tx.update(ticketItems).set({ reopenState: 'held_cancelled', reopenHoldUntil: holdUntil,
            reopenJobId: jobId, updatedAt: now }).where(and(
            eq(ticketItems.reservationId, input.context.reservation.id),
            eq(ticketItems.seatKey, seatIdentity.seatKey), eq(ticketItems.status, 'cancelled'),
          ));
        };
        const updatedSoldSeatInventory = await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: now,
            reopenHoldUntil: releaseAt,
            // Record the release job id inside the cancellation transaction. If the process dies before the
            // job is sent, or the send fails, the held-seat recovery sweep still releases the seat.
            reopenJobId: preallocatedReleaseJobId,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'sold'),
              noActiveTicketItemOnSeat(),
            ),
          )
          .returning({ id: seatInventories.id });

        if (updatedSoldSeatInventory.length === 1) {
          await recordTicketHold(releaseAt, preallocatedReleaseJobId);
          seatReleaseStates.push({
            seatIdentity,
            reopenJobId: preallocatedReleaseJobId,
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
            reopenJobId: sql`case when ${seatInventories.reopenJobId} is not null and ${seatInventories.reopenJobId} <> ${JOB_ENQUEUE_FAILED} then ${seatInventories.reopenJobId} else ${preallocatedReleaseJobId} end`,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'held_cancelled'),
              noActiveTicketItemOnSeat(),
            ),
          )
          .returning({
            id: seatInventories.id,
            reopenJobId: seatInventories.reopenJobId,
            reopenHoldUntil: seatInventories.reopenHoldUntil,
          });

        if (updatedHeldCancelledSeatInventory.length === 1) {
          await recordTicketHold(updatedHeldCancelledSeatInventory[0]?.reopenHoldUntil ?? releaseAt,
            updatedHeldCancelledSeatInventory[0]?.reopenJobId ?? preallocatedReleaseJobId);
          seatReleaseStates.push({
            seatIdentity,
            reopenJobId: updatedHeldCancelledSeatInventory[0]?.reopenJobId ?? preallocatedReleaseJobId,
          });
          continue;
        }

        // 같은 좌석이 이미 다른 예매의 유효 티켓 소유라면 좌석 해제만 건너뛰고
        // 환불/취소 확정은 계속 진행한다 (중복 발권 방지의 핵심 가드).
        const [activeOwner] = await tx
          .select({ reservationId: ticketItems.reservationId })
          .from(ticketItems)
          .where(
            and(
              eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
              eq(ticketItems.floorKey, seatIdentity.floorKey),
              eq(ticketItems.seatKey, seatIdentity.seatKey),
              inArray(ticketItems.status, [...ACTIVE_TICKET_ITEM_STATUSES]),
            ),
          )
          .limit(1);

        if (activeOwner) {
          this.logger.warn(
            `Seat release skipped: seat is owned by an active ticket item of another reservation. showtimeId=${input.context.reservation.showtimeId}, seatKey=${seatIdentity.seatKey}, cancelledReservationId=${input.context.reservation.id}, ownerReservationId=${activeOwner.reservationId}`,
          );
          continue;
        }

        throw new BadRequestException('취소할 좌석 재고 상태가 유효하지 않습니다');
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
      .filter((state) => state.reopenJobId === preallocatedReleaseJobId)
      .map((state) => state.seatIdentity);
    const existingReleaseJobId = seatReleaseStates
      .map((state) => state.reopenJobId)
      .find((reopenJobId) =>
        Boolean(reopenJobId)
        && reopenJobId !== JOB_ENQUEUE_FAILED
        && reopenJobId !== preallocatedReleaseJobId
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
      return {
        releaseJobId: preallocatedReleaseJobId,
        releaseEnqueued: true,
      };
    }

    await this.markReleaseJobEnqueueFailed(
      input.context,
      releaseTargetSeatIdentities,
      preallocatedReleaseJobId,
    );

    return {
      releaseJobId: JOB_ENQUEUE_FAILED,
      releaseEnqueued: false,
    };
  }

  /**
   * A quote-less provider cancellation records each newly cancelled Ticket Item at price + service fee.
   * The money the provider actually returned in this cancellation is its cancelled total minus what the
   * ledger already recorded for earlier cancellations. When that differs (for example a console cancel of
   * the remaining balance also returns the fee retained by an earlier seat cancellation):
   * - a single newly cancelled item records the provider amount as its refund, so refund totals match the
   *   provider; earlier items keep their own fee evidence;
   * - several items keep price + service fee and the difference is recorded on the payment as an
   *   unattributed amount for finance reconciliation.
   * Non-KRW or incomplete provider amounts are marked unverified.
   */
  private async attributeQuotelessProviderRefund(
    tx: DrizzleDB,
    input: FinalizeFullPaymentCancellationInput,
    now: Date,
    newlyCancelled: Array<{ id: string; price: number; serviceFee: number }>,
    earlierCancelled: Array<{ refundableAmount: number }>,
  ): Promise<void> {
    if (newlyCancelled.length === 0 || input.localOnly) {
      return;
    }

    const response = input.providerResponse;
    const faceValueAmount = newlyCancelled.reduce((total, item) => total + item.price + item.serviceFee, 0);
    const knownKrwAmounts = response?.currency === 'KRW'
      && typeof response.totalAmount === 'number'
      && typeof response.balanceAmount === 'number';
    let reconciliation: Record<string, unknown> | null = null;

    if (!knownKrwAmounts) {
      reconciliation = { status: 'UNVERIFIED', faceValueAmount, reason: 'PROVIDER_KRW_AMOUNT_UNAVAILABLE' };
    } else {
      const providerCancelledTotal = (response.totalAmount as number) - (response.balanceAmount as number);
      const earlierRecordedAmount = earlierCancelled.reduce((total, item) => total + item.refundableAmount, 0);
      const providerCancelAmount = providerCancelledTotal - earlierRecordedAmount;
      if (providerCancelAmount !== faceValueAmount) {
        const attributable = newlyCancelled.length === 1
          && Number.isSafeInteger(providerCancelAmount)
          && providerCancelAmount > 0;
        if (attributable) {
          const item = newlyCancelled[0]!;
          const cancellationFee = Math.max(0, item.price - providerCancelAmount);
          const serviceFeeRefund = Math.min(item.serviceFee, Math.max(0, providerCancelAmount - item.price));
          await tx.update(ticketItems).set({
            cancellationFee,
            serviceFeeRefund,
            refundableAmount: providerCancelAmount,
            updatedAt: now,
          }).where(eq(ticketItems.id, item.id));
        }
        reconciliation = {
          status: attributable ? 'ATTRIBUTED' : 'UNATTRIBUTED',
          providerCancelAmount,
          faceValueAmount,
          differenceAmount: providerCancelAmount - faceValueAmount,
          earlierRecordedAmount,
          ...(attributable ? { attributedTicketItemId: newlyCancelled[0]!.id } : {}),
        };
      }
    }

    if (!reconciliation) {
      return;
    }

    this.logger.warn(
      `Quote-less provider cancellation needs finance reconciliation. reservationId=${input.context.reservation.id}, paymentId=${input.context.payment.id}, status=${String(reconciliation.status)}`,
    );
    await tx.update(payments).set({
      providerMetadata: sql`coalesce(${payments.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
        quotelessCancellationReconciliation: { ...reconciliation, recordedAt: now.toISOString() },
      })}::jsonb`,
    }).where(eq(payments.id, input.context.payment.id));
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
          singletonKey: `${context.reservation.id}:${createHash('sha256')
            .update(JSON.stringify(seatIdentities.map((seat) => seat.seatKey).sort())).digest('hex')}`,
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

  /**
   * The release job was never created: mark the held seats with the enqueue-failure sentinel so operators can
   * see them. Release itself does not depend on this marker; the held-seat recovery sweep frees any held seat
   * whose hold has expired.
   */
  private async markReleaseJobEnqueueFailed(
    context: FullPaymentCancellationContext,
    seatIdentities: SeatIdentityPayload[],
    releaseJobId: string,
  ): Promise<void> {
    if (seatIdentities.length === 0) {
      return;
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

        await tx
          .update(seatInventories)
          .set({ reopenJobId: JOB_ENQUEUE_FAILED })
          .where(
            and(
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.status, 'held_cancelled'),
              eq(seatInventories.reopenJobId, releaseJobId),
              seatIdentityFilter,
            ),
          )
          .returning({ id: seatInventories.id });
        await tx.update(ticketItems).set({ reopenJobId: JOB_ENQUEUE_FAILED }).where(and(
          eq(ticketItems.reservationId, context.reservation.id),
          inArray(ticketItems.seatKey, seatIdentities.map((seat) => seat.seatKey)),
          eq(ticketItems.status, 'cancelled'), eq(ticketItems.reopenState, 'held_cancelled'),
          eq(ticketItems.reopenJobId, releaseJobId),
        ));
      });
    } catch (error) {
      this.logger.error(
        `release-cancelled-seat job was not enqueued and the failure marker could not be recorded for reservationId=${context.reservation.id}, releaseJobId=${releaseJobId}. The held-seat recovery sweep releases these seats after their hold expires.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async inactivateBenefitEntitlementsForTicketItems(
    db: DrizzleDB,
    ticketItemIds: string[],
    now: Date,
  ): Promise<void> {
    if (ticketItemIds.length === 0) {
      return;
    }

    await db
      .update(ticketBenefitEntitlements)
      .set({
        state: 'inactive',
        inactiveReason: 'ticket_item_cancelled',
        updatedAt: now,
      })
      .where(and(
        inArray(ticketBenefitEntitlements.ticketItemId, ticketItemIds),
        ne(ticketBenefitEntitlements.state, 'redeemed'),
      ));
  }
}
