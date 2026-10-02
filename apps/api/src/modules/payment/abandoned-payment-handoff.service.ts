import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type IORedis from 'ioredis';
import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { PaymentMethod } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  reservationPaymentFailureDiagnostics,
  reservations,
} from '../../database/schema/index.js';
import { BookingService, PAYMENT_CONFIRM_LOCK_TTL } from '../booking/booking.service.js';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import {
  ABANDONED_PAYMENT_HANDOFF_GRACE_MS,
  ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS,
  isMerchantConfirmedCheckoutMethod,
} from './payment-handoff-policy.js';
import {
  TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS,
  TOSS_TRANSACTION_PAGE_SIZE,
  TossPaymentsClient,
  type TossSecretKeyScope,
} from './toss-payments.client.js';

/** Orders checked against the provider ledger per sweep. */
export const ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT = 20;
/** Candidates examined per sweep; orders whose review is deferred are skipped. */
export const ABANDONED_PAYMENT_HANDOFF_SCAN_LIMIT = 100;
/**
 * Wall-clock budget for provider lookups in one sweep. One lookup may use the full
 * documented 60 seconds, and the sweep still fits the bounded background worker run
 * (30s window inside a 120s job timeout).
 */
export const ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS = 65_000;
/** Lookup failed or hit the page cap: look again later without re-querying every sweep. */
export const ABANDONED_PAYMENT_HANDOFF_INCONCLUSIVE_BACKOFF_SECONDS = 30 * 60;
/** The provider has a transaction this server never recorded: alert daily until reconciled. */
export const ABANDONED_PAYMENT_HANDOFF_FOUND_BACKOFF_SECONDS = 24 * 60 * 60;

const MIN_PROVIDER_LOOKUP_TIMEOUT_MS = 5_000;
const REVIEW_KEY_PREFIX = '{payment-handoff-review}';
const REVIEW_CURSOR_KEY = `${REVIEW_KEY_PREFIX}:cursor`;
const REVIEW_CURSOR_TTL_SECONDS = 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Provider transaction lookup starts before the order existed to absorb clock skew. */
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

interface CandidateRow {
  id: string;
  tossOrderId: string | null;
  createdAt: Date | null;
  checkoutStartedAt: Date | null;
  paymentDeadlineAt: Date | null;
  checkoutPaymentMethod: PaymentMethod | null;
}

interface AbandonedHandoffCandidate {
  id: string;
  tossOrderId: string;
  createdAt: Date;
  checkoutStartedAt: Date;
  paymentDeadlineAt: Date;
  checkoutPaymentMethod: PaymentMethod;
}

interface ReviewCursor {
  paymentDeadlineAt: Date;
  id: string;
}

interface HeldCandidate {
  candidate: AbandonedHandoffCandidate;
  leaseToken: string;
}

/**
 * `unchecked`: the sweep budget ran out before the ledger was read (no conclusion).
 * `inconclusive`: the ledger could not prove absence (lookup error or page cap).
 */
type ProviderTransactionEvidence = 'none' | 'unchecked' | 'inconclusive' | 'found';

const EVIDENCE_RANK: Record<ProviderTransactionEvidence, number> = {
  none: 0,
  unchecked: 1,
  inconclusive: 2,
  found: 3,
};

interface LedgerWindow {
  startMs: number;
  endMs: number;
  orderIds: Set<string>;
}

interface LedgerScan {
  found: Set<string>;
  status: 'complete' | 'unchecked' | 'inconclusive';
}

const EMPTY_RESULT: AbandonedPaymentHandoffSweepResult = {
  reviewedReservations: 0,
  failedReservations: 0,
};

export function formatTossKstDateTime(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19);
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toReviewableCandidate(row: CandidateRow): AbandonedHandoffCandidate | null {
  if (
    !row.tossOrderId
    || !isValidDate(row.createdAt)
    || !isValidDate(row.checkoutStartedAt)
    || !isValidDate(row.paymentDeadlineAt)
    || !row.checkoutPaymentMethod
    || !isMerchantConfirmedCheckoutMethod(row.checkoutPaymentMethod)
  ) {
    return null;
  }
  return {
    id: row.id,
    tossOrderId: row.tossOrderId,
    createdAt: row.createdAt,
    checkoutStartedAt: row.checkoutStartedAt,
    paymentDeadlineAt: row.paymentDeadlineAt,
    checkoutPaymentMethod: row.checkoutPaymentMethod,
  };
}

/**
 * Each order's ledger window starts before the order existed (a released and re-branched
 * order may carry an earlier attempt) and ends well after its payment deadline.
 * Overlapping windows are read once.
 */
