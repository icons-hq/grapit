import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
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
import { QrTicketService } from '../ticket/qr-ticket.service.js';

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
    const redeemedAt = new Date();
    const entitlement = await this.findEntitlement(input.benefitEntitlementId);

    if (!entitlement) {
      return {
        outcome: 'not_eligible',
        benefitEntitlement: null,
        rejectionReason: rejectionReasonFor('not_eligible'),
      };
    }

    let contractShowtimeId: string;
    let contractTicketItemId: string;
    let contractTicketStatus: string;
    try {
      const contract = await this.qrTicketService.verifyTicketForScannerContract(input.token);
      contractShowtimeId = contract.showtimeId;
      contractTicketItemId = contract.ticketItemId;
      contractTicketStatus = contract.ticketStatus;
    } catch {
      await this.recordRedemption(this.db, {
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
      await this.recordRedemption(this.db, {
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
      await this.recordRedemption(this.db, {
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
      await this.recordRedemption(this.db, {
        input,
        context,
        entitlement,
        result: 'inactive',
        token: input.token,
        rejectionReason: rejectionReasonFor('inactive'),
      });
      return this.rejected('inactive', entitlement);
    }

    const priorRedemption = await this.findPriorRedeemed(this.db, entitlement.id);
    if (entitlement.state === 'redeemed' || priorRedemption) {
      await this.recordRedemption(this.db, {
        input,
        context,
        entitlement,
        result: 'duplicate',
        token: input.token,
        rejectionReason: rejectionReasonFor('duplicate'),
      });
      return duplicateResponse(entitlement, priorRedemption);
    }

    return this.runInTransaction(async (tx) => {
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
        const concurrentPrior = await this.findPriorRedeemed(tx, entitlement.id);
        if (concurrentPrior) {
          await this.recordRedemption(tx, {
            input,
            context,
            entitlement,
            result: 'duplicate',
            token: input.token,
            rejectionReason: rejectionReasonFor('duplicate'),
          });
          return duplicateResponse(entitlement, concurrentPrior);
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
    });
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
        eq(ticketBenefitRedemptionRecords.benefitEntitlementId, benefitEntitlementId),
        eq(ticketBenefitRedemptionRecords.result, 'redeemed'),
      ))
      .orderBy(desc(ticketBenefitRedemptionRecords.createdAt))
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

  private async runInTransaction<T>(
    operation: (db: RedemptionDb) => Promise<T>,
  ): Promise<T> {
    const transactionResult = this.db.transaction?.((tx) =>
      operation(tx as RedemptionDb),
    );

    if (transactionResult && typeof transactionResult.then === 'function') {
      return transactionResult;
    }

    return operation(this.db);
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
