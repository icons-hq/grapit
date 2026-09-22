import { ConflictException, Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  parseFieldCheckInToken,
  ticketBenefitDisplayCopySchema,
  type FieldBenefitEntitlement,
  type FieldCheckInConsumeRequest,
  type FieldCheckInConsumeResponse,
  type FieldCheckInOutcome,
  type FieldCheckInVerifyRequest,
  type FieldCheckInVerifyResponse,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  ticketBenefitEntitlements,
  performances,
  showtimes,
  venues,
  ticketItems,
  ticketScanEvents,
  tickets,
} from '../../database/schema/index.js';
import {
  AdminAuditService,
  type AdminAuditStatus,
} from '../admin/admin-audit.service.js';
import {
  QrTicketService,
  type QrTicketScannerContract,
} from '../ticket/qr-ticket.service.js';

const UNKNOWN_SCANNER_USER_ID = '00000000-0000-4000-8000-000000000000';

export interface FieldScannerContext {
  scannerUserId: string;
  deviceAttemptId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  scanSource?: 'online' | 'offline_sync';
  offlineSyncState?: 'not_required' | 'synced' | 'rejected';
}

type PriorScanContext = NonNullable<FieldCheckInConsumeResponse['priorScan']>;
type FieldCheckInTicketContext = NonNullable<FieldCheckInVerifyResponse['ticket']>;
type FieldBenefitEntitlementRow = typeof ticketBenefitEntitlements.$inferSelect;
type ScanEventDb = Pick<DrizzleDB, 'insert' | 'select' | 'update'>;
type AuditDb = Pick<DrizzleDB, 'insert' | 'select'>;

