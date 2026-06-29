import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
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
});
