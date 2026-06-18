import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  benefitConfigurationChangeRecordSchema,
  benefitConfigurationExportRowSchema,
  benefitDefinitionSchema,
  type BenefitConfiguration,
  type BenefitConfigurationChangeRecord,
  type BenefitConfigurationExportRow,
  type BenefitDefinition,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  ticketBenefitConfigurationChanges,
  ticketBenefitConfigurations,
  ticketBenefitEntitlements,
  ticketBenefitRedemptionRecords,
  ticketBenefits,
  ticketItems,
} from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';
import { safeCsvRows, withUtf8Bom } from './csv-export.util.js';

const CONTENT_TYPE = 'text/csv; charset=utf-8' as const;
const benefitSaveInputSchema = z
  .object({
    benefits: z.array(benefitDefinitionSchema).min(1),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type BenefitSaveInput = z.infer<typeof benefitSaveInputSchema>;
type BenefitConfigurationRow = typeof ticketBenefitConfigurations.$inferSelect;
type TicketBenefitRow = typeof ticketBenefits.$inferSelect;
type TicketItemBenefitCandidate = Pick<
  typeof ticketItems.$inferSelect,
  'id' | 'tierName'
>;
type ActiveIncludedEntitlement = Pick<
  typeof ticketBenefitEntitlements.$inferSelect,
  'id' | 'ticketItemId' | 'benefitIdentity'
>;
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

  async syncIncludedEntitlementsForShowtime(
    showtimeId: string,
    options: {
      db?: DrizzleDB;
      benefits?: BenefitDefinition[];
      now?: Date;
    } = {},
  ): Promise<{ createdCount: number; inactivatedCount: number }> {
    const db = options.db ?? this.db;
    const now = options.now ?? new Date();
    const benefits = options.benefits
      ?? (await this.loadActiveConfiguration(db, showtimeId))?.benefits
      ?? [];
    const includedBenefits = benefits.filter((benefit) => benefit.kind === 'included');

    const ticketRows = await db
      .select({
        id: ticketItems.id,
        tierName: ticketItems.tierName,
      })
      .from(ticketItems)
      .where(and(
        eq(ticketItems.showtimeId, showtimeId),
        eq(ticketItems.status, 'active'),
      ));
    const activeTicketItems = ticketRows as TicketItemBenefitCandidate[];

    const entitlementRows = await db
      .select({
        id: ticketBenefitEntitlements.id,
        ticketItemId: ticketBenefitEntitlements.ticketItemId,
        benefitIdentity: ticketBenefitEntitlements.benefitIdentity,
      })
      .from(ticketBenefitEntitlements)
      .where(and(
        eq(ticketBenefitEntitlements.showtimeId, showtimeId),
        eq(ticketBenefitEntitlements.source, 'configuration'),
        eq(ticketBenefitEntitlements.benefitKind, 'included'),
        eq(ticketBenefitEntitlements.state, 'active'),
      ));
    const activeEntitlements = entitlementRows as ActiveIncludedEntitlement[];

    const existingByKey = groupEntitlementsByKey(activeEntitlements);
    const desired = new Map<string, {
      ticketItemId: string;
      benefit: Extract<BenefitDefinition, { kind: 'included' }>;
    }>();

    for (const benefit of includedBenefits) {
      const eligibleTierNames = new Set(benefit.eligibleTierNames);
      for (const ticketItem of activeTicketItems) {
        if (!eligibleTierNames.has(ticketItem.tierName)) {
          continue;
        }
        desired.set(entitlementKey(ticketItem.id, benefit.identity), {
          ticketItemId: ticketItem.id,
          benefit,
        });
      }
    }

    const toInsert = [...desired.entries()]
      .filter(([key]) => !existingByKey.has(key))
      .map(([, desiredEntitlement]) => ({
        showtimeId,
        ticketItemId: desiredEntitlement.ticketItemId,
        benefitIdentity: desiredEntitlement.benefit.identity,
        benefitKind: 'included' as const,
        displayCopySnapshot: desiredEntitlement.benefit.displayCopy,
        source: 'configuration' as const,
        runId: null,
        state: 'active' as const,
        inactiveReason: null,
        redeemedAt: null,
        redeemedByUserId: null,
        createdAt: now,
        updatedAt: now,
      }));
    let createdCount = 0;
    if (toInsert.length > 0) {
      const insertedEntitlements = await db
        .insert(ticketBenefitEntitlements)
        .values(toInsert)
        .onConflictDoNothing()
        .returning({ id: ticketBenefitEntitlements.id });
      createdCount = insertedEntitlements.length;
    }

    for (const [key, desiredEntitlement] of desired.entries()) {
      const [existing] = existingByKey.get(key) ?? [];
      if (!existing) {
        continue;
      }
      await db
        .update(ticketBenefitEntitlements)
        .set({
          displayCopySnapshot: desiredEntitlement.benefit.displayCopy,
          inactiveReason: null,
          updatedAt: now,
        })
        .where(eq(ticketBenefitEntitlements.id, existing.id));
    }

    const duplicateIds: string[] = [];
    const configurationChangedIds: string[] = [];
    for (const [key, entitlements] of existingByKey.entries()) {
      if (desired.has(key)) {
        duplicateIds.push(...entitlements.slice(1).map((entitlement) => entitlement.id));
      } else {
        configurationChangedIds.push(...entitlements.map((entitlement) => entitlement.id));
      }
    }

    if (duplicateIds.length > 0) {
      await db
        .update(ticketBenefitEntitlements)
        .set({
          state: 'inactive',
          inactiveReason: 'duplicate_configuration_entitlement',
          updatedAt: now,
        })
        .where(inArray(ticketBenefitEntitlements.id, duplicateIds));
    }
    if (configurationChangedIds.length > 0) {
      await db
        .update(ticketBenefitEntitlements)
        .set({
          state: 'inactive',
          inactiveReason: 'configuration_changed',
          updatedAt: now,
        })
        .where(inArray(ticketBenefitEntitlements.id, configurationChangedIds));
    }

    return {
      createdCount,
      inactivatedCount: duplicateIds.length + configurationChangedIds.length,
    };
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

  async lockShowtimeForBenefitMutation(
    db: BenefitMutationDb,
    showtimeId: string,
  ): Promise<void> {
    const result = await db.execute(sql`
      SELECT id
      FROM showtimes
      WHERE id = ${showtimeId}
      FOR UPDATE
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

function groupEntitlementsByKey(
  entitlements: ActiveIncludedEntitlement[],
): Map<string, ActiveIncludedEntitlement[]> {
  const byKey = new Map<string, ActiveIncludedEntitlement[]>();

  for (const entitlement of entitlements) {
    const key = entitlementKey(entitlement.ticketItemId, entitlement.benefitIdentity);
    const group = byKey.get(key) ?? [];
    group.push(entitlement);
    byKey.set(key, group);
  }

  return byKey;
}

function entitlementKey(ticketItemId: string, benefitIdentity: string): string {
  return `${ticketItemId}:${benefitIdentity}`;
}

function jsonSnapshot(
  value: BenefitConfiguration | null,
): Record<string, unknown> | null {
  return value as Record<string, unknown> | null;
}