export function mergeProviderLookupWindows(
  candidates: Array<Pick<
    AbandonedHandoffCandidate,
    'tossOrderId' | 'createdAt' | 'checkoutStartedAt' | 'paymentDeadlineAt'
  >>,
  now: Date,
): LedgerWindow[] {
  const windows = candidates
    .map((candidate) => ({
      startMs: Math.min(candidate.createdAt.getTime(), candidate.checkoutStartedAt.getTime())
        - PROVIDER_LOOKUP_LEAD_MS,
      endMs: Math.min(
        now.getTime(),
        Math.max(candidate.paymentDeadlineAt.getTime(), candidate.checkoutStartedAt.getTime())
          + PROVIDER_LOOKUP_TAIL_MS,
      ),
      orderId: candidate.tossOrderId,
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const merged: LedgerWindow[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, window.endMs);
      last.orderIds.add(window.orderId);
    } else {
      merged.push({
        startMs: window.startMs,
        endMs: window.endMs,
        orderIds: new Set([window.orderId]),
      });
    }
  }
  return merged;
}

/**
 * Safety net for a Provider Handoff that never reached the provider: the browser
 * closed or lost the release call between handoff and the SDK request. No provider
 * payment exists, so no webhook will ever resolve it.
 *
 * A reservation becomes FAILED only when every condition holds: merchant-confirmed
 * method, no Payment row, payment deadline older than the provider expiry grace, the
 * confirm lease held from before the provider lookup until the update, and Toss
 * transaction lookup on every configured MID proves the order has no transaction.
 * Any other outcome leaves it in status review.
 *
 * Orders it cannot conclude never block newer ones: their next review is deferred in
 * Valkey, and the scan resumes from a cursor that wraps around the candidate list.
 */
@Injectable()
export class AbandonedPaymentHandoffService {
  private readonly logger = new Logger(AbandonedPaymentHandoffService.name);
  private reviewInFlight = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly tossClient?: TossPaymentsClient,
    @Optional() private readonly bookingService?: BookingService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: IORedis,
  ) {}

  async sweepAbandonedPaymentHandoffs(
    now: Date = new Date(),
  ): Promise<AbandonedPaymentHandoffSweepResult> {
    // A slow provider must not stack reviews when the sweep interval fires again.
    if (!this.tossClient || !this.bookingService || this.reviewInFlight) {
      return EMPTY_RESULT;
    }

    this.reviewInFlight = true;
    try {
      return await this.reviewAbandonedPaymentHandoffs(now);
    } finally {
      this.reviewInFlight = false;
    }
  }

  private async reviewAbandonedPaymentHandoffs(
    now: Date,
  ): Promise<AbandonedPaymentHandoffSweepResult> {
    const budgetEndsAtMs = Date.now() + ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS;
    const candidates = await this.selectReviewCandidates(now);
    if (candidates.length === 0) {
      return EMPTY_RESULT;
    }

    const held = await this.acquireReviewLeases(candidates);
    if (held.length === 0) {
      return EMPTY_RESULT;
    }

    const refreshTimer = this.startReviewLeaseRefresh(held);
    try {
      const evidence = await this.collectProviderEvidence(
        held.map(({ candidate }) => candidate),
        now,
        budgetEndsAtMs,
      );

      let reviewedReservations = 0;
      let failedReservations = 0;
      for (const { candidate, leaseToken } of held) {
        const result = evidence.get(candidate.tossOrderId) ?? 'unchecked';
        if (result === 'unchecked') {
          continue;
        }
        reviewedReservations += 1;
        try {
          if (result === 'found') {
            this.logger.error(
              `CRITICAL: provider transaction exists for an unrecorded payment handoff. reservationId=${candidate.id}. Reconcile before releasing seats or refunding.`,
            );
            await this.deferReview(candidate.id, 'found', ABANDONED_PAYMENT_HANDOFF_FOUND_BACKOFF_SECONDS);
            continue;
          }
          if (result === 'inconclusive') {
            await this.deferReview(
              candidate.id,
              'inconclusive',
              ABANDONED_PAYMENT_HANDOFF_INCONCLUSIVE_BACKOFF_SECONDS,
            );
            continue;
          }
          // The lease must have been ours from before the lookup until this update, so
          // no confirm can have approved the order in between.
          const stillHeld = await this.bookingService!
            .refreshPaymentConfirmLock(candidate.tossOrderId, leaseToken)
            .catch(() => false);
          if (!stillHeld) {
            continue;
          }
          if (await this.failAbandonedReservation(candidate, now)) {
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
    } finally {
      clearInterval(refreshTimer);
      await Promise.all(held.map(({ candidate, leaseToken }) =>
        this.bookingService!
          .releasePaymentConfirmLock(candidate.tossOrderId, leaseToken)
          .catch(() => undefined)
      ));
    }
  }

  private async selectReviewCandidates(now: Date): Promise<AbandonedHandoffCandidate[]> {
    const graceCutoff = new Date(now.getTime() - ABANDONED_PAYMENT_HANDOFF_GRACE_MS);
    const cursor = await this.readReviewCursor();
    const asyncWalletProviders = sql.join(
      ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS.map((provider) => sql`${provider}`),
      sql`, `,
    );
    const page: CandidateRow[] = await this.db
      .select({
        id: reservations.id,
        tossOrderId: reservations.tossOrderId,
        createdAt: reservations.createdAt,
        checkoutStartedAt: reservations.checkoutStartedAt,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
        checkoutPaymentMethod: reservations.checkoutPaymentMethod,
      })
      .from(reservations)
      .where(and(
        eq(reservations.status, 'PENDING_PAYMENT'),
        isNotNull(reservations.checkoutStartedAt),
        isNotNull(reservations.tossOrderId),
        isNotNull(reservations.checkoutPaymentMethod),
        lt(reservations.paymentDeadlineAt, graceCutoff),
        // Asynchronous wallets resolve through the provider webhook, never here.
        sql`not (
          coalesce(${reservations.checkoutPaymentMethod}->>'method', '') = 'FOREIGN_EASY_PAY'
          and coalesce(${reservations.checkoutPaymentMethod}->>'provider', '') in (${asyncWalletProviders})
        )`,
        sql`not exists (
          select 1 from ${payments}
          where ${payments.reservationId} = ${reservations.id}
        )`,
        cursor
          ? sql`(${reservations.paymentDeadlineAt}, ${reservations.id}) > (${cursor.paymentDeadlineAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ))
      .orderBy(asc(reservations.paymentDeadlineAt), asc(reservations.id))
      .limit(ABANDONED_PAYMENT_HANDOFF_SCAN_LIMIT);

    const deferred = await this.readDeferredReviews(page.map((row) => row.id));
    const selected: AbandonedHandoffCandidate[] = [];
    let lastExamined: CandidateRow | undefined;
    for (const row of page) {
      lastExamined = row;
      const candidate = deferred.has(row.id) ? null : toReviewableCandidate(row);
      if (!candidate) {
        continue;
      }
      selected.push(candidate);
      if (selected.length >= ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT) {
        break;
      }
    }

    const reachedEnd = page.length < ABANDONED_PAYMENT_HANDOFF_SCAN_LIMIT
      && lastExamined === page[page.length - 1];
    await this.writeReviewCursor(reachedEnd ? null : lastExamined ?? null);
    return selected;
  }

  private async acquireReviewLeases(
    candidates: AbandonedHandoffCandidate[],
  ): Promise<HeldCandidate[]> {
    const held: HeldCandidate[] = [];
    for (const candidate of candidates) {
      const leaseToken = randomUUID();
      try {
        // A held lease means a confirm (or another review) is running; retry next cycle.
        if (await this.bookingService!.acquirePaymentConfirmLock(candidate.tossOrderId, leaseToken)) {
          held.push({ candidate, leaseToken });
        }
      } catch (error) {
        this.logger.warn(
          `Abandoned payment handoff lease failed. reservationId=${candidate.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return held;
  }

  private startReviewLeaseRefresh(held: HeldCandidate[]): ReturnType<typeof setInterval> {
    const timer = setInterval(() => {
      for (const { candidate, leaseToken } of held) {
        void this.bookingService!
          .refreshPaymentConfirmLock(candidate.tossOrderId, leaseToken)
          .catch(() => undefined);
      }
    }, Math.max(1_000, Math.floor((PAYMENT_CONFIRM_LOCK_TTL * 1000) / 3)));
    timer.unref?.();
    return timer;
  }

  private async collectProviderEvidence(
    candidates: AbandonedHandoffCandidate[],
    now: Date,
    budgetEndsAtMs: number,
  ): Promise<Map<string, ProviderTransactionEvidence>> {
    const evidence = new Map<string, ProviderTransactionEvidence>(
      candidates.map((candidate) => [candidate.tossOrderId, 'none']),
    );
    const raise = (orderId: string, next: ProviderTransactionEvidence) => {
      const current = evidence.get(orderId) ?? 'none';
      if (EVIDENCE_RANK[next] > EVIDENCE_RANK[current]) {
        evidence.set(orderId, next);
      }
    };

    // Absence is proven only when every MID this server can approve with says so.
    const scopes = this.tossClient!.getTransactionLookupScopes();
    if (scopes.length === 0) {
      this.logger.warn('No Toss secret key is configured for payment handoff review.');
      for (const candidate of candidates) {
        raise(candidate.tossOrderId, 'inconclusive');
      }
      return evidence;
    }

    for (const window of mergeProviderLookupWindows(candidates, now)) {
      for (const scope of scopes) {
        const scan = await this.scanProviderLedger(window, scope, budgetEndsAtMs);
        for (const orderId of scan.found) {
          raise(orderId, 'found');
        }
        if (scan.status !== 'complete') {
          for (const orderId of window.orderIds) {
            raise(orderId, scan.status);
          }
        }
      }
    }
    return evidence;
  }

  private async scanProviderLedger(
    window: LedgerWindow,
    secretKeyScope: TossSecretKeyScope,
    budgetEndsAtMs: number,
  ): Promise<LedgerScan> {
    const found = new Set<string>();
    const startDate = formatTossKstDateTime(new Date(window.startMs));
    const endDate = formatTossKstDateTime(new Date(window.endMs));

    let startingAfter: string | undefined;
    for (let page = 0; page < PROVIDER_LOOKUP_MAX_PAGES; page += 1) {
      const remainingMs = budgetEndsAtMs - Date.now();
      if (remainingMs < MIN_PROVIDER_LOOKUP_TIMEOUT_MS) {
        return { found, status: 'unchecked' };
      }

      let rows;
      try {
        rows = await this.tossClient!.queryTransactions({
          startDate,
          endDate,
          limit: TOSS_TRANSACTION_PAGE_SIZE,
          secretKeyScope,
          timeoutMs: Math.min(TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS, remainingMs),
          ...(startingAfter ? { startingAfter } : {}),
        });
      } catch (error) {
        this.logger.warn(
          `Provider transaction lookup failed for payment handoff review. scope=${secretKeyScope}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Cut short by this sweep's own budget, not by the provider: no conclusion yet.
        return { found, status: Date.now() >= budgetEndsAtMs ? 'unchecked' : 'inconclusive' };
      }

      for (const row of rows) {
        if (row.orderId && window.orderIds.has(row.orderId)) {
          found.add(row.orderId);
        }
      }
      if (rows.length < TOSS_TRANSACTION_PAGE_SIZE) {
        return { found, status: 'complete' };
      }
      const lastKey = rows[rows.length - 1]?.transactionKey;
      if (!lastKey || lastKey === startingAfter) {
        return { found, status: 'inconclusive' };
      }
      startingAfter = lastKey;
    }

    return { found, status: 'inconclusive' };
  }

  private async failAbandonedReservation(
    candidate: AbandonedHandoffCandidate,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(reservations)
        .set({ status: 'FAILED', updatedAt: now })
        .where(and(
          eq(reservations.id, candidate.id),
          eq(reservations.status, 'PENDING_PAYMENT'),
          eq(reservations.checkoutStartedAt, candidate.checkoutStartedAt),
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
          tossOrderId: candidate.tossOrderId,
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
            tossOrderId: candidate.tossOrderId,
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
  }

  private deferredReviewKey(reservationId: string): string {
    return `${REVIEW_KEY_PREFIX}:deferred:${reservationId}`;
  }

  /** Review state is an optimization: without Valkey every order is simply reviewed. */
  private async readDeferredReviews(reservationIds: string[]): Promise<Set<string>> {
    if (!this.redis || reservationIds.length === 0) {
      return new Set();
    }
    try {
      const values = await Promise.all(
        reservationIds.map((id) => this.redis!.get(this.deferredReviewKey(id))),
      );
      return new Set(reservationIds.filter((_, index) => values[index] !== null));
    } catch (error) {
      this.logger.warn(
        `Payment handoff review backoff read failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Set();
    }
  }

  private async deferReview(
    reservationId: string,
    outcome: 'found' | 'inconclusive',
    seconds: number,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }
    await this.redis
      .set(this.deferredReviewKey(reservationId), outcome, 'EX', seconds)
      .catch(() => undefined);
  }

  private async readReviewCursor(): Promise<ReviewCursor | null> {
    if (!this.redis) {
      return null;
    }
    try {
      const raw = await this.redis.get(REVIEW_CURSOR_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as { deadline?: unknown; id?: unknown };
      const paymentDeadlineAt = typeof parsed.deadline === 'string'
        ? new Date(parsed.deadline)
        : null;
      if (
        !isValidDate(paymentDeadlineAt)
        || typeof parsed.id !== 'string'
        || !UUID_PATTERN.test(parsed.id)
      ) {
        return null;
      }
      return { paymentDeadlineAt, id: parsed.id };
    } catch {
      return null;
    }
  }

  private async writeReviewCursor(row: CandidateRow | null): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      if (!row || !isValidDate(row.paymentDeadlineAt)) {
        await this.redis.del(REVIEW_CURSOR_KEY);
        return;
      }
      await this.redis.set(
        REVIEW_CURSOR_KEY,
        JSON.stringify({ deadline: row.paymentDeadlineAt.toISOString(), id: row.id }),
        'EX',
        REVIEW_CURSOR_TTL_SECONDS,
      );
    } catch {
      // The next sweep starts from the oldest candidate instead.
    }
  }
}
