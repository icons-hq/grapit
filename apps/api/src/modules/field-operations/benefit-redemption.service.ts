import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  ticketBenefitDisplayCopySchema,
  type BenefitEntitlement,
  type BenefitRedemptionOutcome,
  type BenefitRedemptionRequest,
  type BenefitRedemptionResponse,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  ticketBenefitEntitlements,
  ticketBenefitRedemptionRecords,
} from '../../database/schema/index.js';
import { BENEFIT_MUTATION_LOCK_TIMEOUT } from '../admin/admin-benefits.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';

/**
 * A first redemption takes the showtime row FOR NO KEY UPDATE, which conflicts
 * with the FOR SHARE that payment confirmation takes on the same showtime. Waiting
 * without bound behind a stream of confirmations would hold a pool connection and
 * queue later confirmations behind this writer, so the wait is bounded like the
 * admin benefit mutations (same lock timeout, shorter statement budget).
 */
const FIELD_REDEMPTION_STATEMENT_TIMEOUT = '10s';
const PG_LOCK_NOT_AVAILABLE = '55P03';
const PG_QUERY_CANCELED = '57014';

export interface BenefitRedemptionContext {
  scannerUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

type RedemptionDb = Pick<DrizzleDB, 'select' | 'insert' | 'update'>;
type BenefitEntitlementRow = typeof ticketBenefitEntitlements.$inferSelect;
type PriorRedemptionRow = {
  id: string;
  createdAt: Date | string;
  scannerUserId: string;
  deviceAttemptId: string;
};
type ExistingRedemptionRow = PriorRedemptionRow & {
  showtimeId: string;
  requestedShowtimeId: string | null;
  ticketItemId: string;
  benefitEntitlementId: string;
  result: BenefitRedemptionOutcome;
  rejectionReason: string | null;
  redactedTokenRef: string;
};

@Injectable()
export class BenefitRedemptionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly qrTicketService: QrTicketService,
  ) {}

  async redeem(
    input: BenefitRedemptionRequest,
    context: BenefitRedemptionContext,
  ): Promise<BenefitRedemptionResponse> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT set_config('lock_timeout', ${BENEFIT_MUTATION_LOCK_TIMEOUT}, true),
            set_config('statement_timeout', ${FIELD_REDEMPTION_STATEMENT_TIMEOUT}, true)
        `);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`benefit:${input.deviceAttemptId}`}, 0))`);
        // A retry of a recorded attempt answers its first result without waiting
        // for the showtime lock: the advisory lock serializes this attempt and its
        // record is never changed, so a payment holding the showtime cannot turn
        // the re-check of a settled redemption into a 409.
        const existingAttempt = await this.findExistingAttemptByDeviceId(tx, input.deviceAttemptId);
        if (existingAttempt) {
          const recordedEntitlement = await this.findEntitlement(input.benefitEntitlementId, tx);
          if (!recordedEntitlement) return notEligibleResponse();
          return responseForMatchingAttempt(existingAttempt, recordedEntitlement, input, context);
        }
        const entitlement = await this.findEntitlement(input.benefitEntitlementId, tx);
        if (entitlement) {
          // Configuration/live allocation uses the same showtime lock. Record the
          // first redemption attempt before a competing result mutation can proceed.
          await tx.execute(sql`SELECT id FROM showtimes WHERE id = ${entitlement.showtimeId} FOR NO KEY UPDATE`);
          await tx.execute(sql`SELECT r.id FROM reservations r
            INNER JOIN payments p ON p.reservation_id = r.id
            INNER JOIN ticket_items ti ON ti.reservation_id = r.id AND ti.payment_id = p.id
            WHERE ti.id = ${entitlement.ticketItemId} FOR UPDATE OF r, p, ti`);
        }
        return this.redeemLocked(input, context, tx);
      });
    } catch (error) {
      // The transaction rolled back, so nothing was recorded for this attempt and
      // the same request can be retried.
      throw translateRedemptionDbError(error);
    }
  }

  private async redeemLocked(
    input: BenefitRedemptionRequest,
    context: BenefitRedemptionContext,
    db: RedemptionDb,
  ): Promise<BenefitRedemptionResponse> {
    const redeemedAt = new Date();
    const entitlement = await this.findEntitlement(input.benefitEntitlementId, db);

    if (!entitlement) {
      return notEligibleResponse();
    }

    // redeem() already answered a recorded attempt before taking the showtime
    // lock, and its advisory lock keeps another request of this attempt out.

    let contractShowtimeId: string;
    let contractTicketItemId: string;
    let contractTicketStatus: string;
    try {
      const contract = await this.qrTicketService.verifyTicketForScannerContract(input.token, db);
      contractShowtimeId = contract.showtimeId;
      contractTicketItemId = contract.ticketItemId;
      contractTicketStatus = contract.ticketStatus;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      await this.recordRedemption(db, {
        input,
        context,
        entitlement,
        result: 'tampered',
        token: input.token,
        rejectionReason: rejectionReasonFor('tampered'),
      });
      return this.rejected('tampered', entitlement);
    }

    if (contractShowtimeId !== input.showtimeId || entitlement.showtimeId !== input.showtimeId) {
      await this.recordRedemption(db, {
        input,
        context,
        entitlement,
        result: 'wrong_showtime',
        token: input.token,
        rejectionReason: rejectionReasonFor('wrong_showtime'),
      });
      return this.rejected('wrong_showtime', entitlement);
    }

    if (entitlement.ticketItemId !== contractTicketItemId) {
      await this.recordRedemption(db, {
        input,
        context,
        entitlement,
        result: 'not_eligible',
        token: input.token,
        rejectionReason: rejectionReasonFor('not_eligible'),
      });
      return this.rejected('not_eligible', entitlement);
    }

    if (
      entitlement.state === 'inactive'
      || contractTicketStatus === 'REVOKED'
      || contractTicketStatus === 'EXPIRED'
    ) {
      await this.recordRedemption(db, {
        input,
        context,
        entitlement,
        result: 'inactive',
        token: input.token,
        rejectionReason: rejectionReasonFor('inactive'),
      });
      return this.rejected('inactive', entitlement);
    }

    const priorRedemption = await this.findPriorRedeemed(
      db,
      entitlement.showtimeId,
      entitlement.id,
    );
    if (entitlement.state === 'redeemed' || priorRedemption) {
      await this.recordRedemption(db, {
        input,
        context,
        entitlement,
        result: 'duplicate',
        token: input.token,
        rejectionReason: rejectionReasonFor('duplicate'),
      });
      return duplicateResponse(entitlement, priorRedemption);
    }

    const tx = db;
    {
      const [updated] = await tx
        .update(ticketBenefitEntitlements)
        .set({
          state: 'redeemed',
          redeemedAt,
          redeemedByUserId: context.scannerUserId,
          updatedAt: redeemedAt,
        })
        .where(and(
          eq(ticketBenefitEntitlements.id, entitlement.id),
          eq(ticketBenefitEntitlements.showtimeId, input.showtimeId),
          eq(ticketBenefitEntitlements.ticketItemId, contractTicketItemId),
          eq(ticketBenefitEntitlements.state, 'active'),
        ))
        .returning();

      if (!updated) {
        const concurrentPrior = await this.findPriorRedeemed(
          tx,
          entitlement.showtimeId,
          entitlement.id,
        );
        if (concurrentPrior) {
          const reloadedEntitlement = await this.findEntitlement(entitlement.id, tx);
          const duplicateEntitlement = reloadedEntitlement
            ?? markEntitlementRedeemed(entitlement, concurrentPrior);
          await this.recordRedemption(tx, {
            input,
            context,
            entitlement: duplicateEntitlement,
            result: 'duplicate',
            token: input.token,
            rejectionReason: rejectionReasonFor('duplicate'),
          });
          return duplicateResponse(duplicateEntitlement, concurrentPrior);
        }

        await this.recordRedemption(tx, {
          input,
          context,
          entitlement,
          result: 'inactive',
          token: input.token,
          rejectionReason: rejectionReasonFor('inactive'),
        });
        return this.rejected('inactive', entitlement);
      }

      const redemptionEventId = await this.recordRedemption(tx, {
        input,
        context,
        entitlement: updated,
        result: 'redeemed',
        token: input.token,
        rejectionReason: null,
      });

      return {
        outcome: 'redeemed',
        benefitEntitlement: toBenefitEntitlement(updated),
        redemptionEventId,
        redeemedAt: toIso(updated.redeemedAt ?? redeemedAt),
      };
    }
  }

  private async findEntitlement(
    benefitEntitlementId: string,
    db: RedemptionDb = this.db,
  ): Promise<BenefitEntitlementRow | null> {
    const rows = await db
      .select()
      .from(ticketBenefitEntitlements)
      .where(eq(ticketBenefitEntitlements.id, benefitEntitlementId))
      .limit(1);

    return rows[0] ?? null;
  }

  private async findPriorRedeemed(
    db: RedemptionDb,
    showtimeId: string,
    benefitEntitlementId: string,
  ): Promise<PriorRedemptionRow | null> {
    const rows = await db
      .select({
        id: ticketBenefitRedemptionRecords.id,
        createdAt: ticketBenefitRedemptionRecords.createdAt,
        scannerUserId: ticketBenefitRedemptionRecords.scannerUserId,
        deviceAttemptId: ticketBenefitRedemptionRecords.deviceAttemptId,
      })
      .from(ticketBenefitRedemptionRecords)
      .where(and(
        eq(ticketBenefitRedemptionRecords.showtimeId, showtimeId),
        eq(ticketBenefitRedemptionRecords.benefitEntitlementId, benefitEntitlementId),
        eq(ticketBenefitRedemptionRecords.result, 'redeemed'),
      ))
      .orderBy(desc(ticketBenefitRedemptionRecords.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  private async findExistingAttemptByDeviceId(
    db: RedemptionDb,
    deviceAttemptId: string,
  ): Promise<ExistingRedemptionRow | null> {
    const rows = await db
      .select({
        id: ticketBenefitRedemptionRecords.id,
        showtimeId: ticketBenefitRedemptionRecords.showtimeId,
        requestedShowtimeId: ticketBenefitRedemptionRecords.requestedShowtimeId,
        ticketItemId: ticketBenefitRedemptionRecords.ticketItemId,
        benefitEntitlementId: ticketBenefitRedemptionRecords.benefitEntitlementId,
        scannerUserId: ticketBenefitRedemptionRecords.scannerUserId,
        deviceAttemptId: ticketBenefitRedemptionRecords.deviceAttemptId,
        result: ticketBenefitRedemptionRecords.result,
        redactedTokenRef: ticketBenefitRedemptionRecords.redactedTokenRef,
        rejectionReason: ticketBenefitRedemptionRecords.rejectionReason,
        createdAt: ticketBenefitRedemptionRecords.createdAt,
      })
      .from(ticketBenefitRedemptionRecords)
      .where(eq(ticketBenefitRedemptionRecords.deviceAttemptId, deviceAttemptId))
      .limit(1);

    return rows[0] ?? null;
  }

  private async recordRedemption(
    db: RedemptionDb,
    input: {
      input: BenefitRedemptionRequest;
      context: BenefitRedemptionContext;
      entitlement: BenefitEntitlementRow;
      result: BenefitRedemptionOutcome;
      token: string;
      rejectionReason?: string | null;
    },
  ): Promise<string> {
    const fallbackId = randomUUID();
    const [row] = await db
      .insert(ticketBenefitRedemptionRecords)
      .values({
        showtimeId: input.entitlement.showtimeId,
        requestedShowtimeId: input.input.showtimeId,
        ticketItemId: input.entitlement.ticketItemId,
        benefitEntitlementId: input.entitlement.id,
        scannerUserId: input.context.scannerUserId,
        deviceAttemptId: input.input.deviceAttemptId,
        redactedTokenRef: redactedTokenRef(input.token),
        result: input.result,
        rejectionReason: input.rejectionReason ?? null,
        updatedAt: new Date(),
      })
      .returning({ id: ticketBenefitRedemptionRecords.id });

    return row?.id ?? fallbackId;
  }

  private rejected(
    outcome: Exclude<BenefitRedemptionOutcome, 'redeemed' | 'duplicate'>,
    entitlement: BenefitEntitlementRow,
  ): BenefitRedemptionResponse {
    return {
      outcome,
      benefitEntitlement: toBenefitEntitlement(entitlement),
      rejectionReason: rejectionReasonFor(outcome),
    };
  }
}

function duplicateResponse(
  entitlement: BenefitEntitlementRow,
  priorRedemption: PriorRedemptionRow | null,
): BenefitRedemptionResponse {
  return {
    outcome: 'duplicate',
    benefitEntitlement: toBenefitEntitlement(entitlement),
    redemptionEventId: null,
    redeemedAt: entitlement.redeemedAt ? toIso(entitlement.redeemedAt) : null,
    priorRedemption: {
      redeemedAt: priorRedemption
        ? toIso(priorRedemption.createdAt)
        : toIso(entitlement.redeemedAt ?? new Date()),
      scannerUserId: priorRedemption?.scannerUserId
        ? maskContextValue(priorRedemption.scannerUserId)
        : undefined,
      deviceAttemptId: priorRedemption?.deviceAttemptId
        ? maskContextValue(priorRedemption.deviceAttemptId)
        : undefined,
      redemptionEventId: priorRedemption?.id,
    },
  };
}

function notEligibleResponse(): BenefitRedemptionResponse {
  return {
    outcome: 'not_eligible',
    benefitEntitlement: null,
    rejectionReason: rejectionReasonFor('not_eligible'),
  };
}

/**
 * Replays a recorded attempt. The request must repeat the recorded one (same
 * benefit, Ticket Item, showtimes, scanner and QR); reusing its id for another
 * redemption is a 409 and never a second hand-over.
 */
function responseForMatchingAttempt(
  existingAttempt: ExistingRedemptionRow,
  entitlement: BenefitEntitlementRow,
  input: BenefitRedemptionRequest,
  context: BenefitRedemptionContext,
): BenefitRedemptionResponse {
  if (existingAttempt.benefitEntitlementId !== entitlement.id || existingAttempt.ticketItemId !== entitlement.ticketItemId
    || existingAttempt.showtimeId !== entitlement.showtimeId || existingAttempt.scannerUserId !== context.scannerUserId
    || existingAttempt.redactedTokenRef !== redactedTokenRef(input.token)
    || (existingAttempt.requestedShowtimeId ?? existingAttempt.showtimeId) !== input.showtimeId) {
    throw new ConflictException('다른 특전 지급에 사용된 요청입니다. 다시 확인해주세요.');
  }
  return responseForExistingAttempt(existingAttempt, entitlement);
}

function responseForExistingAttempt(
  existingAttempt: ExistingRedemptionRow,
  entitlement: BenefitEntitlementRow,
): BenefitRedemptionResponse {
  if (existingAttempt.result === 'redeemed') {
    return { outcome: 'redeemed', benefitEntitlement: toBenefitEntitlement(entitlement),
      redemptionEventId: existingAttempt.id, redeemedAt: toIso(existingAttempt.createdAt) };
  }
  if (existingAttempt.result === 'duplicate') {
    return duplicateResponse(
      entitlement.state === 'redeemed'
        ? entitlement
        : markEntitlementRedeemed(entitlement, existingAttempt),
      existingAttempt,
    );
  }

  return {
    outcome: existingAttempt.result,
    benefitEntitlement: toBenefitEntitlement(entitlement),
    rejectionReason: existingAttempt.rejectionReason
      ?? rejectionReasonFor(existingAttempt.result),
  };
}

function markEntitlementRedeemed(
  entitlement: BenefitEntitlementRow,
  priorRedemption: PriorRedemptionRow,
): BenefitEntitlementRow {
  const redeemedAt = toDate(priorRedemption.createdAt);
  return {
    ...entitlement,
    state: 'redeemed',
    redeemedAt,
    redeemedByUserId: priorRedemption.scannerUserId,
    updatedAt: redeemedAt,
  };
}

function toBenefitEntitlement(row: BenefitEntitlementRow): BenefitEntitlement {
  const displayCopy = ticketBenefitDisplayCopySchema.parse(row.displayCopySnapshot);
  const base = {
    id: row.id,
    ticketItemId: row.ticketItemId,
    showtimeId: row.showtimeId,
    runId: row.runId,
    benefitIdentity: row.benefitIdentity,
    kind: row.benefitKind,
    displayCopy,
    state: row.state,
    assignedAt: row.createdAt.toISOString(),
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
  };

  switch (row.source) {
    case 'configuration':
      return {
        ...base,
        source: 'configuration',
        runId: null,
        kind: 'included',
        attachedToTicket: true,
      };
    case 'live_run':
      if (!row.runId) {
        throw new InternalServerErrorException('live_run benefit entitlement is missing runId');
      }
      return {
        ...base,
        source: 'live_run',
        runId: row.runId,
        runMode: 'live',
        attachedToTicket: true,
      };
    case 'test_run':
      if (!row.runId) {
        throw new InternalServerErrorException('test_run benefit entitlement is missing runId');
      }
      return {
        ...base,
        source: 'test_run',
        runId: row.runId,
        runMode: 'test',
        attachedToTicket: false,
      };
    case 'rollback':
      return {
        ...base,
        source: 'rollback',
        attachedToTicket: true,
        ...(row.runId ? { runMode: 'live' as const } : {}),
      };
  }
}

/**
 * Maps the lock and statement timeouts of the redemption transaction to
 * staff-facing errors. Other errors pass through unchanged.
 */
function translateRedemptionDbError(error: unknown): unknown {
  const code = postgresErrorCode(error);
  if (code === PG_LOCK_NOT_AVAILABLE) {
    return new ConflictException(
      '같은 회차 결제 처리와 겹쳐 특전 지급을 확인하지 못했습니다. 실물을 지급하지 말고 같은 요청으로 다시 확인해주세요.',
    );
  }
  if (code === PG_QUERY_CANCELED) {
    return new ServiceUnavailableException(
      '특전 지급 확인이 제한 시간을 넘어 취소되었습니다. 실물을 지급하지 말고 잠시 후 같은 요청으로 다시 확인해주세요.',
    );
  }
  return error;
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function rejectionReasonFor(outcome: BenefitRedemptionOutcome): string {
  switch (outcome) {
    case 'duplicate':
      return '이미 사용 처리된 혜택입니다';
    case 'not_eligible':
      return '해당 티켓에 배정된 혜택이 아닙니다';
    case 'inactive':
      return '사용할 수 없는 혜택입니다';
    case 'tampered':
      return '검증할 수 없는 QR 티켓입니다';
    case 'wrong_showtime':
      return '요청한 회차와 일치하지 않는 티켓입니다';
    case 'redeemed':
      return '';
  }
}

function redactedTokenRef(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex').slice(0, 16);
  return `qr:${digest}`;
}

function maskContextValue(value: string): string {
  if (value.length <= 14) {
    return value;
  }

  const prefixMatch = value.match(/^([^-]+-[^-]+)(?:-|$)/);
  const prefix = prefixMatch?.[1] ?? value.slice(0, 12);
  return `${prefix}...${value.slice(-4)}`;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