@Injectable()
export class FieldCheckInService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly qrTicketService: QrTicketService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async listShowtimes() {
    return this.db.select({ id: showtimes.id, eventId: performances.id, title: performances.title,
      dateTime: showtimes.dateTime, venueName: venues.name })
      .from(showtimes).innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .orderBy(desc(showtimes.dateTime)).limit(200);
  }

  async verify(
    input: FieldCheckInVerifyRequest,
    context?: Partial<FieldScannerContext>,
  ): Promise<FieldCheckInVerifyResponse> {
    const token = extractToken(input);
    const verifiedAt = new Date().toISOString();

    let contract: QrTicketScannerContract;
    try {
      contract = await this.qrTicketService.verifyTicketForScannerContract(token);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      const response: FieldCheckInVerifyResponse = {
        outcome: 'tampered',
        processable: false,
        ticket: null,
        rejectionReason: rejectionReasonFor('tampered'),
        verifiedAt,
      };

      await this.writeAudit({
        action: 'field.scan.verify',
        status: 'denied',
        resourceId: redactedTokenRef(token),
        context,
        after: {
          outcome: 'tampered',
          caseName: caseNameForOutcome('tampered'),
          redactedTokenRef: redactedTokenRef(token),
        },
      });

      return response;
    }

    const outcome = classifyScannerContract(contract, input.showtimeId);
    const processable = outcome === 'processable';
    const benefits = await this.loadBenefitEntitlementsSafely(contract);
    const response: FieldCheckInVerifyResponse = {
      outcome,
      processable,
      ticket: toTicketContext(contract, token, benefits.entitlements, benefits.available),
      rejectionReason: processable ? null : rejectionReasonFor(outcome),
      verifiedAt,
      ...(outcome === 'already_used' ? { priorScan: await this.findPriorSuccessfulScan(this.db, contract) } : {}),
    };

    if (!processable) {
      await this.writeAudit({
        action: 'field.scan.verify',
        status: 'denied',
        resourceId: ticketResourceId(contract),
        context,
        after: {
          outcome,
          caseName: caseNameForOutcome(outcome),
          redactedTokenRef: redactedTokenRef(token),
          maskedJti: contract.maskedJti,
        },
      });
    }

    return response;
  }

  async consume(
    input: FieldCheckInConsumeRequest,
    context: FieldScannerContext,
  ): Promise<FieldCheckInConsumeResponse> {
    let verified: QrTicketScannerContract;
    try {
      verified = await this.qrTicketService.verifyTicketForScannerContract(input.token);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      await this.writeAudit({ action: 'field.scan.consume', status: 'denied', resourceId: redactedTokenRef(input.token), context,
        after: { outcome: 'tampered', redactedTokenRef: redactedTokenRef(input.token) } });
      return { outcome: 'tampered', ticket: null, scanEventId: null, rejectionReason: rejectionReasonFor('tampered') };
    }

    return this.db.transaction(async (tx) => {
      // An attempt has one receipt even if a response is lost or devices retry concurrently.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.deviceAttemptId}, 0))`);
      const [receipt] = await tx.select().from(ticketScanEvents)
        .where(eq(ticketScanEvents.deviceAttemptId, input.deviceAttemptId)).limit(1);
      if (receipt) {
        if (receipt.ticketItemId !== verified.ticketItemId || (receipt.metadata?.['requestedShowtimeId'] ?? receipt.showtimeId) !== input.showtimeId
          || receipt.scannerUserId !== context.scannerUserId || receipt.metadata?.['redactedTokenRef'] !== redactedTokenRef(input.token)) {
          throw new ConflictException('다른 검표에 사용된 요청입니다. 티켓을 다시 확인해주세요.');
        }
        return {
          outcome: receipt.result === 'success' ? 'entered' : receipt.result as FieldCheckInOutcome,
          ticket: toTicketContext(verified, input.token), scanEventId: receipt.id,
          consumedAt: receipt.result === 'success' ? receipt.scannedAt.toISOString() : null,
          rejectionReason: receipt.rejectionReason,
        };
      }

      // Match cancellation's lock order. A concurrent cancellation or entry must
      // finish before we re-read the authoritative ticket and credential state.
      await tx.execute(sql`SELECT r.id FROM reservations r
        INNER JOIN payments p ON p.id = ${verified.paymentId} AND p.reservation_id = r.id
        INNER JOIN ticket_items ti ON ti.id = ${verified.ticketItemId} AND ti.reservation_id = r.id AND ti.payment_id = p.id
        WHERE r.id = ${verified.reservationId} FOR UPDATE OF r, p, ti`);
      await tx.execute(sql`SELECT id FROM tickets WHERE id = ${verified.ticketId} FOR UPDATE`);
      const contract = await this.qrTicketService.verifyTicketForScannerContract(input.token, tx);
      const outcome = classifyScannerContract(contract, input.showtimeId);
      const priorScan = outcome === 'already_used' ? await this.findPriorSuccessfulScan(tx, contract) : null;
      const consumedAt = new Date();
      if (outcome === 'processable') {
        await tx.update(ticketItems).set({ admissionState: 'entered', enteredAt: consumedAt, updatedAt: consumedAt })
          .where(and(eq(ticketItems.id, contract.ticketItemId), eq(ticketItems.status, 'active'), eq(ticketItems.admissionState, 'not_entered')));
        await tx.update(tickets).set({ usedAt: consumedAt, updatedAt: consumedAt })
          .where(and(eq(tickets.id, contract.ticketId!), eq(tickets.status, 'active'), isNull(tickets.usedAt)));
      }
      const entered = outcome === 'processable';
      const scanEventId = await this.recordScanEvent(tx, { contract, context, token: input.token,
        deviceAttemptId: input.deviceAttemptId, requestedShowtimeId: input.showtimeId, outcome: entered ? 'success' : scanResultForOutcome(outcome),
        rejectionReason: entered ? null : rejectionReasonFor(outcome) });
      await this.writeAudit({ action: 'field.scan.consume', status: entered ? 'success' : 'denied', resourceId: ticketResourceId(contract), context,
        after: { outcome: entered ? 'entered' : outcome, scanEventId, redactedTokenRef: redactedTokenRef(input.token),
          admissionUnit: 'ticket_item', consumedTicketItemCount: entered ? 1 : 0 } }, tx);
      return { outcome: entered ? 'entered' : outcome, ticket: toTicketContext(contract, input.token), scanEventId,
        consumedAt: entered ? consumedAt.toISOString() : null, rejectionReason: entered ? null : rejectionReasonFor(outcome), priorScan };
    });
  }

  private async findPriorSuccessfulScan(
    db: ScanEventDb,
    contract: QrTicketScannerContract,
  ): Promise<PriorScanContext | null> {
    const rows = await db
      .select({
        outcome: ticketScanEvents.result,
        scannedAt: ticketScanEvents.scannedAt,
        scannerUserId: ticketScanEvents.scannerUserId,
        deviceAttemptId: ticketScanEvents.deviceAttemptId,
      })
      .from(ticketScanEvents)
      .where(
        and(
          eq(ticketScanEvents.ticketItemId, contract.ticketItemId),
          eq(ticketScanEvents.reservationId, contract.reservationId),
          eq(ticketScanEvents.showtimeId, contract.showtimeId),
          eq(ticketScanEvents.result, 'success'),
        ),
      )
      .orderBy(desc(ticketScanEvents.scannedAt))
      .limit(1);
    const prior = rows[0];

    if (!prior) {
      return contract.enteredAt ? { scannedAt: contract.enteredAt } : null;
    }

    return {
      scannedAt: toIso(prior.scannedAt),
      scannerUserId: prior.scannerUserId ? maskContextValue(prior.scannerUserId) : undefined,
      deviceAttemptId: prior.deviceAttemptId
        ? maskContextValue(prior.deviceAttemptId)
        : undefined,
    };
  }

  private async loadBenefitEntitlements(
    contract: QrTicketScannerContract,
    db: ScanEventDb = this.db,
  ): Promise<FieldBenefitEntitlement[]> {
    const selectBuilder = db.select?.({
      id: ticketBenefitEntitlements.id,
      runId: ticketBenefitEntitlements.runId,
      source: ticketBenefitEntitlements.source,
      benefitIdentity: ticketBenefitEntitlements.benefitIdentity,
      benefitKind: ticketBenefitEntitlements.benefitKind,
      displayCopySnapshot: ticketBenefitEntitlements.displayCopySnapshot,
      state: ticketBenefitEntitlements.state,
      redeemedAt: ticketBenefitEntitlements.redeemedAt,
      createdAt: ticketBenefitEntitlements.createdAt,
    });

    if (!selectBuilder || typeof selectBuilder.from !== 'function') {
      return [];
    }

    const rows = await selectBuilder
      .from(ticketBenefitEntitlements)
      .where(and(
        eq(ticketBenefitEntitlements.showtimeId, contract.showtimeId),
        eq(ticketBenefitEntitlements.ticketItemId, contract.ticketItemId),
      ))
      .orderBy(
        asc(ticketBenefitEntitlements.createdAt),
        asc(ticketBenefitEntitlements.id),
      )
      .limit(50);

    return (rows as FieldBenefitEntitlementRow[]).map(toFieldBenefitEntitlement);
  }

  private async loadBenefitEntitlementsSafely(
    contract: QrTicketScannerContract,
  ): Promise<{ entitlements: FieldBenefitEntitlement[]; available: boolean }> {
    try {
      return { entitlements: await this.loadBenefitEntitlements(contract), available: true };
    } catch {
      return { entitlements: [], available: false };
    }
  }

  private async recordScanEvent(
    db: ScanEventDb,
    input: {
      contract: QrTicketScannerContract;
      context: FieldScannerContext;
      outcome: 'success' | 'duplicate' | 'tampered' | 'refunded_cancelled' | 'expired' | 'wrong_showtime' | 'already_used';
      deviceAttemptId: string;
      requestedShowtimeId: string;
      token: string;
      rejectionReason?: string | null;
    },
  ): Promise<string> {
    const fallbackId = randomUUID();
    const insertBuilder = db.insert(ticketScanEvents);
    if (!insertBuilder || typeof insertBuilder.values !== 'function') {
      return fallbackId;
    }

    const [row] = await insertBuilder
      .values({
        ticketId: input.contract.ticketId ?? fallbackId,
        ticketItemId: input.contract.ticketItemId,
        reservationId: input.contract.reservationId,
        showtimeId: input.contract.showtimeId,
        scannerUserId: input.context.scannerUserId,
        result: input.outcome,
        source: input.context.scanSource ?? 'online',
        syncState: input.context.offlineSyncState
          ?? resolveScanSyncState(input.context.scanSource, input.outcome),
        deviceAttemptId: input.deviceAttemptId,
        maskedJti: input.contract.maskedJti,
        rejectionReason: input.rejectionReason ?? null,
        metadata: {
          redactedTokenRef: redactedTokenRef(input.token),
          performanceId: input.contract.performanceId,
          requestedShowtimeId: input.requestedShowtimeId,
          ticketItemId: input.contract.ticketItemId,
        },
      })
      .returning({ id: ticketScanEvents.id });

    return row?.id ?? fallbackId;
  }

  private async writeAudit(
    input: {
      action: 'field.scan.verify' | 'field.scan.consume';
      status: AdminAuditStatus;
      resourceId: string;
      context?: Partial<FieldScannerContext>;
      after: Record<string, unknown>;
    },
    db: AuditDb = this.db,
  ): Promise<void> {
    await this.adminAuditService.write(
      {
        actorUserId: input.context?.scannerUserId ?? UNKNOWN_SCANNER_USER_ID,
        action: input.action,
        resourceType: 'ticket',
        resourceId: input.resourceId,
        status: input.status,
        after: input.after,
        ipAddress: input.context?.ipAddress ?? null,
        userAgent: input.context?.userAgent ?? null,
        requestId: input.context?.requestId ?? null,
      },
      db,
    );
  }
}

