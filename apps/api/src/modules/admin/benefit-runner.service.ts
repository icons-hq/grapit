import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import {
  benefitEntitlementExportRowSchema,
  benefitRunRecordSchema,
  type BenefitConfiguration,
  type BenefitDefinition,
  type BenefitEntitlementExportRow,
  type BenefitRunRecord,
  type TicketBenefitDisplayCopy,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  reservations,
  ticketBenefitConfigurations,
  ticketBenefitEntitlements,
  ticketBenefitRuns,
  ticketBenefits,
  ticketItems,
} from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBenefitsService } from './admin-benefits.service.js';
import { safeCsvRows, withUtf8Bom } from './csv-export.util.js';

const CONTENT_TYPE = 'text/csv; charset=utf-8' as const;
const RESULT_SUMMARY_VERSION = 1 as const;
const PENDING_RUN_ID = '00000000-0000-4000-8000-000000000000';

type LimitedBenefit = Extract<BenefitDefinition, { kind: 'limited' }>;
type BenefitConfigurationRow = typeof ticketBenefitConfigurations.$inferSelect;
type TicketBenefitRow = typeof ticketBenefits.$inferSelect;
type BenefitRunRow = typeof ticketBenefitRuns.$inferSelect;
type BenefitEntitlementRow = typeof ticketBenefitEntitlements.$inferSelect;
type BenefitMutationDb = DrizzleDB & Pick<DrizzleDB, 'execute'>;

interface TicketItemCandidate {
  ticketItemId: string;
  reservationId: string;
  buyerUserId: string;
  tierName: string;
  status: string;
  admissionState: string;
}

interface BenefitAssignment {
  ticketItemId: string;
  reservationId: string;
  buyerUserId: string;
  tierName: string;
  admissionState: string;
  benefitIdentity: string;
  benefitKind: 'limited';
  benefitNameKo: string;
  displayCopy: TicketBenefitDisplayCopy;
  selectionPriority: number;
  assignedAt: string;
}

interface BenefitSelectionSummary {
  benefitIdentity: string;
  benefitNameKo: string;
  requestedQuantity: number;
  assignedCount: number;
  shortfallCount: number;
  eligibleTicketItemCount: number;
  selectionPriority: number;
}

export interface BenefitRunResultSummary {
  version: typeof RESULT_SUMMARY_VERSION;
  seedRef: string;
  sourceRunId?: string;
  assignments: BenefitAssignment[];
  benefits: BenefitSelectionSummary[];
  exportRows: BenefitEntitlementExportRow[];
  totalAssignedCount: number;
  totalShortfallCount: number;
  skippedInactiveTicketItemCount?: number;
}

export type BenefitRunRecordWithSummary = BenefitRunRecord & {
  resultSummary: BenefitRunResultSummary;
};

