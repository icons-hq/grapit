import { getTableColumns } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as schemaBarrel from './index.js';
import {
  ticketBenefitConfigurationChanges,
  ticketBenefitConfigurations,
  ticketBenefitEntitlements,
  ticketBenefitRedemptionRecords,
  ticketBenefitRuns,
  ticketBenefits,
  ticketBenefitKindEnum,
  ticketBenefitRunModeEnum,
} from './ticket-benefits';

const migrationPath = resolve(
  __dirname,
  '../migrations/0029_ticket_benefits.sql',
);

function readMigration() {
  return readFileSync(migrationPath, 'utf8');
}

function readSchemaSource() {
  return readFileSync(resolve(__dirname, 'ticket-benefits.ts'), 'utf8');
}

function expectColumnName(column: { name: string } | undefined, name: string) {
  expect(column?.name).toBe(name);
}

function createTableBlock(migration: string, tableName: string) {
  const match = migration.match(
    new RegExp(`CREATE TABLE "${tableName}" \\([\\s\\S]*?\\n\\);`),
  );

  expect(match?.[0]).toBeDefined();

  return match?.[0] ?? '';
}

describe('ticket benefit schema contracts', () => {
  it('commits migration 0029 and creates all benefit tables', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = readMigration();
    const tableNames = [
      'ticket_benefit_configurations',
      'ticket_benefit_configuration_changes',
      'ticket_benefits',
      'ticket_benefit_runs',
      'ticket_benefit_entitlements',
      'ticket_benefit_redemption_records',
    ];

    for (const tableName of tableNames) {
      expect(migration).toContain(`CREATE TABLE "${tableName}"`);
    }
  });

  it('keeps migration 0029 free of destructive DML', () => {
    const migration = readMigration();

    const dmlStatements = migration
      .split('--> statement-breakpoint')
      .map((statement) =>
        statement
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((statement) =>
        /^(insert|update|delete|truncate)\b/i.test(statement),
      );

    expect(dmlStatements).toEqual([]);
  });

  it('exports benefit tables and enums through the schema barrel', () => {
    expect(schemaBarrel).toHaveProperty('ticketBenefitConfigurations');
    expect(schemaBarrel).toHaveProperty('ticketBenefitConfigurationChanges');
    expect(schemaBarrel).toHaveProperty('ticketBenefits');
    expect(schemaBarrel).toHaveProperty('ticketBenefitRuns');
    expect(schemaBarrel).toHaveProperty('ticketBenefitEntitlements');
    expect(schemaBarrel).toHaveProperty('ticketBenefitRedemptionRecords');
    expect(schemaBarrel).toHaveProperty('ticketBenefitKindEnum');
    expect(schemaBarrel).toHaveProperty('ticketBenefitRunModeEnum');

    expect(ticketBenefitKindEnum.enumValues).toEqual(['included', 'limited']);
    expect(ticketBenefitRunModeEnum.enumValues).toEqual(['live', 'test']);
  });

  it('defines the required ticket benefit columns in Drizzle schema', () => {
    expectColumnName(
      getTableColumns(ticketBenefitConfigurations).showtimeId,
      'showtime_id',
    );
    expectColumnName(
      getTableColumns(ticketBenefitConfigurations).version,
      'version',
    );
    expectColumnName(
      getTableColumns(ticketBenefitConfigurations).createdByUserId,
      'created_by_user_id',
    );
    expectColumnName(
      getTableColumns(ticketBenefitConfigurations).updatedByUserId,
      'updated_by_user_id',
    );

    expectColumnName(
      getTableColumns(ticketBenefitConfigurationChanges).showtimeId,
      'showtime_id',
    );
    expectColumnName(
      getTableColumns(ticketBenefits).configurationId,
      'configuration_id',
    );
    expectColumnName(getTableColumns(ticketBenefits).identity, 'identity');
    expectColumnName(getTableColumns(ticketBenefits).kind, 'kind');
    expectColumnName(
      getTableColumns(ticketBenefits).displayCopy,
      'display_copy',
    );
    expectColumnName(
      getTableColumns(ticketBenefits).eligibleTierNames,
      'eligible_tier_names',
    );
    expectColumnName(getTableColumns(ticketBenefits).quantity, 'quantity');
    expectColumnName(
      getTableColumns(ticketBenefits).selectionPriority,
      'selection_priority',
    );
    expectColumnName(
      getTableColumns(ticketBenefits).mutualExclusionGroup,
      'mutual_exclusion_group',
    );
  });

  it('references ticket_items from ticket benefit entitlements', () => {
    const migration = readMigration();
    const columns = getTableColumns(ticketBenefitEntitlements);

    expectColumnName(columns.ticketItemId, 'ticket_item_id');
    expect(migration).toContain(
      'ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "ticket_benefit_entitlements_ticket_item_id_ticket_items_id_fk" FOREIGN KEY ("ticket_item_id") REFERENCES "public"."ticket_items"("id") ON DELETE restrict ON UPDATE no action;',
    );
  });

  it('stores redacted QR references for benefit redemptions without raw token columns', () => {
    const migration = readMigration();
    const schemaSource = readSchemaSource();
    const redemptionTable = createTableBlock(
      migration,
      'ticket_benefit_redemption_records',
    );
    const columns = getTableColumns(ticketBenefitRedemptionRecords);

    expectColumnName(columns.redactedTokenRef, 'redacted_token_ref');
    expect(redemptionTable).toContain('"redacted_token_ref" varchar(160) NOT NULL');
    expect(migration).toContain(
      'COMMENT ON COLUMN "ticket_benefit_redemption_records"."redacted_token_ref"',
    );
    expect(redemptionTable).not.toMatch(
      /"(raw_token|raw_qr_token|raw_qr_url|raw_payload|qr_token|qr_url|cookie|authorization_header|auth_header|secret)"/i,
    );
    expect(schemaSource).not.toMatch(
      /\b(rawToken|rawQrToken|rawQrUrl|rawPayload|qrToken|qrUrl|cookie|authorizationHeader|authHeader)\b/,
    );
  });

  it('stores benefit run mode, status, snapshots, and seed evidence separately', () => {
    const migration = readMigration();
    const runTable = createTableBlock(migration, 'ticket_benefit_runs');
    const columns = getTableColumns(ticketBenefitRuns);

    expectColumnName(columns.showtimeId, 'showtime_id');
    expectColumnName(columns.mode, 'mode');
    expectColumnName(columns.status, 'status');
    expectColumnName(columns.configurationSnapshot, 'configuration_snapshot');
    expectColumnName(columns.seedRef, 'seed_ref');
    expectColumnName(columns.randomSeedInternal, 'random_seed_internal');
    expectColumnName(columns.resultSummary, 'result_summary');
    expectColumnName(columns.actorUserId, 'actor_user_id');
    expectColumnName(columns.confirmedAt, 'confirmed_at');

    expect(runTable).toContain('"mode" "ticket_benefit_run_mode" NOT NULL');
    expect(runTable).toContain('"configuration_snapshot" jsonb NOT NULL');
    expect(runTable).toContain('"seed_ref" varchar(160)');
    expect(runTable).toContain('"random_seed_internal" varchar(256)');
  });

  it('enforces one active limited assignment per ticket item with a partial unique index', () => {
    const migration = readMigration();
    const schemaSource = readSchemaSource();

    expect(schemaSource).toContain(
      "uniqueIndex('idx_ticket_benefit_entitlements_active_limited_ticket_item')",
    );
    expect(schemaSource).toContain(
      "where(sql`${table.benefitKind} = 'limited' AND ${table.state} = 'active'`)",
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "idx_ticket_benefit_entitlements_active_limited_ticket_item" ON "ticket_benefit_entitlements" USING btree ("ticket_item_id") WHERE "ticket_benefit_entitlements"."benefit_kind" = \'limited\' AND "ticket_benefit_entitlements"."state" = \'active\';',
    );
  });

  it('allows benefit result lock to be determined from redemption records by showtime', () => {
    const migration = readMigration();
    const columns = getTableColumns(ticketBenefitRedemptionRecords);

    expectColumnName(columns.showtimeId, 'showtime_id');
    expect(migration).toContain(
      'CREATE INDEX "idx_ticket_benefit_redemption_records_showtime_entitlement_created" ON "ticket_benefit_redemption_records" USING btree ("showtime_id","benefit_entitlement_id","created_at" DESC);',
    );
    expect(migration).not.toContain('ticket_benefit_result_locks');
  });
});