function extractToken(input: FieldCheckInVerifyRequest): string {
  return parseFieldCheckInToken(input);
}

function classifyScannerContract(
  contract: QrTicketScannerContract,
  requestedShowtimeId?: string,
): FieldCheckInOutcome {
  if (requestedShowtimeId && contract.showtimeId !== requestedShowtimeId) {
    return 'wrong_showtime';
  }

  switch (contract.ticketStatus) {
    case 'ACTIVE':
      return 'processable';
    case 'USED':
      return 'already_used';
    case 'EXPIRED':
      return 'expired';
    case 'REVOKED':
      return 'refunded_cancelled';
  }
}

function toTicketContext(
  contract: QrTicketScannerContract,
  token: string,
  benefitEntitlements: FieldBenefitEntitlement[] = [],
  benefitsAvailable = true,
): FieldCheckInTicketContext {
  return {
    reservationNumber: contract.reservationNumber ?? contract.reservationId,
    performanceTitle: contract.performanceTitle,
    venueName: contract.venueName,
    showtimeId: contract.showtimeId,
    showtimeLabel: contract.showtimeAt,
    seatLabels: contract.seatLabels ?? [],
    ticketStatus: contract.ticketStatus,
    redactedTokenRef: redactedTokenRef(token),
    maskedJti: contract.maskedJti,
    benefitEntitlements,
    benefitsAvailable,
  };
}

