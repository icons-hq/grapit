import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  benefitConfigurationChangeRecordSchema,
  benefitConfigurationExportRowSchema,
  benefitDefinitionWriteListSchema,
  type BenefitConfiguration,
  type BenefitConfigurationChangeRecord,
  type BenefitConfigurationExportRow,
  type BenefitDefinition,
  type BenefitOperationState,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  ticketBenefitConfigurationChanges,
  ticketBenefitConfigurations,
  ticketBenefitEntitlements,
  ticketBenefitRedemptionRecords,
  ticketBenefits,
  ticketItems,
  showtimes,
} from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';
import { safeCsvRows, withUtf8Bom } from './csv-export.util.js';

const CONTENT_TYPE = 'text/csv; charset=utf-8' as const;
/**
 * Benefit writers hold the showtime row in FOR NO KEY UPDATE, which blocks ticket
 * issuance (FOR SHARE) for the same showtime. Fail fast instead of queueing behind
 * busy confirms, and cap how long a single statement may keep the lock.
 */
export const BENEFIT_MUTATION_LOCK_TIMEOUT = '3s';
export const BENEFIT_MUTATION_STATEMENT_TIMEOUT = '30s';
const PG_LOCK_NOT_AVAILABLE = '55P03';
const PG_QUERY_CANCELED = '57014';
const benefitSaveInputSchema = z
  .object({
    benefits: benefitDefinitionWriteListSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type BenefitSaveInput = z.infer<typeof benefitSaveInputSchema>;
type BenefitConfigurationRow = typeof ticketBenefitConfigurations.$inferSelect;
type TicketBenefitRow = typeof ticketBenefits.$inferSelect;
type BenefitMutationDb = DrizzleDB & Pick<DrizzleDB, 'execute'>;

export interface AdminBenefitOperationContext {
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AdminBenefitExportActor {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AdminBenefitExportResult {
  filename: string;
  contentType: typeof CONTENT_TYPE;
  csv: string;
  rowCount: number;
  generatedAt: string;
}

export interface AdminBenefitUnsavedTestSnapshot {
  active: false;
  sourceConfigurationId: string | null;
  capturedAt: string;
  benefits: BenefitDefinition[];
}

@Injectable()
export class AdminBenefitsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async getConfiguration(showtimeId: string): Promise<BenefitConfiguration | null> {
    return this.loadActiveConfiguration(this.db, showtimeId);
  }

  async getOperationState(showtimeId: string): Promise<BenefitOperationState> {
    const [showtime] = await this.db.select({ id: showtimes.id }).from(showtimes).where(eq(showtimes.id, showtimeId));
    if (!showtime) throw new NotFoundException('회차를 찾을 수 없습니다.');
    const [[summary], history] = await Promise.all([
      this.db.select({ lockedAt: sql<string | null>`min(${ticketBenefitRedemptionRecords.createdAt})::text`,
        redeemedCount: sql<number>`count(*) filter (where ${ticketBenefitRedemptionRecords.result} = 'redeemed')::int` })
        .from(ticketBenefitRedemptionRecords).where(eq(ticketBenefitRedemptionRecords.showtimeId, showtimeId)),
      this.db.select({ id: ticketBenefitRedemptionRecords.id, seatKey: ticketItems.seatKey,
        copy: ticketBenefitEntitlements.displayCopySnapshot, result: ticketBenefitRedemptionRecords.result,
        createdAt: ticketBenefitRedemptionRecords.createdAt })
        .from(ticketBenefitRedemptionRecords)
        .innerJoin(ticketItems, eq(ticketItems.id, ticketBenefitRedemptionRecords.ticketItemId))
        .innerJoin(ticketBenefitEntitlements, eq(ticketBenefitEntitlements.id, ticketBenefitRedemptionRecords.benefitEntitlementId))
        .where(eq(ticketBenefitRedemptionRecords.showtimeId, showtimeId)).orderBy(desc(ticketBenefitRedemptionRecords.createdAt)).limit(20),
    ]);
    return { showtimeId, resultLockedAt: summary?.lockedAt ? new Date(summary.lockedAt).toISOString() : null,
      redeemedCount: summary?.redeemedCount ?? 0,
      history: history.map((entry) => ({ id: entry.id, seatKey: entry.seatKey, benefitName: entry.copy.ko.name,
        result: entry.result, createdAt: entry.createdAt.toISOString() })) };
  }

  async saveConfiguration(
    showtimeId: string,
    actorUserId: string,
    input: BenefitSaveInput,
    context: AdminBenefitOperationContext = {},
  ): Promise<BenefitConfiguration> {
    const parsed = benefitSaveInputSchema.parse(input);
    const now = context.now ?? new Date();
    const reason = parsed.reason?.trim() ?? null;

    return this.db.transaction(async (tx) => {
      await this.lockShowtimeForBenefitMutation(tx as BenefitMutationDb, showtimeId);
      await this.assertBenefitResultUnlocked(tx as DrizzleDB, showtimeId);

      const before = await this.loadActiveConfiguration(tx as DrizzleDB, showtimeId);
      const version = (before?.version ?? 0) + 1;
      const [configuration] = await tx
        .insert(ticketBenefitConfigurations)
        .values({
          showtimeId,
          version,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: ticketBenefitConfigurations.id,
          createdAt: ticketBenefitConfigurations.createdAt,
          updatedAt: ticketBenefitConfigurations.updatedAt,
        });
      if (!configuration) {
        throw new InternalServerErrorException(
          '혜택 설정 저장 결과를 확인할 수 없습니다',
        );
      }

      const configurationId = configuration.id;
      const createdAt = configuration.createdAt;
      const updatedAt = configuration.updatedAt;

      await tx
        .insert(ticketBenefits)
        .values(parsed.benefits.map((benefit) =>
          benefitToInsertRow(configurationId, benefit, now),
        ));

      const after: BenefitConfiguration = {
        id: configurationId,
        showtimeId,
        active: true,
        version,
        benefits: parsed.benefits,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        activatedAt: createdAt.toISOString(),
      };

      await tx
        .insert(ticketBenefitConfigurationChanges)
        .values({
          showtimeId,
          configurationId,
          action: before ? 'updated' : 'created',
          actorUserId,
          reason,
          beforeSnapshot: jsonSnapshot(before),
          afterSnapshot: jsonSnapshot(after),
          changedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: ticketBenefitConfigurationChanges.id });

      await this.adminAuditService.write(
        {
          actorUserId,
          action: 'benefits.configuration.update',
          resourceType: 'benefit_configuration',
          resourceId: configurationId,
          status: 'success',
          reason,
          changedFields: ['benefits', 'version'],
          before: jsonSnapshot(before),
          after: jsonSnapshot(after),
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
        tx,
      );

      await this.syncIncludedEntitlementsForShowtime(showtimeId, {
        db: tx as DrizzleDB,
        benefits: parsed.benefits,
        now,
      });

      return after;
    }).catch((error: unknown) => {
      throw translateBenefitMutationDbError(error);
    });
  }

  async listConfigurationChanges(
    showtimeId: string,
    limit = 50,
  ): Promise<BenefitConfigurationChangeRecord[]> {
    const rows = await this.db
      .select({
        id: ticketBenefitConfigurationChanges.id,
        showtimeId: ticketBenefitConfigurationChanges.showtimeId,
        configurationId: ticketBenefitConfigurationChanges.configurationId,
        action: ticketBenefitConfigurationChanges.action,
        actorUserId: ticketBenefitConfigurationChanges.actorUserId,
        reason: ticketBenefitConfigurationChanges.reason,
        beforeSnapshot: ticketBenefitConfigurationChanges.beforeSnapshot,
        afterSnapshot: ticketBenefitConfigurationChanges.afterSnapshot,
        changedAt: ticketBenefitConfigurationChanges.changedAt,
      })
      .from(ticketBenefitConfigurationChanges)
      .where(eq(ticketBenefitConfigurationChanges.showtimeId, showtimeId))
      .orderBy(desc(ticketBenefitConfigurationChanges.changedAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows.map((row) =>
      benefitConfigurationChangeRecordSchema.parse({
        id: row.id,
        showtimeId: row.showtimeId,
        configurationId: row.configurationId,
        action: row.action,
        actorUserId: row.actorUserId,
        reason: row.reason,
        changedAt: row.changedAt.toISOString(),
        before: row.beforeSnapshot ?? null,
        after: row.afterSnapshot ?? null,
      }),
    );
  }

  async buildUnsavedTestSnapshot(
    showtimeId: string,
    input: BenefitSaveInput,
    context: Pick<AdminBenefitOperationContext, 'now'> = {},
  ): Promise<AdminBenefitUnsavedTestSnapshot> {
    const parsed = benefitSaveInputSchema.parse(input);
    const activeConfiguration = await this.loadActiveConfiguration(this.db, showtimeId);
    const now = context.now ?? new Date();

    return {
      active: false,
      sourceConfigurationId: activeConfiguration?.id ?? null,
      capturedAt: now.toISOString(),
      benefits: parsed.benefits,
    };
  }

  /**
   * Converges configuration-sourced included entitlements of a showtime to the
   * given benefits with three set-based statements. The work stays constant in
   * round-trips no matter how many tickets were sold, and no per-row bind
   * parameters are sent, so large showtimes neither hold the showtime lock for
   * long nor exceed the PostgreSQL bind parameter limit.
   * At most one active row per (ticket item, identity) is guaranteed by
   * idx_tbe_active_config_included_item_identity (migration 0033).
   */
  async syncIncludedEntitlementsForShowtime(
    showtimeId: string,
    options: {
      db?: DrizzleDB;
      benefits?: BenefitDefinition[];
      now?: Date;
    } = {},
  ): Promise<{ createdCount: number; inactivatedCount: number }> {
    const db = (options.db ?? this.db) as BenefitMutationDb;
    const now = (options.now ?? new Date()).toISOString();
    const benefits = options.benefits
      ?? (await this.loadActiveConfiguration(db, showtimeId))?.benefits
      ?? [];
    const includedBenefits = benefits.filter((benefit) => benefit.kind === 'included');
    // {"<identity>": {"tiers": [...], "copy": {...}}}. Existing rows are matched by
    // ticket item primary key and an identity lookup in this single parameter, so
    // the plan stays linear without relying on table statistics.
    const byIdentity = JSON.stringify(Object.fromEntries(includedBenefits.map((benefit) => [
      benefit.identity,
      { tiers: benefit.eligibleTierNames, copy: benefit.displayCopy },
    ])));
    const desiredCopy = sql`(${byIdentity}::jsonb -> e.benefit_identity::text -> 'copy')`;

    const inactivatedCount = countFromRows(await db.execute(sql`
      WITH changed AS (
        UPDATE ticket_benefit_entitlements e
        SET state = 'inactive', inactive_reason = 'configuration_changed', updated_at = ${now}::timestamptz
        FROM ticket_items ti
        WHERE ti.id = e.ticket_item_id
          AND e.showtime_id = ${showtimeId}
          AND e.source = 'configuration'
          AND e.benefit_kind = 'included'
          AND e.state = 'active'
          AND NOT (
            ti.showtime_id = e.showtime_id
            AND ti.status = 'active'
            AND coalesce(${byIdentity}::jsonb -> e.benefit_identity::text -> 'tiers', '[]'::jsonb) ? ti.tier_name
          )
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM changed
    `));

    if (includedBenefits.length === 0) {
      return { createdCount: 0, inactivatedCount };
    }

    // Every row still active here passed the eligibility check above in this
    // transaction, and the showtime lock keeps ticket issuance out until commit.
    await db.execute(sql`
      UPDATE ticket_benefit_entitlements e
      SET display_copy_snapshot = ${desiredCopy}, inactive_reason = NULL, updated_at = ${now}::timestamptz
      WHERE e.showtime_id = ${showtimeId}
        AND e.source = 'configuration'
        AND e.benefit_kind = 'included'
        AND e.state = 'active'
        AND ${byIdentity}::jsonb ? e.benefit_identity::text
        AND (e.display_copy_snapshot IS DISTINCT FROM ${desiredCopy} OR e.inactive_reason IS NOT NULL)
    `);

    const createdCount = countFromRows(await db.execute(sql`
      WITH inserted AS (
        INSERT INTO ticket_benefit_entitlements (
          showtime_id, ticket_item_id, benefit_identity, benefit_kind, display_copy_snapshot,
          source, run_id, state, inactive_reason, redeemed_at, redeemed_by_user_id, created_at, updated_at
        )
        SELECT ti.showtime_id, ti.id, d.key, 'included'::ticket_benefit_kind, d.value -> 'copy',
          'configuration'::ticket_benefit_entitlement_source, NULL, 'active'::ticket_benefit_entitlement_state,
          NULL, NULL, NULL, ${now}::timestamptz, ${now}::timestamptz
        FROM ticket_items ti
        CROSS JOIN jsonb_each(${byIdentity}::jsonb) AS d
        WHERE ti.showtime_id = ${showtimeId}
          AND ti.status = 'active'
          AND d.value -> 'tiers' ? ti.tier_name
        ORDER BY ti.id, d.key
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM inserted
    `));

    return { createdCount, inactivatedCount };
  }

  async exportConfiguration(
    showtimeId: string,
    actor: AdminBenefitExportActor,
    context: Pick<AdminBenefitOperationContext, 'now'> = {},
  ): Promise<AdminBenefitExportResult> {
    const configuration = await this.loadActiveConfiguration(this.db, showtimeId);
    if (!configuration) {
      throw new NotFoundException('혜택 설정을 찾을 수 없습니다');
    }

    const now = context.now ?? new Date();
    const generatedAt = now.toISOString();
    const rows = configuration.benefits.map((benefit) =>
      benefitConfigurationExportRowSchema.parse(
        benefitToExportRow(configuration, benefit, generatedAt),
      ),
    );
    const csv = withUtf8Bom(safeCsvRows([
      [
        'Configuration ID',
        'Showtime ID',
        'Active',
        'Version',
        'Benefit Identity',
        'Benefit Kind',
        'Benefit Name Ko',
        'Eligible Tier Names',
        'Quantity',
        'Selection Priority',
        'Mutually Exclusive With',
        'Exported At',
      ],
      ...rows.map((row) => exportRowToCsvValues(row)),
    ]));

    await this.adminAuditService.write(
      {
        actorUserId: actor.actorUserId,
        action: 'benefits.configuration.export',
        resourceType: 'benefit_configuration',
        resourceId: configuration.id,
        status: 'success',
        reason: null,
        changedFields: ['showtimeId', 'configurationId', 'rowCount'],
        before: {},
        after: {
          showtimeId,
          configurationId: configuration.id,
          rowCount: rows.length,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      this.db,
    );

    return {
      filename: benefitConfigurationFilename(showtimeId, generatedAt),
      contentType: CONTENT_TYPE,
      csv,
      rowCount: rows.length,
      generatedAt,
    };
  }

  private async assertBenefitResultUnlocked(
    db: DrizzleDB,
    showtimeId: string,
  ): Promise<void> {
    const [redemption] = await db
      .select({ id: ticketBenefitRedemptionRecords.id })
      .from(ticketBenefitRedemptionRecords)
      .where(eq(ticketBenefitRedemptionRecords.showtimeId, showtimeId))
      .limit(1);

    if (redemption) {
      throw new ConflictException('Benefit Result Lock 이후에는 혜택 설정을 변경할 수 없습니다');
    }
  }

  async assertBenefitResultUnlockedForMutation(
    db: DrizzleDB,
    showtimeId: string,
  ): Promise<void> {
    await this.assertBenefitResultUnlocked(db, showtimeId);
  }

  /**
   * Call first inside the mutation transaction. Callers must pass the rejected
   * transaction promise through translateBenefitMutationDbError.
   */
  async lockShowtimeForBenefitMutation(
    db: BenefitMutationDb,
    showtimeId: string,
  ): Promise<void> {
    await db.execute(sql`
      SELECT set_config('lock_timeout', ${BENEFIT_MUTATION_LOCK_TIMEOUT}, true),
        set_config('statement_timeout', ${BENEFIT_MUTATION_STATEMENT_TIMEOUT}, true)
    `);
    const result = await db.execute(sql`
      SELECT id
      FROM showtimes
      WHERE id = ${showtimeId}
      FOR NO KEY UPDATE
    `);

    if (Array.isArray(result) && result.length === 0) {
      throw new NotFoundException('회차를 찾을 수 없습니다');
    }

    if ('rows' in result && Array.isArray(result.rows) && result.rows.length === 0) {
      throw new NotFoundException('회차를 찾을 수 없습니다');
    }
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
      displayCopy: row.displayCopy as BenefitDefinition['displayCopy'],
      eligibleTierNames: row.eligibleTierNames,
      mutuallyExclusiveWith: parseMutualExclusionGroup(row.mutualExclusionGroup),
    };
  }

  return {
    identity: row.identity,
    kind: 'limited',
    displayCopy: row.displayCopy as BenefitDefinition['displayCopy'],
    eligibleTierNames: row.eligibleTierNames,
    quantity: row.quantity!,
    selectionPriority: row.selectionPriority!,
    mutuallyExclusiveWith: parseMutualExclusionGroup(row.mutualExclusionGroup),
  };
}

function benefitToInsertRow(
  configurationId: string,
  benefit: BenefitDefinition,
  now: Date,
) {
  return {
    configurationId,
    identity: benefit.identity,
    kind: benefit.kind,
    displayCopy: benefit.displayCopy,
    eligibleTierNames: benefit.eligibleTierNames,
    quantity: benefit.kind === 'limited' ? benefit.quantity : null,
    selectionPriority: benefit.kind === 'limited' ? benefit.selectionPriority : null,
    mutualExclusionGroup: benefit.mutuallyExclusiveWith.join(',') || null,
    createdAt: now,
    updatedAt: now,
  };
}

function benefitToExportRow(
  configuration: BenefitConfiguration,
  benefit: BenefitDefinition,
  exportedAt: string,
): BenefitConfigurationExportRow {
  const base = {
    configurationId: configuration.id,
    showtimeId: configuration.showtimeId,
    active: configuration.active,
    version: configuration.version,
    benefitIdentity: benefit.identity,
    benefitNameKo: benefit.displayCopy.ko.name,
    eligibleTierNames: benefit.eligibleTierNames,
    mutuallyExclusiveWith: benefit.mutuallyExclusiveWith,
    exportedAt,
  };

  if (benefit.kind === 'included') {
    return {
      ...base,
      benefitKind: 'included',
    };
  }

  return {
    ...base,
    benefitKind: 'limited',
    quantity: benefit.quantity,
    selectionPriority: benefit.selectionPriority,
  };
}

function exportRowToCsvValues(row: BenefitConfigurationExportRow): unknown[] {
  return [
    row.configurationId,
    row.showtimeId,
    row.active,
    row.version,
    row.benefitIdentity,
    row.benefitKind,
    row.benefitNameKo,
    row.eligibleTierNames.join('|'),
    row.benefitKind === 'limited' ? row.quantity : '',
    row.benefitKind === 'limited' ? row.selectionPriority : '',
    row.mutuallyExclusiveWith.join('|'),
    row.exportedAt,
  ];
}

function benefitConfigurationFilename(showtimeId: string, generatedAt: string): string {
  return `benefit-configuration-${showtimeId}-${generatedAt.slice(0, 10)}.csv`;
}

function parseMutualExclusionGroup(group: string | null): string[] {
  return group?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
}

function countFromRows(result: unknown): number {
  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] } | null)?.rows ?? [];
  const [row] = rows as Array<{ count?: unknown }>;
  return Number(row?.count ?? 0);
}

/**
 * Maps lock and statement timeouts of benefit mutation transactions to
 * operator-facing errors. Other errors pass through unchanged.
 */
export function translateBenefitMutationDbError(error: unknown): unknown {
  const code = postgresErrorCode(error);
  if (code === PG_LOCK_NOT_AVAILABLE) {
    return new ConflictException(
      '같은 회차의 결제·현장 처리와 겹쳐 특전 작업을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
    );
  }
  if (code === PG_QUERY_CANCELED) {
    return new ServiceUnavailableException(
      '특전 작업이 제한 시간을 넘어 취소되었습니다. 판매가 한산한 시간에 다시 시도해주세요.',
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

function jsonSnapshot(
  value: BenefitConfiguration | null,
): Record<string, unknown> | null {
  return value as Record<string, unknown> | null;
}
