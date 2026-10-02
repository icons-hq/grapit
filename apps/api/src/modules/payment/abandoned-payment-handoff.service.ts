import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { PaymentMethod } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  reservationPaymentFailureDiagnostics,
  reservations,
} from '../../database/schema/index.js';
import { BookingService } from '../booking/booking.service.js';
import {
  ABANDONED_PAYMENT_HANDOFF_GRACE_MS,
  isMerchantConfirmedCheckoutMethod,
  resolveCheckoutSecretKeyScope,
} from './payment-handoff-policy.js';
import {
  TOSS_TRANSACTION_PAGE_SIZE,
  TossPaymentsClient,
} from './toss-payments.client.js';

export const ABANDONED_PAYMENT_HANDOFF_SWEEP_LIMIT = 20;
/** Keeps a slow provider from stretching the bounded worker window or overlapping sweeps. */
export const ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS = 20_000;
/** Provider transaction lookup starts before the handoff to absorb clock skew. */
const PROVIDER_LOOKUP_LEAD_MS = 10 * 60 * 1000;
/**
 * A merchant-confirmed method is approved only by this server's confirm, which refuses
 * once the reservation's admission window (the payment deadline) has passed. Two hours
 * after the deadline covers any confirm call that was already in flight.
 */
const PROVIDER_LOOKUP_TAIL_MS = 2 * 60 * 60 * 1000;
const PROVIDER_LOOKUP_MAX_PAGES = 4;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const ABANDONED_PAYMENT_HANDOFF_DIAGNOSTIC = {
  diagnosticKind: 'payment_handoff_abandoned',
  diagnosticCode: 'PAYMENT_HANDOFF_ABANDONED',
  diagnosticMessage: '결제창이 열리지 않은 채 결제 요청이 종료되어 예매가 실패 처리되었습니다.',
  diagnosticSource: 'abandoned_payment_handoff_sweep',
  providerCheckStatus: 'no_provider_transaction',
  providerCheckMessage: 'Toss 거래 조회에서 이 주문의 승인·취소 거래가 없음을 확인했습니다.',
} as const;

export interface AbandonedPaymentHandoffSweepResult {
  reviewedReservations: number;
  failedReservations: number;
}

interface AbandonedHandoffCandidate {
  id: string;
  tossOrderId: string | null;
  checkoutStartedAt: Date | null;
  paymentDeadlineAt: Date | null;
  checkoutPaymentMethod: PaymentMethod | null;
}

type ProviderTransactionEvidence = 'found' | 'none' | 'inconclusive';

export function formatTossKstDateTime(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19);
}

/**
 * Safety net for a Provider Handoff that never reached the provider: the browser
 * closed or lost the release call between handoff and the SDK request. No provider
 * payment exists, so no webhook will ever resolve it.
 *
 * A reservation becomes FAILED only when every condition holds: merchant-confirmed
 * method, no Payment row, payment deadline older than the provider expiry grace, the
 * confirm lease is free, and Toss transaction lookup for the checkout's MID proves the
 * order has no approval or cancellation. Any other outcome leaves it in status review.
 */
@Injectable()
export class AbandonedPaymentHandoffService {
  private readonly logger = new Logger(AbandonedPaymentHandoffService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly tossClient?: TossPaymentsClient,
    @Optional() private readonly bookingService?: BookingService,
  ) {}