export interface BenefitRunOperationContext {
  now?: Date;
  randomSeed?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface BenefitRunExportActor {
  actorUserId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface BenefitCsvExportResult {
  filename: string;
  contentType: typeof CONTENT_TYPE;
  csv: string;
  rowCount: number;
  generatedAt: string;
}

export interface TestBenefitRunInput {
  showtimeId: string;
  actorUserId: string;
  configurationId?: string | null;
  operatorProvidedSeedRef?: string;
  configurationSnapshot?: {
    active: false;
    sourceConfigurationId?: string | null;
    capturedAt?: string;
    benefits: BenefitDefinition[];
  };
}

export interface LiveBenefitRunInput {
  showtimeId: string;
  actorUserId: string;
  configurationId: string;
  reason?: string;
  confirmed: true;
  operatorProvidedSeedRef?: string;
}

export interface BenefitRollbackInput {
  showtimeId: string;
  actorUserId: string;
  sourceRunId: string;
  sourceRunMode: 'live';
  reason: string;
  confirmed: true;
}

@Injectable()
export class BenefitRunnerService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminBenefitsService: AdminBenefitsService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async runTest(
    input: TestBenefitRunInput,
    context: BenefitRunOperationContext = {},
  ): Promise<BenefitRunRecordWithSummary> {
    const now = context.now ?? new Date();
    const configuration = input.configurationSnapshot
      ? configurationFromSnapshot(input.showtimeId, input.configurationSnapshot, now)
      : await this.loadActiveConfiguration(this.db, input.showtimeId);
    if (!configuration) {
      throw new NotFoundException('혜택 설정을 찾을 수 없습니다');
    }
    if (input.configurationId && configuration.id !== input.configurationId) {
      throw new BadRequestException('요청한 혜택 설정이 현재 회차 설정과 일치하지 않습니다');
    }

    const seed = input.operatorProvidedSeedRef ?? context.randomSeed ?? generateInternalSeed();
    const seedRef = redactedSeedRef(seed);
    const candidates = await this.loadActiveTicketItemCandidates(
      this.db,
      input.showtimeId,
    );
    const summary = selectLimitedBenefits({
      configuration,
      candidates,
      seed,
      seedRef,
      assignedAt: now.toISOString(),
      runId: null,
      source: 'test_run',
      attachedToTicket: false,
    });

    const [run] = await this.db
      .insert(ticketBenefitRuns)
      .values({
        showtimeId: input.showtimeId,
        mode: 'test',
        status: 'completed',
        configurationSnapshot: configurationSnapshot(configuration, now),
        seedRef,
        randomSeedInternal: seed,
        resultSummary: summary as unknown as Record<string, unknown>,
        actorUserId: input.actorUserId,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: ticketBenefitRuns.id,
        createdAt: ticketBenefitRuns.createdAt,
        updatedAt: ticketBenefitRuns.updatedAt,
      });

    if (!run) {
      throw new InternalServerErrorException('혜택 테스트 실행 결과를 확인할 수 없습니다');
    }

    const summaryWithRunId = attachRunIdToExportRows(summary, run.id);
    await this.replaceRunSummary(this.db, run.id, summaryWithRunId, now);

    return buildRunRecord({
      id: run.id,
      showtimeId: input.showtimeId,
      mode: 'test',
      configuration,
      seedRef,
      operatorProvidedSeedRef: input.operatorProvidedSeedRef,
      actorUserId: input.actorUserId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      resultSummary: summaryWithRunId,
    });
  }

  async runLive(
    input: LiveBenefitRunInput,
    context: BenefitRunOperationContext = {},
  ): Promise<BenefitRunRecordWithSummary> {
    if (input.operatorProvidedSeedRef) {
      throw new BadRequestException('라이브 혜택 실행에는 operator seed를 사용할 수 없습니다');
    }
    if (input.confirmed !== true) {
      throw new BadRequestException('라이브 혜택 실행 확인이 필요합니다');
    }

    const now = context.now ?? new Date();
    const seed = context.randomSeed ?? generateInternalSeed();
    const seedRef = redactedSeedRef(seed);

    return this.db.transaction(async (tx) => {
      await this.adminBenefitsService.lockShowtimeForBenefitMutation(
        tx as BenefitMutationDb,
        input.showtimeId,
      );
      await this.adminBenefitsService.assertBenefitResultUnlockedForMutation(
        tx as DrizzleDB,
        input.showtimeId,
      );

      const configuration = await this.loadActiveConfiguration(tx as DrizzleDB, input.showtimeId);
      if (!configuration) {
        throw new NotFoundException('혜택 설정을 찾을 수 없습니다');
      }
      if (configuration.id !== input.configurationId) {
        throw new BadRequestException('요청한 혜택 설정이 현재 회차 설정과 일치하지 않습니다');
      }

      const candidates = await this.lockActiveTicketItemCandidates(
        tx as BenefitMutationDb,
        input.showtimeId,
        await this.loadActiveTicketItemCandidates(
          tx as DrizzleDB,
          input.showtimeId,
        ),
      );
      const summary = selectLimitedBenefits({
        configuration,
        candidates,
        seed,
        seedRef,
        assignedAt: now.toISOString(),
        runId: null,
        source: 'live_run',
        attachedToTicket: true,
      });
      const [run] = await tx
        .insert(ticketBenefitRuns)
        .values({
          showtimeId: input.showtimeId,
          mode: 'live',
          status: 'completed',
          configurationSnapshot: configurationSnapshot(configuration, now),
          seedRef,
          randomSeedInternal: seed,
          resultSummary: summary as unknown as Record<string, unknown>,
          actorUserId: input.actorUserId,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: ticketBenefitRuns.id,
          createdAt: ticketBenefitRuns.createdAt,
          updatedAt: ticketBenefitRuns.updatedAt,
        });

      if (!run) {
        throw new InternalServerErrorException('혜택 라이브 실행 결과를 확인할 수 없습니다');
      }

      await inactivateActiveLimitedEntitlements(
        tx as DrizzleDB,
        input.showtimeId,
        'replaced_by_live_run',
        now,
      );
      const insertedEntitlementIds = await insertAssignmentsAsEntitlements({
        db: tx as DrizzleDB,
        showtimeId: input.showtimeId,
        runId: run.id,
        source: 'live_run',
        assignments: summary.assignments,
        now,
      });
      const finalSummary = attachRunEvidence(summary, run.id, insertedEntitlementIds);
      await this.replaceRunSummary(tx as DrizzleDB, run.id, finalSummary, now);
      await this.adminAuditService.write({
        actorUserId: input.actorUserId,
        action: 'benefits.run.live',
        resourceType: 'benefit_run',
        resourceId: run.id,
        status: 'success',
        reason: normalizeOptionalReason(input.reason),
        changedFields: [
          'showtimeId',
          'configurationId',
          'runId',
          'assignedCount',
          'shortfallCount',
        ],
        before: {},
        after: {
          showtimeId: input.showtimeId,
          configurationId: input.configurationId,
          runId: run.id,
          assignedCount: finalSummary.totalAssignedCount,
          shortfallCount: finalSummary.totalShortfallCount,
        },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
      }, tx as DrizzleDB);

      return buildRunRecord({
        id: run.id,
        showtimeId: input.showtimeId,
        mode: 'live',
        configuration,
        seedRef,
        actorUserId: input.actorUserId,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        resultSummary: finalSummary,
      });
    });
  }

  async rollback(
    input: BenefitRollbackInput,
    context: BenefitRunOperationContext = {},
  ): Promise<BenefitRunRecordWithSummary> {
    if (input.confirmed !== true) {
      throw new BadRequestException('혜택 rollback 확인이 필요합니다');
    }

    const now = context.now ?? new Date();
    const seed = context.randomSeed ?? generateInternalSeed();
    const seedRef = redactedSeedRef(seed);

    return this.db.transaction(async (tx) => {
      await this.adminBenefitsService.lockShowtimeForBenefitMutation(
        tx as BenefitMutationDb,
        input.showtimeId,
      );
      await this.adminBenefitsService.assertBenefitResultUnlockedForMutation(
        tx as DrizzleDB,
        input.showtimeId,
      );

      const sourceRun = await this.loadRunRow(tx as DrizzleDB, input.sourceRunId);
      if (sourceRun.showtimeId !== input.showtimeId) {
        throw new BadRequestException('rollback source run의 회차가 일치하지 않습니다');
      }
      if (sourceRun.mode !== 'live') {
        throw new BadRequestException('live run만 rollback source로 사용할 수 있습니다');
      }
      if (sourceRun.status !== 'completed') {
        throw new BadRequestException('완료된 live run만 rollback source로 사용할 수 있습니다');
      }

      const sourceSummary = parseCompletedRunSummary(sourceRun.resultSummary);
      const activeCandidates = await this.lockActiveTicketItemCandidates(
        tx as BenefitMutationDb,
        input.showtimeId,
        await this.loadActiveTicketItemCandidates(
          tx as DrizzleDB,
          input.showtimeId,
        ),
      );
      const activeTicketItemIds = new Set(
        activeCandidates.map((candidate) => candidate.ticketItemId),
      );
      const restoredAssignments = sourceSummary.assignments.filter((assignment) =>
        activeTicketItemIds.has(assignment.ticketItemId),
      );
      const restoredSummary = buildRollbackSummary({
        sourceSummary,
        sourceRunId: input.sourceRunId,
        showtimeId: input.showtimeId,
        assignments: restoredAssignments,
        seedRef,
        runId: null,
      });
      const configuration = configurationFromRunRow(sourceRun);

      const [run] = await tx
        .insert(ticketBenefitRuns)
        .values({
          showtimeId: input.showtimeId,
          mode: 'live',
          status: 'completed',
          configurationSnapshot: sourceRun.configurationSnapshot,
          seedRef,
          randomSeedInternal: seed,
          resultSummary: restoredSummary as unknown as Record<string, unknown>,
          actorUserId: input.actorUserId,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: ticketBenefitRuns.id,
          createdAt: ticketBenefitRuns.createdAt,
          updatedAt: ticketBenefitRuns.updatedAt,
        });

      if (!run) {
        throw new InternalServerErrorException('혜택 rollback 실행 결과를 확인할 수 없습니다');
      }

      await inactivateActiveLimitedEntitlements(
        tx as DrizzleDB,
        input.showtimeId,
        'rollback_to_previous_run',
        now,
      );
      const insertedEntitlementIds = await insertAssignmentsAsEntitlements({
        db: tx as DrizzleDB,
        showtimeId: input.showtimeId,
        runId: run.id,
        source: 'rollback',
        assignments: restoredSummary.assignments,
        now,
      });
      const finalSummary = attachRunEvidence(
        restoredSummary,
        run.id,
        insertedEntitlementIds,
      );
      await this.replaceRunSummary(tx as DrizzleDB, run.id, finalSummary, now);
      await this.adminAuditService.write({
        actorUserId: input.actorUserId,
        action: 'benefits.run.rollback',
        resourceType: 'benefit_run',
        resourceId: run.id,
        status: 'success',
        reason: input.reason.trim(),
        changedFields: [
          'showtimeId',
          'sourceRunId',
          'runId',
          'assignedCount',
          'shortfallCount',
          'skippedInactiveTicketItemCount',
        ],
        before: {},
        after: {
          showtimeId: input.showtimeId,
          sourceRunId: input.sourceRunId,
          runId: run.id,
          assignedCount: finalSummary.totalAssignedCount,
          shortfallCount: finalSummary.totalShortfallCount,
          skippedInactiveTicketItemCount: finalSummary.skippedInactiveTicketItemCount ?? 0,
        },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
      }, tx as DrizzleDB);

      return buildRunRecord({
        id: run.id,
        showtimeId: input.showtimeId,
        mode: 'live',
        configuration,
        seedRef,
        actorUserId: input.actorUserId,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        resultSummary: finalSummary,
      });
    });
  }

  async listRuns(
    showtimeId: string,
    limit = 50,
  ): Promise<{
    runs: BenefitRunRecordWithSummary[];
    nextCursor: null;
  }> {
    const rows = await this.db
      .select()
      .from(ticketBenefitRuns)
      .where(eq(ticketBenefitRuns.showtimeId, showtimeId))
      .orderBy(desc(ticketBenefitRuns.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return {
      runs: (rows as BenefitRunRow[]).map(rowToRunRecord),
      nextCursor: null,
    };
  }

  async getRun(runId: string): Promise<BenefitRunRecordWithSummary> {
    const row = await this.loadRunRow(this.db, runId);
    return rowToRunRecord(row);
  }

  async exportRun(
    runId: string,
    actor: BenefitRunExportActor,
  ): Promise<BenefitCsvExportResult> {
    const row = await this.loadRunRow(this.db, runId);
    const summary = normalizeResultSummary(row.resultSummary);
    const generatedAt = (actor.now ?? new Date()).toISOString();
    const rows = summary.exportRows;
    const csv = withUtf8Bom(safeCsvRows([
      entitlementExportHeader(),
      ...rows.map(entitlementExportRowToCsvValues),
    ]));
    await this.adminAuditService.write({
      actorUserId: actor.actorUserId,
      action: 'benefits.run.export',
      resourceType: 'benefit_run',
      resourceId: runId,
      status: 'success',
      reason: null,
      changedFields: ['runId', 'showtimeId', 'rowCount', 'generatedAt'],
      before: {},
      after: {
        runId,
        showtimeId: row.showtimeId,
        rowCount: rows.length,
        generatedAt,
      },
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    }, this.db);

    return {
      filename: `benefit-run-${runId}-${generatedAt.slice(0, 10)}.csv`,
      contentType: CONTENT_TYPE,
      csv,
      rowCount: rows.length,
      generatedAt,
    };
  }

  async exportEntitlements(
    showtimeId: string,
    actor: BenefitRunExportActor,
  ): Promise<BenefitCsvExportResult> {
    const rows = await this.db
      .select({
        id: ticketBenefitEntitlements.id,
        ticketItemId: ticketBenefitEntitlements.ticketItemId,
        showtimeId: ticketBenefitEntitlements.showtimeId,
        runId: ticketBenefitEntitlements.runId,
        source: ticketBenefitEntitlements.source,
        benefitIdentity: ticketBenefitEntitlements.benefitIdentity,
        benefitKind: ticketBenefitEntitlements.benefitKind,
        displayCopySnapshot: ticketBenefitEntitlements.displayCopySnapshot,
        state: ticketBenefitEntitlements.state,
        redeemedAt: ticketBenefitEntitlements.redeemedAt,
        createdAt: ticketBenefitEntitlements.createdAt,
      })
      .from(ticketBenefitEntitlements)
      .where(eq(ticketBenefitEntitlements.showtimeId, showtimeId))
      .orderBy(asc(ticketBenefitEntitlements.createdAt));
    const generatedAt = (actor.now ?? new Date()).toISOString();
    const exportRows = (rows as BenefitEntitlementRow[]).map(entitlementRowToExportRow);
    const csv = withUtf8Bom(safeCsvRows([
      entitlementExportHeader(),
      ...exportRows.map(entitlementExportRowToCsvValues),
    ]));
    await this.adminAuditService.write({
      actorUserId: actor.actorUserId,
      action: 'benefits.entitlements.export',
      resourceType: 'benefit_entitlements',
      resourceId: showtimeId,
      status: 'success',
      reason: null,
      changedFields: ['showtimeId', 'rowCount', 'generatedAt'],
      before: {},
      after: {
        showtimeId,
        rowCount: exportRows.length,
        generatedAt,
      },
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    }, this.db);

    return {
      filename: `benefit-entitlements-${showtimeId}-${generatedAt.slice(0, 10)}.csv`,
      contentType: CONTENT_TYPE,
      csv,
      rowCount: exportRows.length,
      generatedAt,
    };
  }

  private async loadRunRow(db: DrizzleDB, runId: string): Promise<BenefitRunRow> {
    const [row] = await db
      .select()
      .from(ticketBenefitRuns)
      .where(eq(ticketBenefitRuns.id, runId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('혜택 실행 기록을 찾을 수 없습니다');
    }
    return row as BenefitRunRow;
  }

  private async loadActiveConfiguration(
    db: DrizzleDB,
    showtimeId: string,
  ): Promise<BenefitConfiguration | null> {
    const [configuration] = await db
      .select({
        id: ticketBenefitConfigurations.id,
        showtimeId: ticketBenefitConfigurations.showtimeId,
        version: ticketBenefitConfigurations.version,
        createdByUserId: ticketBenefitConfigurations.createdByUserId,
        updatedByUserId: ticketBenefitConfigurations.updatedByUserId,
        createdAt: ticketBenefitConfigurations.createdAt,
        updatedAt: ticketBenefitConfigurations.updatedAt,
      })
      .from(ticketBenefitConfigurations)
      .where(eq(ticketBenefitConfigurations.showtimeId, showtimeId))
      .orderBy(desc(ticketBenefitConfigurations.version))
      .limit(1);

    if (!configuration) {
      return null;
    }

    const benefitRows = await db
      .select({
        id: ticketBenefits.id,
        configurationId: ticketBenefits.configurationId,
        identity: ticketBenefits.identity,
        kind: ticketBenefits.kind,
        displayCopy: ticketBenefits.displayCopy,
        eligibleTierNames: ticketBenefits.eligibleTierNames,
        quantity: ticketBenefits.quantity,
        selectionPriority: ticketBenefits.selectionPriority,
        mutualExclusionGroup: ticketBenefits.mutualExclusionGroup,
        createdAt: ticketBenefits.createdAt,
        updatedAt: ticketBenefits.updatedAt,
      })
      .from(ticketBenefits)
      .where(eq(ticketBenefits.configurationId, configuration.id))
      .orderBy(asc(ticketBenefits.identity));

    return configurationFromRows(
      configuration as BenefitConfigurationRow,
      benefitRows as TicketBenefitRow[],
    );
  }

  private async loadActiveTicketItemCandidates(
    db: DrizzleDB,
    showtimeId: string,
  ): Promise<TicketItemCandidate[]> {
    const rows = await db
      .select({
        ticketItemId: ticketItems.id,
        reservationId: ticketItems.reservationId,
        buyerUserId: reservations.userId,
        tierName: ticketItems.tierName,
        status: ticketItems.status,
        admissionState: ticketItems.admissionState,
      })
      .from(ticketItems)
      .innerJoin(reservations, eq(ticketItems.reservationId, reservations.id))
      .where(and(
        eq(ticketItems.showtimeId, showtimeId),
        eq(ticketItems.status, 'active'),
      ))
      .orderBy(asc(ticketItems.id));

    return (rows as TicketItemCandidate[])
      .filter((row) => row.status === 'active')
      .map((row) => ({
        ticketItemId: row.ticketItemId ?? (row as unknown as { id: string }).id,
        reservationId: row.reservationId,
        buyerUserId: row.buyerUserId ?? (row as unknown as { userId: string }).userId,
        tierName: row.tierName,
        status: row.status,
        admissionState: row.admissionState,
      }))
      .sort((left, right) => left.ticketItemId.localeCompare(right.ticketItemId));
  }

  private async lockActiveTicketItemCandidates(
    db: BenefitMutationDb,
    showtimeId: string,
    candidates: TicketItemCandidate[],
  ): Promise<TicketItemCandidate[]> {
    if (candidates.length === 0) {
      return [];
    }

    const ticketItemIds = candidates.map((candidate) => candidate.ticketItemId);
    const locked = await db.execute(sql`
      SELECT ti.id
      FROM ticket_items ti
      WHERE ti.showtime_id = ${showtimeId}
        AND ti.status = 'active'
        AND ti.id IN (${sql.join(ticketItemIds.map((id) => sql`${id}`), sql`, `)})
      FOR UPDATE OF ti
    `);
    const lockedIds = new Set(
      executeRows<{ id: string }>(locked).map((row) => String(row.id)),
    );

    return candidates.filter((candidate) => lockedIds.has(candidate.ticketItemId));
  }

  private async replaceRunSummary(
    db: DrizzleDB,
    runId: string,
    summary: BenefitRunResultSummary,
    now: Date,
  ): Promise<void> {
    await db
      .update(ticketBenefitRuns)
      .set({
        resultSummary: summary as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(ticketBenefitRuns.id, runId));
  }
}

function selectLimitedBenefits(input: {
  configuration: BenefitConfiguration;
  candidates: TicketItemCandidate[];
  seed: string;
  seedRef: string;
  assignedAt: string;
  runId: string | null;
  source: 'live_run' | 'test_run';
  attachedToTicket: boolean;
}): BenefitRunResultSummary {
  const limitedBenefits = input.configuration.benefits
    .filter((benefit): benefit is LimitedBenefit => benefit.kind === 'limited')
    .sort((left, right) =>
      left.selectionPriority - right.selectionPriority
      || left.identity.localeCompare(right.identity),
    );
  const assignedTicketItemIds = new Set<string>();
  const buyerWins = new Map<string, Set<string>>();
  const assignments: BenefitAssignment[] = [];
  const benefitSummaries: BenefitSelectionSummary[] = [];

  for (const benefit of limitedBenefits) {
    const eligibleTierNames = new Set(benefit.eligibleTierNames);
    const eligible = input.candidates.filter((candidate) =>
      eligibleTierNames.has(candidate.tierName)
      && !assignedTicketItemIds.has(candidate.ticketItemId)
      && !buyerHasMutualExclusion(candidate.buyerUserId, benefit, buyerWins, limitedBenefits),
    );
    const selected = deterministicShuffle(
      eligible,
      `${input.seed}:${benefit.identity}`,
    ).slice(0, benefit.quantity);

    for (const ticketItem of selected) {
      assignedTicketItemIds.add(ticketItem.ticketItemId);
      const wins = buyerWins.get(ticketItem.buyerUserId) ?? new Set<string>();
      wins.add(benefit.identity);
      buyerWins.set(ticketItem.buyerUserId, wins);
      assignments.push({
        ticketItemId: ticketItem.ticketItemId,
        reservationId: ticketItem.reservationId,
        buyerUserId: ticketItem.buyerUserId,
        tierName: ticketItem.tierName,
        admissionState: ticketItem.admissionState,
        benefitIdentity: benefit.identity,
        benefitKind: 'limited',
        benefitNameKo: benefit.displayCopy.ko.name,
        displayCopy: benefit.displayCopy,
        selectionPriority: benefit.selectionPriority,
        assignedAt: input.assignedAt,
      });
    }

    benefitSummaries.push({
      benefitIdentity: benefit.identity,
      benefitNameKo: benefit.displayCopy.ko.name,
      requestedQuantity: benefit.quantity,
      assignedCount: selected.length,
      shortfallCount: Math.max(benefit.quantity - selected.length, 0),
      eligibleTicketItemCount: eligible.length,
      selectionPriority: benefit.selectionPriority,
    });
  }

  return {
    version: RESULT_SUMMARY_VERSION,
    seedRef: input.seedRef,
    assignments,
    benefits: benefitSummaries,
    exportRows: assignments.map((assignment) =>
      assignmentToExportRow({
        assignment,
        showtimeId: input.configuration.showtimeId,
        runId: input.runId,
        source: input.source,
        attachedToTicket: input.attachedToTicket,
      }),
    ),
    totalAssignedCount: assignments.length,
    totalShortfallCount: benefitSummaries.reduce(
      (sum, benefit) => sum + benefit.shortfallCount,
      0,
    ),
  };
}

function buildRollbackSummary(input: {
  sourceSummary: BenefitRunResultSummary;
  sourceRunId: string;
  showtimeId: string;
  assignments: BenefitAssignment[];
  seedRef: string;
  runId: string | null;
}): BenefitRunResultSummary {
  const benefits = summarizeAssignmentsByBenefit(
    input.sourceSummary.benefits,
    input.assignments,
  );

  return {
    version: RESULT_SUMMARY_VERSION,
    seedRef: input.seedRef,
    sourceRunId: input.sourceRunId,
    assignments: input.assignments,
    benefits,
    exportRows: input.assignments.map((assignment) =>
      assignmentToExportRow({
        assignment,
        showtimeId: input.showtimeId,
        runId: input.runId,
        source: 'rollback',
        attachedToTicket: true,
      }),
    ),
    totalAssignedCount: input.assignments.length,
    totalShortfallCount: benefits.reduce(
      (sum, benefit) => sum + benefit.shortfallCount,
      0,
    ),
    skippedInactiveTicketItemCount:
      input.sourceSummary.assignments.length - input.assignments.length,
  };
}

function summarizeAssignmentsByBenefit(
  sourceBenefits: BenefitSelectionSummary[],
  assignments: BenefitAssignment[],
): BenefitSelectionSummary[] {
  return sourceBenefits.map((benefit) => {
    const assignedCount = assignments.filter((assignment) =>
      assignment.benefitIdentity === benefit.benefitIdentity,
    ).length;
    return {
      ...benefit,
      assignedCount,
      shortfallCount: Math.max(benefit.requestedQuantity - assignedCount, 0),
    };
  });
}

function attachRunIdToExportRows(
  summary: BenefitRunResultSummary,
  runId: string,
): BenefitRunResultSummary {
  return {
    ...summary,
    exportRows: summary.exportRows.map((row) => ({
      ...row,
      benefitEntitlementId: exportEntitlementId(
        runId,
        row.ticketItemId,
        row.benefitIdentity,
      ),
      runId,
    }) as BenefitEntitlementExportRow),
  };
}

function attachRunEvidence(
  summary: BenefitRunResultSummary,
  runId: string,
  entitlementIds: string[],
): BenefitRunResultSummary {
  if (entitlementIds.length !== summary.assignments.length) {
    throw new InternalServerErrorException('혜택 entitlement 저장 결과 수가 일치하지 않습니다');
  }

  return {
    ...summary,
    exportRows: summary.exportRows.map((row, index) => ({
      ...row,
      benefitEntitlementId: entitlementIds[index]!,
      runId,
    }) as BenefitEntitlementExportRow),
  };
}

function parseCompletedRunSummary(value: unknown): BenefitRunResultSummary {
  const summary = value as Partial<BenefitRunResultSummary> | null;
  if (!summary || !Array.isArray(summary.assignments) || !Array.isArray(summary.benefits)) {
    throw new BadRequestException('rollback source run의 결과 summary가 유효하지 않습니다');
  }

  return normalizeResultSummary(summary);
}

function assignmentToExportRow(input: {
  assignment: BenefitAssignment;
  showtimeId: string;
  runId: string | null;
  source: 'live_run' | 'test_run' | 'rollback';
  attachedToTicket: boolean;
}): BenefitEntitlementExportRow {
  const runId = input.runId ?? PENDING_RUN_ID;
  return benefitEntitlementExportRowSchema.parse({
    benefitEntitlementId: exportEntitlementId(
      runId,
      input.assignment.ticketItemId,
      input.assignment.benefitIdentity,
    ),
    ticketItemId: input.assignment.ticketItemId,
    showtimeId: input.showtimeId,
    runId,
    source: input.source,
    runMode: input.source === 'test_run' ? 'test' : 'live',
    attachedToTicket: input.attachedToTicket,
    benefitIdentity: input.assignment.benefitIdentity,
    benefitKind: input.assignment.benefitKind,
    benefitNameKo: input.assignment.benefitNameKo,
    state: 'active',
    assignedAt: input.assignment.assignedAt,
    redeemedAt: null,
  });
}

function exportEntitlementId(
  runId: string | null,
  ticketItemId: string,
  benefitIdentity: string,
): string {
  const hash = createHash('sha256')
    .update(`${runId ?? 'pending'}:${ticketItemId}:${benefitIdentity}`)
    .digest('hex')
    .slice(0, 12);
  return `00000000-0000-4000-8000-${hash}`;
}

function deterministicShuffle<T extends { ticketItemId: string }>(
  values: T[],
  seed: string,
): T[] {
  return [...values].sort((left, right) => {
    const leftHash = stableHash(`${seed}:${left.ticketItemId}`);
    const rightHash = stableHash(`${seed}:${right.ticketItemId}`);
    return leftHash.localeCompare(rightHash)
      || left.ticketItemId.localeCompare(right.ticketItemId);
  });
}

function buyerHasMutualExclusion(
  buyerUserId: string,
  benefit: LimitedBenefit,
  buyerWins: Map<string, Set<string>>,
  allBenefits: LimitedBenefit[],
): boolean {
  const wins = buyerWins.get(buyerUserId);
  if (!wins) {
    return false;
  }
  return [...wins].some((wonBenefitIdentity) =>
    benefitsAreMutuallyExclusive(wonBenefitIdentity, benefit.identity, allBenefits),
  );
}

function benefitsAreMutuallyExclusive(
  leftIdentity: string,
  rightIdentity: string,
  benefits: LimitedBenefit[],
): boolean {
  if (leftIdentity === rightIdentity) {
    return false;
  }
  const left = benefits.find((benefit) => benefit.identity === leftIdentity);
  const right = benefits.find((benefit) => benefit.identity === rightIdentity);
  return Boolean(
    left?.mutuallyExclusiveWith.includes(rightIdentity)
    || right?.mutuallyExclusiveWith.includes(leftIdentity),
  );
}

async function inactivateActiveLimitedEntitlements(
  db: DrizzleDB,
  showtimeId: string,
  inactiveReason: string,
  now: Date,
): Promise<void> {
  await db
    .update(ticketBenefitEntitlements)
    .set({
      state: 'inactive',
      inactiveReason,
      updatedAt: now,
    })
    .where(and(
      eq(ticketBenefitEntitlements.showtimeId, showtimeId),
      eq(ticketBenefitEntitlements.benefitKind, 'limited'),
      eq(ticketBenefitEntitlements.state, 'active'),
    ));
}

async function insertAssignmentsAsEntitlements(input: {
  db: DrizzleDB;
  showtimeId: string;
  runId: string;
  source: 'live_run' | 'rollback';
  assignments: BenefitAssignment[];
  now: Date;
}): Promise<string[]> {
  if (input.assignments.length === 0) {
    return [];
  }

  const inserted = await input.db
    .insert(ticketBenefitEntitlements)
    .values(input.assignments.map((assignment) => ({
      showtimeId: input.showtimeId,
      ticketItemId: assignment.ticketItemId,
      benefitIdentity: assignment.benefitIdentity,
      benefitKind: 'limited' as const,
      displayCopySnapshot: assignment.displayCopy,
      source: input.source,
      runId: input.runId,
      state: 'active' as const,
      inactiveReason: null,
      redeemedAt: null,
      redeemedByUserId: null,
      createdAt: input.now,
      updatedAt: input.now,
    })))
    .returning({ id: ticketBenefitEntitlements.id });

  return inserted.map((row) => row.id);
}

function configurationFromRows(
  configuration: BenefitConfigurationRow,
  benefitRows: TicketBenefitRow[],
): BenefitConfiguration {
  return {
    id: configuration.id,
    showtimeId: configuration.showtimeId,
    active: true,
    version: configuration.version,
    benefits: benefitRows.map(benefitFromRow),
    createdAt: configuration.createdAt.toISOString(),
    updatedAt: configuration.updatedAt.toISOString(),
    activatedAt: configuration.createdAt.toISOString(),
  };
}

function benefitFromRow(row: TicketBenefitRow): BenefitDefinition {
  if (row.kind === 'included') {
    return {
      identity: row.identity,
      kind: 'included',
      displayCopy: row.displayCopy as TicketBenefitDisplayCopy,
      eligibleTierNames: row.eligibleTierNames,
      mutuallyExclusiveWith: parseMutualExclusionGroup(row.mutualExclusionGroup),
    };
  }

  return {
    identity: row.identity,
    kind: 'limited',
    displayCopy: row.displayCopy as TicketBenefitDisplayCopy,
    eligibleTierNames: row.eligibleTierNames,
    quantity: row.quantity!,
    selectionPriority: row.selectionPriority!,
    mutuallyExclusiveWith: parseMutualExclusionGroup(row.mutualExclusionGroup),
  };
}

function configurationFromSnapshot(
  showtimeId: string,
  snapshot: TestBenefitRunInput['configurationSnapshot'],
  now: Date,
): BenefitConfiguration {
  if (!snapshot) {
    throw new NotFoundException('혜택 설정 snapshot을 찾을 수 없습니다');
  }

  return {
    id: snapshot.sourceConfigurationId ?? '00000000-0000-4000-8000-000000000000',
    showtimeId,
    active: true,
    version: 1,
    benefits: snapshot.benefits,
    createdAt: snapshot.capturedAt ?? now.toISOString(),
    updatedAt: snapshot.capturedAt ?? now.toISOString(),
    activatedAt: snapshot.capturedAt ?? now.toISOString(),
  };
}

function configurationFromRunRow(row: BenefitRunRow): BenefitConfiguration {
  const snapshot = row.configurationSnapshot as unknown as BenefitConfiguration;
  if (!snapshot?.benefits) {
    throw new BadRequestException('rollback source run의 설정 snapshot이 유효하지 않습니다');
  }
  return {
    ...snapshot,
    active: true,
  };
}

function configurationSnapshot(
  configuration: BenefitConfiguration,
  capturedAt: Date,
): Record<string, unknown> {
  return {
    ...configuration,
    active: false,
    sourceConfigurationId: configuration.id,
    capturedAt: capturedAt.toISOString(),
  } as unknown as Record<string, unknown>;
}

function rowToRunRecord(row: BenefitRunRow): BenefitRunRecordWithSummary {
  return buildRunRecord({
    id: row.id,
    showtimeId: row.showtimeId,
    mode: row.mode,
    configuration: configurationFromRunRow(row),
    seedRef: row.seedRef,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resultSummary: normalizeResultSummary(row.resultSummary),
  });
}

function buildRunRecord(input: {
  id: string;
  showtimeId: string;
  mode: 'live' | 'test';
  configuration: BenefitConfiguration;
  seedRef: string;
  operatorProvidedSeedRef?: string;
  actorUserId: string;
  createdAt: Date;
  updatedAt: Date;
  resultSummary: BenefitRunResultSummary;
}): BenefitRunRecordWithSummary {
  const base = benefitRunRecordSchema.parse({
    id: input.id,
    showtimeId: input.showtimeId,
    configurationId: input.configuration.id,
    mode: input.mode,
    attachedToTicket: input.mode === 'live',
    redactedSeedRef: input.seedRef,
    operatorProvidedSeedRef: input.mode === 'test'
      ? input.operatorProvidedSeedRef
      : undefined,
    configurationSnapshot: input.mode === 'test'
      ? {
        active: false,
        sourceConfigurationId: input.configuration.id,
        capturedAt: input.createdAt.toISOString(),
        benefits: input.configuration.benefits,
      }
      : undefined,
    entitlementCount: input.resultSummary.totalAssignedCount,
    createdByUserId: input.actorUserId,
    startedAt: input.createdAt.toISOString(),
    completedAt: input.updatedAt.toISOString(),
  });

  return {
    ...base,
    resultSummary: input.resultSummary,
  };
}

function normalizeResultSummary(value: unknown): BenefitRunResultSummary {
  const summary = value as Partial<BenefitRunResultSummary> | null;
  return {
    version: RESULT_SUMMARY_VERSION,
    seedRef: String(summary?.seedRef ?? 'seed_***_unknown'),
    sourceRunId: summary?.sourceRunId,
    assignments: (summary?.assignments ?? []) as BenefitAssignment[],
    benefits: (summary?.benefits ?? []) as BenefitSelectionSummary[],
    exportRows: (summary?.exportRows ?? []) as BenefitEntitlementExportRow[],
    totalAssignedCount: Number(summary?.totalAssignedCount ?? 0),
    totalShortfallCount: Number(summary?.totalShortfallCount ?? 0),
    skippedInactiveTicketItemCount: summary?.skippedInactiveTicketItemCount,
  };
}

function executeRows<T extends Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  const rows = (value as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function normalizeOptionalReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}

function entitlementRowToExportRow(row: BenefitEntitlementRow): BenefitEntitlementExportRow {
  const base = {
    benefitEntitlementId: row.id,
    ticketItemId: row.ticketItemId,
    showtimeId: row.showtimeId,
    runId: row.runId,
    source: row.source,
    benefitIdentity: row.benefitIdentity,
    benefitKind: row.benefitKind,
    benefitNameKo: row.displayCopySnapshot.ko.name,
    state: row.state,
    assignedAt: row.createdAt.toISOString(),
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
  };

  if (row.source === 'configuration') {
    return benefitEntitlementExportRowSchema.parse({
      ...base,
      runId: null,
      benefitKind: 'included',
      attachedToTicket: true,
    });
  }

  return benefitEntitlementExportRowSchema.parse({
    ...base,
    runMode: row.source === 'test_run' ? 'test' : 'live',
    attachedToTicket: row.source !== 'test_run',
  });
}

function entitlementExportHeader(): string[] {
  return [
    'Benefit Entitlement ID',
    'Ticket Item ID',
    'Showtime ID',
    'Run ID',
    'Source',
    'Run Mode',
    'Attached To Ticket',
    'Benefit Identity',
    'Benefit Kind',
    'Benefit Name Ko',
    'State',
    'Assigned At',
    'Redeemed At',
  ];
}

function entitlementExportRowToCsvValues(row: BenefitEntitlementExportRow): unknown[] {
  const rowWithMetadata = row as BenefitEntitlementExportRow & {
    source?: string;
    runMode?: string;
  };
  return [
    row.benefitEntitlementId,
    row.ticketItemId,
    row.showtimeId,
    row.runId,
    rowWithMetadata.source ?? '',
    rowWithMetadata.runMode ?? '',
    row.attachedToTicket,
    row.benefitIdentity,
    row.benefitKind,
    row.benefitNameKo,
    row.state,
    row.assignedAt,
    row.redeemedAt ?? '',
  ];
}

function parseMutualExclusionGroup(group: string | null): string[] {
  return group?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
}

function redactedSeedRef(seed: string): string {
  return `seed_***_${stableHash(seed).slice(0, 12)}`;
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateInternalSeed(): string {
  return randomBytes(32).toString('hex');
}
