import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  accountMergeBatches,
  accountMergeBatchStatusEnum,
  accountMergeRowChanges,
} from './account-merge.js';
import { adminAuditActionEnum } from './admin-audit-logs.js';
import { ADMIN_AUDIT_ACTIONS } from '../../modules/admin/admin-audit.service.js';

describe('account merge ledger schema', () => {
  const migration = readFileSync(
    resolve(__dirname, '../migrations/0031_account_merge_ledger.sql'),
    'utf8',
  );

  it('defines account merge ledger tables and status enum', () => {
    expect(getTableName(accountMergeBatches)).toBe('account_merge_batches');
    expect(getTableName(accountMergeRowChanges)).toBe(
      'account_merge_row_changes',
    );
    expect(accountMergeBatchStatusEnum.enumValues).toEqual([
      'dry_run',
      'applied',
      'verified',
      'failed',
      'rolled_back',
    ]);
  });

  it('defines recovery columns needed for row-level rollback evidence', () => {
    const batchColumns = getTableColumns(accountMergeBatches);
    expect(batchColumns.operatorUserId.name).toBe('operator_user_id');
    expect(batchColumns.reason.name).toBe('reason');
    expect(batchColumns.backupReference.name).toBe('backup_reference');
    expect(batchColumns.dryRunHash.name).toBe('dry_run_hash');
    expect(batchColumns.allowlistHash.name).toBe('allowlist_hash');
    expect(batchColumns.source.name).toBe('source');
    expect(batchColumns.reportPath.name).toBe('report_path');
    expect(batchColumns.aggregateCounts.name).toBe('aggregate_counts');
    expect(batchColumns.verificationSummary.name).toBe(
      'verification_summary',
    );
    expect(batchColumns.appliedAt.name).toBe('applied_at');
    expect(batchColumns.verifiedAt.name).toBe('verified_at');

    const rowColumns = getTableColumns(accountMergeRowChanges);
    expect(rowColumns.mergeGroupKey.name).toBe('merge_group_key');
    expect(rowColumns.tableName.name).toBe('table_name');
    expect(rowColumns.rowId.name).toBe('row_id');
    expect(rowColumns.sourceUserId.name).toBe('source_user_id');
    expect(rowColumns.targetUserId.name).toBe('target_user_id');
    expect(rowColumns.beforeSnapshot.name).toBe('before_snapshot');
    expect(rowColumns.afterSnapshot.name).toBe('after_snapshot');
    expect(rowColumns.expectedRowCount.name).toBe('expected_row_count');
    expect(rowColumns.actualRowCount.name).toBe('actual_row_count');
  });

  it('adds the user.merge audit action and ledger migration contracts', () => {
    expect(adminAuditActionEnum.enumValues).toContain('user.merge');
    expect(ADMIN_AUDIT_ACTIONS).toContain('user.merge');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'user.merge'");
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "account_merge_batches"',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "account_merge_row_changes"',
    );
    expect(migration).toContain('idx_account_merge_batches_status_created');
    expect(migration).toContain('idx_account_merge_batches_operator');
    expect(migration).toContain('idx_account_merge_batches_dry_run_hash');
    expect(migration).toContain('idx_account_merge_row_changes_batch');
    expect(migration).toContain(
      'idx_account_merge_row_changes_source_target',
    );
    expect(migration).toContain('idx_account_merge_row_changes_table_row');
  });
});
