import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildApplyReport,
  hasVerificationFailures,
  parseAccountMergeArgs,
  requireApplySafetyInputs,
  writeProtectedReport,
} from './account-merge.cli.js';

describe('account merge CLI helpers', () => {
  it('parses dry-run mode with report path', () => {
    expect(
      parseAccountMergeArgs([
        'dry-run',
        '--report',
        '/tmp/account-merge-report.json',
      ]),
    ).toEqual({
      mode: 'dry-run',
      reportPath: '/tmp/account-merge-report.json',
      allowlistPath: null,
      backupReference: null,
      batchId: null,
      dryRunHash: null,
      operatorUserId: null,
      reason: null,
    });
  });

  it('requires backup reference, operator, reason, report, and allowlist for apply', () => {
    expect(() =>
      requireApplySafetyInputs({
        mode: 'apply',
        reportPath: '/tmp/report.json',
        allowlistPath: null,
        backupReference: 'cloudsql-backup-20260629',
        batchId: null,
        dryRunHash: 'dry-run-hash',
        operatorUserId: 'operator-1',
        reason: 'merge approved groups',
      }),
    ).toThrow('ACCOUNT_MERGE_ALLOWLIST_REQUIRED');
  });

  it('requires the reviewed dry-run hash for apply', () => {
    expect(() =>
      requireApplySafetyInputs({
        mode: 'apply',
        reportPath: '/tmp/report.json',
        allowlistPath: '/tmp/allowlist.json',
        backupReference: 'cloudsql-backup-20260629',
        batchId: null,
        dryRunHash: null,
        operatorUserId: 'operator-1',
        reason: 'merge approved groups',
      }),
    ).toThrow('ACCOUNT_MERGE_DRY_RUN_HASH_REQUIRED');
  });

  it('parses the reviewed dry-run hash for apply', () => {
    expect(
      parseAccountMergeArgs([
        'apply',
        '--report',
        '/tmp/apply-report.json',
        '--allowlist',
        '/tmp/allowlist.json',
        '--backup-reference',
        'cloudsql-backup-20260629',
        '--operator-user-id',
        'operator-1',
        '--reason',
        'merge approved groups',
        '--dry-run-hash',
        'dry-run-hash',
      ]),
    ).toEqual({
      mode: 'apply',
      reportPath: '/tmp/apply-report.json',
      allowlistPath: '/tmp/allowlist.json',
      backupReference: 'cloudsql-backup-20260629',
      batchId: null,
      dryRunHash: 'dry-run-hash',
      operatorUserId: 'operator-1',
      reason: 'merge approved groups',
    });
  });

  it('writes protected reports with user-only permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'account-merge-'));
    const reportPath = join(dir, 'report.json');

    writeProtectedReport(reportPath, { ok: true });

    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ ok: true });
    expect((statSync(reportPath).mode & 0o777).toString(8)).toBe('600');
  });

  it('builds apply reports with allowlist hash, row changes, and verification summary', () => {
    const report = buildApplyReport({
      dryRun: {
        generatedAt: new Date('2026-06-29T00:00:00.000Z'),
        safeGroups: [],
        manualReviewGroups: [],
        manualAllowlist: [],
      },
      allowlistHash: 'allowlist-hash',
      result: {
        batchId: 'batch-1',
        mergedGroups: 1,
        mergedSourceUsers: 1,
        rowChanges: [
          {
            tableName: 'reservations',
            rowId: 'reservation-1',
            sourceUserId: 'source-1',
            targetUserId: 'target-1',
            beforeSnapshot: { id: 'reservation-1', userId: 'source-1' },
            afterSnapshot: { id: 'reservation-1', userId: 'target-1' },
          },
        ],
      },
      verification: {
        batchId: 'batch-1',
        ok: true,
        failedChecks: [],
        sourceUsersWithoutReservations: ['source-1'],
        sourceUsersWithoutSocialLinks: ['source-1'],
        sourceUsersWithoutTermsAgreements: ['source-1'],
        sourceUsersWithoutConsentAuditLogs: ['source-1'],
        sourceUsersWithoutSupportThreads: ['source-1'],
        sourceUsersWithPendingEmailVerificationTokens: [],
        sourceUsersWithActiveRefreshTokens: [],
        sourceUsersMarkedMerged: ['source-1'],
        targetUsersWithReservations: ['target-1'],
        ledgerMismatches: [],
      },
    });

    expect(report).toEqual({
      dryRun: expect.objectContaining({ safeGroups: [] }),
      allowlistHash: 'allowlist-hash',
      result: {
        batchId: 'batch-1',
        mergedGroups: 1,
        mergedSourceUsers: 1,
      },
      rowChanges: [
        expect.objectContaining({
          tableName: 'reservations',
          beforeSnapshot: { id: 'reservation-1', userId: 'source-1' },
          afterSnapshot: { id: 'reservation-1', userId: 'target-1' },
        }),
      ],
      verification: expect.objectContaining({ ok: true, failedChecks: [] }),
    });
  });

  it('treats verification summaries with failed checks as CLI failures', () => {
    expect(
      hasVerificationFailures({
        ok: false,
        failedChecks: ['ledger_mismatches'],
      }),
    ).toBe(true);
    expect(hasVerificationFailures({ ok: true, failedChecks: [] })).toBe(false);
  });
});
