import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

type JsonRecord = Record<string, unknown>;

export const accountMergeBatchStatusEnum = pgEnum(
  'account_merge_batch_status',
  ['dry_run', 'applied', 'verified', 'failed', 'rolled_back'],
);

export const accountMergeBatches = pgTable(
  'account_merge_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    status: accountMergeBatchStatusEnum('status').notNull(),
    operatorUserId: uuid('operator_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    backupReference: varchar('backup_reference', { length: 255 }).notNull(),
    dryRunHash: varchar('dry_run_hash', { length: 128 }).notNull(),
    allowlistHash: varchar('allowlist_hash', { length: 128 }),
    source: varchar('source', { length: 40 }).notNull().default('cli'),
    reportPath: text('report_path'),
    aggregateCounts: jsonb('aggregate_counts')
      .$type<JsonRecord>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    verificationSummary: jsonb('verification_summary')
      .$type<JsonRecord>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_account_merge_batches_status_created').on(
      table.status,
      table.createdAt,
    ),
    index('idx_account_merge_batches_operator').on(table.operatorUserId),
    index('idx_account_merge_batches_dry_run_hash').on(table.dryRunHash),
  ],
);

export const accountMergeRowChanges = pgTable(
  'account_merge_row_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => accountMergeBatches.id, { onDelete: 'cascade' }),
    mergeGroupKey: varchar('merge_group_key', { length: 255 }).notNull(),
    tableName: varchar('table_name', { length: 120 }).notNull(),
    rowId: varchar('row_id', { length: 160 }).notNull(),
    sourceUserId: uuid('source_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    beforeSnapshot: jsonb('before_snapshot').$type<JsonRecord>().notNull(),
    afterSnapshot: jsonb('after_snapshot').$type<JsonRecord>().notNull(),
    expectedRowCount: integer('expected_row_count').notNull().default(1),
    actualRowCount: integer('actual_row_count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_account_merge_row_changes_batch').on(table.batchId),
    index('idx_account_merge_row_changes_source_target').on(
      table.sourceUserId,
      table.targetUserId,
    ),
    index('idx_account_merge_row_changes_table_row').on(
      table.tableName,
      table.rowId,
    ),
  ],
);