function toFieldBenefitEntitlement(
  row: FieldBenefitEntitlementRow,
): FieldBenefitEntitlement {
  const displayCopy = ticketBenefitDisplayCopySchema.parse(row.displayCopySnapshot);
  const base = {
    id: row.id,
    runId: row.runId,
    benefitIdentity: row.benefitIdentity,
    kind: row.benefitKind,
    displayCopy,
    state: row.state,
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
      if (!row.runId) {
        throw new InternalServerErrorException('rollback benefit entitlement is missing runId');
      }
      return {
        ...base,
        source: 'rollback',
        runId: row.runId,
        attachedToTicket: true,
        runMode: 'live',
      };
  }
}

function ticketResourceId(contract: QrTicketScannerContract): string {
  return contract.ticketItemId || contract.ticketId || contract.reservationId;
}

function scanResultForOutcome(
  outcome: FieldCheckInOutcome,
): 'success' | 'duplicate' | 'tampered' | 'refunded_cancelled' | 'expired' | 'wrong_showtime' | 'already_used' {
  if (outcome === 'processable' || outcome === 'entered') {
    return 'success';
  }
  if (outcome === 'synced' || outcome === 'rejected' || outcome === 'offline_pending') {
    return 'tampered';
  }
  return outcome;
}

function resolveScanSyncState(
  source: FieldScannerContext['scanSource'],
  outcome: 'success' | 'duplicate' | 'tampered' | 'refunded_cancelled' | 'expired' | 'wrong_showtime' | 'already_used',
): 'not_required' | 'synced' | 'rejected' {
  if (source !== 'offline_sync') {
    return 'not_required';
  }

  return outcome === 'success' ? 'synced' : 'rejected';
}

function rejectionReasonFor(outcome: FieldCheckInOutcome): string {
  switch (outcome) {
    case 'duplicate':
      return '이미 입장 처리된 티켓입니다';
    case 'tampered':
      return '검증할 수 없는 QR 티켓입니다';
    case 'refunded_cancelled':
      return '취소 또는 환불된 티켓입니다';
    case 'expired':
      return '만료된 QR 티켓입니다';
    case 'wrong_showtime':
      return '요청한 회차와 일치하지 않는 티켓입니다';
    case 'already_used':
      return '이미 사용된 티켓입니다';
    case 'offline_pending':
      return '오프라인 처리 대기 중입니다';
    case 'synced':
      return '오프라인 처리가 동기화되었습니다';
    case 'rejected':
      return '오프라인 처리가 거절되었습니다';
    case 'processable':
    case 'entered':
      return '';
  }

  return '처리할 수 없는 검표 상태입니다';
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

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function caseNameForOutcome(outcome: FieldCheckInOutcome): string {
  switch (outcome) {
    case 'refunded_cancelled':
      return 'refunded/cancelled';
    case 'wrong_showtime':
      return 'wrong-showtime';
    case 'already_used':
      return 'already-used';
    default:
      return outcome;
  }
}