  async sweepAbandonedPaymentHandoffs(
    now: Date = new Date(),
  ): Promise<AbandonedPaymentHandoffSweepResult> {
    if (!this.tossClient || !this.bookingService) {
      return { reviewedReservations: 0, failedReservations: 0 };
    }

    const graceCutoff = new Date(now.getTime() - ABANDONED_PAYMENT_HANDOFF_GRACE_MS);
    const candidates: AbandonedHandoffCandidate[] = await this.db
      .select({
        id: reservations.id,
        tossOrderId: reservations.tossOrderId,
        checkoutStartedAt: reservations.checkoutStartedAt,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
        checkoutPaymentMethod: reservations.checkoutPaymentMethod,
      })
      .from(reservations)
      .where(and(
        eq(reservations.status, 'PENDING_PAYMENT'),
        isNotNull(reservations.checkoutStartedAt),
        lt(reservations.paymentDeadlineAt, graceCutoff),
        sql`not exists (
          select 1 from ${payments}
          where ${payments.reservationId} = ${reservations.id}
        )`,
      ))
      .orderBy(asc(reservations.paymentDeadlineAt))
      .limit(ABANDONED_PAYMENT_HANDOFF_SWEEP_LIMIT);

    let failedReservations = 0;
    let reviewedReservations = 0;
    const startedAtMs = Date.now();
    for (const candidate of candidates) {
      if (Date.now() - startedAtMs > ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS) {
        break;
      }
      reviewedReservations += 1;
      try {
        if (await this.failIfProvablyAbandoned(candidate, now)) {
          failedReservations += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Abandoned payment handoff review failed. reservationId=${candidate.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (failedReservations > 0) {
      this.logger.log(
        `Failed abandoned payment handoffs. reviewed=${reviewedReservations}, failed=${failedReservations}`,
      );
    }

    return { reviewedReservations, failedReservations };
  }

  private async failIfProvablyAbandoned(
    candidate: AbandonedHandoffCandidate,
    now: Date,
  ): Promise<boolean> {
    const { tossOrderId, checkoutStartedAt, paymentDeadlineAt, checkoutPaymentMethod } = candidate;
    if (
      !tossOrderId
      || !checkoutStartedAt
      || !paymentDeadlineAt
      || !checkoutPaymentMethod
      || !isMerchantConfirmedCheckoutMethod(checkoutPaymentMethod)
    ) {
      return false;
    }

    const leaseToken = randomUUID();
    const leaseAcquired = await this.bookingService!.acquirePaymentConfirmLock(
      tossOrderId,
      leaseToken,
    );
    if (!leaseAcquired) {
      return false;
    }

    try {
      const evidence = await this.findProviderTransactionEvidence({
        orderId: tossOrderId,
        checkoutStartedAt,
        paymentDeadlineAt,
        paymentMethod: checkoutPaymentMethod,
        now,
      });
      if (evidence === 'found') {
        this.logger.error(
          `CRITICAL: provider transaction exists for an unrecorded payment handoff. reservationId=${candidate.id}. Reconcile before releasing seats or refunding.`,
        );
        return false;
      }
      if (evidence !== 'none') {
        return false;
      }

      return await this.db.transaction(async (tx) => {
        const [failed] = await tx
          .update(reservations)
          .set({ status: 'FAILED', updatedAt: now })
          .where(and(
            eq(reservations.id, candidate.id),
            eq(reservations.status, 'PENDING_PAYMENT'),
            eq(reservations.checkoutStartedAt, checkoutStartedAt),
            sql`not exists (
              select 1 from ${payments}
              where ${payments.reservationId} = ${reservations.id}
            )`,
          ))
          .returning({ id: reservations.id });
        if (!failed) {
          return false;
        }

        const diagnostic = ABANDONED_PAYMENT_HANDOFF_DIAGNOSTIC;
        await tx
          .insert(reservationPaymentFailureDiagnostics)
          .values({
            reservationId: candidate.id,
            tossOrderId,
            diagnosticKind: diagnostic.diagnosticKind,
            diagnosticCode: diagnostic.diagnosticCode,
            diagnosticMessage: diagnostic.diagnosticMessage,
            diagnosticSource: diagnostic.diagnosticSource,
            providerCheckStatus: diagnostic.providerCheckStatus,
            providerCheckedAt: now,
            providerCheckMessage: diagnostic.providerCheckMessage,
            recordedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: reservationPaymentFailureDiagnostics.reservationId,
            set: {
              paymentId: null,
              tossOrderId,
              diagnosticKind: diagnostic.diagnosticKind,
              diagnosticCode: diagnostic.diagnosticCode,
              diagnosticMessage: diagnostic.diagnosticMessage,
              diagnosticSource: diagnostic.diagnosticSource,
              providerCheckStatus: diagnostic.providerCheckStatus,
              providerCheckedAt: now,
              providerCheckMessage: diagnostic.providerCheckMessage,
              recordedAt: now,
              updatedAt: sql`now()`,
            },
          });
        return true;
      });
    } finally {
      await this.bookingService!
        .releasePaymentConfirmLock(tossOrderId, leaseToken)
        .catch(() => undefined);
    }
  }

  private async findProviderTransactionEvidence(input: {
    orderId: string;
    checkoutStartedAt: Date;
    paymentDeadlineAt: Date;
    paymentMethod: PaymentMethod;
    now: Date;
  }): Promise<ProviderTransactionEvidence> {
    const windowEndMs = Math.min(
      input.now.getTime(),
      Math.max(input.paymentDeadlineAt.getTime(), input.checkoutStartedAt.getTime())
        + PROVIDER_LOOKUP_TAIL_MS,
    );
    const startDate = formatTossKstDateTime(
      new Date(input.checkoutStartedAt.getTime() - PROVIDER_LOOKUP_LEAD_MS),
    );
    const endDate = formatTossKstDateTime(new Date(windowEndMs));
    const secretKeyScope = resolveCheckoutSecretKeyScope(input.paymentMethod);

    let startingAfter: string | undefined;
    for (let page = 0; page < PROVIDER_LOOKUP_MAX_PAGES; page += 1) {
      let rows;
      try {
        rows = await this.tossClient!.queryTransactions({
          startDate,
          endDate,
          limit: TOSS_TRANSACTION_PAGE_SIZE,
          secretKeyScope,
          ...(startingAfter ? { startingAfter } : {}),
        });
      } catch (error) {
        this.logger.warn(
          `Provider transaction lookup failed for payment handoff review: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return 'inconclusive';
      }

      if (rows.some((row) => row.orderId === input.orderId)) {
        return 'found';
      }
      if (rows.length < TOSS_TRANSACTION_PAGE_SIZE) {
        return 'none';
      }
      const lastKey = rows[rows.length - 1]?.transactionKey;
      if (!lastKey || lastKey === startingAfter) {
        return 'inconclusive';
      }
      startingAfter = lastKey;
    }

    return 'inconclusive';
  }
}
