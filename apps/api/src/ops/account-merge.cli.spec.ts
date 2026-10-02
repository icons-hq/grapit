import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  hashAccountMergeDryRun,
  hashJson,
} from '../modules/account-merge/account-merge-policy.js';
import type {
  AccountMergeDryRunResult,
  AccountMergeVerifyResult,
  ManualMergeAllowlistEntry,
} from '../modules/account-merge/account-merge.service.js';
import {
  assertExpectedDatabase,
  assertExpectedServer,
  assertReportPathWritable,
  assertReviewedAllowlistHash,
  assertSalesQuietOrAcknowledged,
  buildApplyReport,
  describeDatabaseTarget,
  hasVerificationFailures,
  parseAccountMergeArgs,
  requireApplySafetyInputs,
  runAccountMergeCli,
  writeProtectedReport,
  type AccountMergeCliArgs,
} from './account-merge.cli.js';

const DATABASE_URL = 'postgresql://grapit_app:s3cr3t-pass@127.0.0.1:5433/grapit';
const DATABASE_DESCRIPTOR = '127.0.0.1:5433/grapit';
const SERVER_FINGERPRINT = 'sysid:7400000000000000001/grapit';
const DATABASE_IDENTITY = {
  database: 'grapit',
  serverAddress: '10.20.0.3',
  serverPort: 5432,
  systemIdentifier: '7400000000000000001',
  fingerprint: SERVER_FINGERPRINT,
};
const QUIET_SALES = {
  activeCheckoutReservations: 0,
  openingShowtimes: 0,
  recentOpeningHours: 2,
  lookaheadHours: 24,
};

function applyArgs(overrides: Partial<AccountMergeCliArgs> = {}): AccountMergeCliArgs {
  return {
    mode: 'apply',
    reportPath: '/tmp/report.json',
    allowlistPath: '/tmp/allowlist.json',
    allowlistHash: 'allowlist-hash',
    backupReference: 'cloudsql-backup-20260629',
    batchId: null,
    dryRunHash: 'dry-run-hash',
    expectedDb: DATABASE_DESCRIPTOR,
    expectedServer: SERVER_FINGERPRINT,
    operatorUserId: 'operator-1',
    reason: 'merge approved groups',
    allowActiveSales: false,
    ...overrides,
  };
}

function verification(
  overrides: Partial<AccountMergeVerifyResult> = {},
): AccountMergeVerifyResult {
  return {
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
    ...overrides,
  };
}

const ALLOWLIST: ManualMergeAllowlistEntry[] = [
  {
    groupKey: '821055556666|1991-02-03|kim',
    targetUserId: 'manual-a',
    sourceUserIds: ['manual-b'],
    reason: 'operator verified both reservation owners belong to the same buyer',
  },
];

function cliFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'account-merge-cli-'));
  const allowlistPath = join(dir, 'allowlist.json');
  writeFileSync(allowlistPath, JSON.stringify(ALLOWLIST));
  const dryRun: AccountMergeDryRunResult = {
    generatedAt: new Date('2026-10-02T00:00:00.000Z'),
    safeGroups: [
      {
        kind: 'safe',
        groupKey: '821012345678|1995-05-15|hong',
        targetUserId: 'target-safe',
        sourceUserIds: ['source-safe'],
      },
    ],
    manualReviewGroups: [
      {
        kind: 'manual_review',
        groupKey: '821055556666|1991-02-03|kim',
        reason: 'multiple_confirmed_owners',
        userIds: ['manual-a', 'manual-b'],
      },
    ],
    manualAllowlist: ALLOWLIST,
  };
  const service = {
    dryRun: vi.fn().mockResolvedValue(dryRun),
    validateManualAllowlist: vi.fn(),
    databaseIdentity: vi.fn().mockResolvedValue(DATABASE_IDENTITY),
    salesActivity: vi.fn().mockResolvedValue(QUIET_SALES),
    apply: vi.fn().mockResolvedValue({
      batchId: 'batch-1',
      mergedGroups: 2,
      mergedSourceUsers: 2,
      rowChanges: [],
      ticketLimitWarnings: [],
    }),
    verify: vi.fn().mockResolvedValue(verification()),
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    dir,
    allowlistPath,
    reportPath: join(dir, 'apply-report.json'),
    dryRunHash: hashAccountMergeDryRun(dryRun),
    allowlistHash: hashJson(ALLOWLIST),
    service,
    stdout,
    stderr,
    deps: {
      service,
      databaseUrl: DATABASE_URL,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

function fixtureApplyArgs(
  fixture: ReturnType<typeof cliFixture>,
  overrides: Partial<AccountMergeCliArgs> = {},
): AccountMergeCliArgs {
  return applyArgs({
    reportPath: fixture.reportPath,
    allowlistPath: fixture.allowlistPath,
    allowlistHash: fixture.allowlistHash,
    dryRunHash: fixture.dryRunHash,
    ...overrides,
  });
}

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
      allowlistHash: null,
      backupReference: null,
      batchId: null,
      dryRunHash: null,
      expectedDb: null,
      expectedServer: null,
      operatorUserId: null,
      reason: null,
      allowActiveSales: false,
    });
  });

  it('requires backup reference, operator, reason, report, and allowlist for apply', () => {
    expect(() =>
      requireApplySafetyInputs(applyArgs({ allowlistPath: null })),
    ).toThrow('ACCOUNT_MERGE_ALLOWLIST_REQUIRED');
  });

  it('requires the reviewed dry-run hash for apply', () => {
    expect(() =>
      requireApplySafetyInputs(applyArgs({ dryRunHash: null })),
    ).toThrow('ACCOUNT_MERGE_DRY_RUN_HASH_REQUIRED');
  });

  it('requires the reviewed allowlist hash, the expected database and the expected server for apply', () => {
    expect(() =>
      requireApplySafetyInputs(applyArgs({ allowlistHash: null })),
    ).toThrow('ACCOUNT_MERGE_ALLOWLIST_HASH_REQUIRED');
    expect(() =>
      requireApplySafetyInputs(applyArgs({ expectedDb: null })),
    ).toThrow('ACCOUNT_MERGE_EXPECTED_DB_REQUIRED');
    expect(() =>
      requireApplySafetyInputs(applyArgs({ expectedServer: null })),
    ).toThrow('ACCOUNT_MERGE_EXPECTED_SERVER_REQUIRED');
    expect(() => requireApplySafetyInputs(applyArgs())).not.toThrow();
  });

  it('parses the reviewed hashes, expected database, and active-sales acknowledgement for apply', () => {
    expect(
      parseAccountMergeArgs([
        'apply',
        '--report',
        '/tmp/apply-report.json',
        '--allowlist',
        '/tmp/allowlist.json',
        '--allowlist-hash',
        'allowlist-hash',
        '--backup-reference',
        'cloudsql-backup-20260629',
        '--allow-active-sales',
        '--operator-user-id',
        'operator-1',
        '--reason',
        'merge approved groups',
        '--expected-db',
        DATABASE_DESCRIPTOR,
        '--expected-server',
        SERVER_FINGERPRINT,
        '--dry-run-hash',
        'dry-run-hash',
      ]),
    ).toEqual({
      mode: 'apply',
      reportPath: '/tmp/apply-report.json',
      allowlistPath: '/tmp/allowlist.json',
      allowlistHash: 'allowlist-hash',
      backupReference: 'cloudsql-backup-20260629',
      batchId: null,
      dryRunHash: 'dry-run-hash',
      expectedDb: DATABASE_DESCRIPTOR,
      expectedServer: SERVER_FINGERPRINT,
      operatorUserId: 'operator-1',
      reason: 'merge approved groups',
      allowActiveSales: true,
    });
  });

  it('rejects unknown arguments and value flags without a value', () => {
    expect(() => parseAccountMergeArgs(['apply', '--force', 'yes'])).toThrow(
      'ACCOUNT_MERGE_UNKNOWN_ARGUMENT:--force',
    );
    expect(() => parseAccountMergeArgs(['apply', '--expected-db'])).toThrow(
      'ACCOUNT_MERGE_INVALID_ARGUMENTS',
    );
  });

  it('describes the DATABASE_URL target without the password', () => {
    const target = describeDatabaseTarget(DATABASE_URL);

    expect(target).toEqual({
      host: '127.0.0.1',
      port: '5433',
      database: 'grapit',
      user: 'grapit_app',
      descriptor: DATABASE_DESCRIPTOR,
    });
    expect(JSON.stringify(target)).not.toContain('s3cr3t-pass');
  });

  it('uses the socket host query parameter the way node-postgres does', () => {
    expect(
      describeDatabaseTarget(
        'postgresql://grapit_app:pw@/grapit?host=/cloudsql/project:asia-northeast3:grapit-db',
      ).descriptor,
    ).toBe('/cloudsql/project:asia-northeast3:grapit-db:5432/grapit');
    expect(describeDatabaseTarget('postgres://u:p@db.internal/grapit').descriptor)
      .toBe('db.internal:5432/grapit');
  });

  it('rejects a missing or non-postgres DATABASE_URL', () => {
    expect(() => describeDatabaseTarget(undefined)).toThrow('ACCOUNT_MERGE_DATABASE_URL_REQUIRED');
    expect(() => describeDatabaseTarget('not a url')).toThrow('ACCOUNT_MERGE_DATABASE_URL_INVALID');
    expect(() => describeDatabaseTarget('mysql://u:p@db/grapit')).toThrow(
      'ACCOUNT_MERGE_DATABASE_URL_INVALID',
    );
  });

  it('rejects apply against a database other than the expected one', () => {
    const localTarget = describeDatabaseTarget('postgresql://u:p@localhost:5432/grapit');

    expect(() => assertExpectedDatabase(localTarget, DATABASE_DESCRIPTOR)).toThrow(
      'ACCOUNT_MERGE_DATABASE_TARGET_MISMATCH:localhost:5432/grapit',
    );
    expect(() =>
      assertExpectedDatabase(describeDatabaseTarget(DATABASE_URL), ` ${DATABASE_DESCRIPTOR} `),
    ).not.toThrow();
  });

  it('rejects apply when the server behind the same proxy address is a different instance', () => {
    expect(() => assertExpectedServer(DATABASE_IDENTITY, ` ${SERVER_FINGERPRINT} `)).not.toThrow();
    expect(() =>
      assertExpectedServer(
        { ...DATABASE_IDENTITY, systemIdentifier: '7400000000000000999', fingerprint: 'sysid:7400000000000000999/grapit' },
        SERVER_FINGERPRINT,
      ),
    ).toThrow('ACCOUNT_MERGE_DATABASE_SERVER_MISMATCH:sysid:7400000000000000999/grapit');
  });

  it('rejects an allowlist file whose target changed after its hash was reviewed', () => {
    const reviewedHash = hashJson(ALLOWLIST);
    const edited = [{ ...ALLOWLIST[0]!, targetUserId: 'manual-b', sourceUserIds: ['manual-a'] }];

    expect(() => assertReviewedAllowlistHash(ALLOWLIST, reviewedHash)).not.toThrow();
    expect(() => assertReviewedAllowlistHash(edited, reviewedHash)).toThrow(
      'ACCOUNT_MERGE_ALLOWLIST_HASH_MISMATCH',
    );
  });

  it('checks the report path is writable without leaving probe files behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'account-merge-probe-'));

    expect(() => assertReportPathWritable(join(dir, 'report.json'))).not.toThrow();
    expect(readdirSync(dir)).toEqual([]);
    expect(() => assertReportPathWritable(join(dir, 'missing-dir', 'report.json'))).toThrow(
      'ACCOUNT_MERGE_REPORT_PATH_NOT_WRITABLE:ENOENT',
    );
  });

  it('requires an explicit acknowledgement while checkout or an opening is active', () => {
    const quiet = QUIET_SALES;
    const checkout = { ...quiet, activeCheckoutReservations: 2 };
    const opening = { ...quiet, openingShowtimes: 1 };

    expect(() => assertSalesQuietOrAcknowledged(quiet, false)).not.toThrow();
    expect(() => assertSalesQuietOrAcknowledged(checkout, false)).toThrow(
      'ACCOUNT_MERGE_ACTIVE_SALES_CONFIRMATION_REQUIRED',
    );
    expect(() => assertSalesQuietOrAcknowledged(opening, false)).toThrow(
      'ACCOUNT_MERGE_ACTIVE_SALES_CONFIRMATION_REQUIRED',
    );
    expect(() => assertSalesQuietOrAcknowledged(opening, true)).not.toThrow();
  });

  it('writes protected reports with user-only permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'account-merge-'));
    const reportPath = join(dir, 'report.json');

    writeProtectedReport(reportPath, { ok: true });

    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ ok: true });
    expect((statSync(reportPath).mode & 0o777).toString(8)).toBe('600');
  });

  it('builds apply reports with allowlist hash, row changes, ticket-limit warnings, and verification summary', () => {
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
        ticketLimitWarnings: [
          {
            groupKey: 'group-1',
            targetUserId: 'target-1',
            performanceId: 'performance-1',
            activeTicketCount: 2,
            maxTicketsPerUser: 1,
          },
        ],
      },
      verification: verification(),
      databaseTarget: DATABASE_DESCRIPTOR,
      databaseServer: SERVER_FINGERPRINT,
    });

    expect(report).toEqual({
      databaseTarget: DATABASE_DESCRIPTOR,
      databaseServer: SERVER_FINGERPRINT,
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
      ticketLimitWarnings: [
        expect.objectContaining({ performanceId: 'performance-1', activeTicketCount: 2 }),
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

describe('runAccountMergeCli apply safety', () => {
  it('prints the masked target, persists verification, and exits 0 on a verified apply', async () => {
    const fixture = cliFixture();

    const exitCode = await runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps);

    expect(exitCode).toBe(0);
    expect(fixture.stderr[0]).toContain(DATABASE_DESCRIPTOR);
    expect(fixture.stderr.join('\n')).not.toContain('s3cr3t-pass');
    expect(fixture.service.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        allowlistHash: fixture.allowlistHash,
        dryRunHash: fixture.dryRunHash,
        manualAllowlist: ALLOWLIST,
      }),
    );
    expect(fixture.service.verify).toHaveBeenCalledWith('batch-1', { persist: true });
    expect(fixture.stderr.join('\n')).toContain(SERVER_FINGERPRINT);
    expect(JSON.parse(fixture.stdout.at(-1)!)).toMatchObject({
      mode: 'apply',
      databaseTarget: DATABASE_DESCRIPTOR,
      databaseServer: SERVER_FINGERPRINT,
      batchId: 'batch-1',
      verificationOk: true,
    });
    expect(JSON.parse(readFileSync(fixture.reportPath, 'utf8'))).toMatchObject({
      databaseTarget: DATABASE_DESCRIPTOR,
      databaseServer: SERVER_FINGERPRINT,
      allowlistHash: fixture.allowlistHash,
      verification: { ok: true },
    });
  });

  it('still writes the report and exits non-zero when verify itself throws after the commit', async () => {
    const fixture = cliFixture();
    fixture.service.verify.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    const exitCode = await runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps);

    expect(exitCode).toBe(1);
    expect(fixture.service.apply).toHaveBeenCalledTimes(1);
    expect(fixture.stderr.join('\n')).toContain('"stage":"committed","batchId":"batch-1"');
    expect(fixture.stderr.join('\n')).toContain('"stage":"verify_failed"');
    expect(JSON.parse(fixture.stdout.at(-1)!)).toMatchObject({
      batchId: 'batch-1',
      verificationOk: false,
      verifyError: 'Connection terminated unexpectedly',
    });
    const report = JSON.parse(readFileSync(fixture.reportPath, 'utf8'));
    expect(report).toMatchObject({
      result: { batchId: 'batch-1', mergedGroups: 2 },
      verification: null,
      verifyError: 'Connection terminated unexpectedly',
    });
    expect((statSync(fixture.reportPath).mode & 0o777).toString(8)).toBe('600');
  });

  it('refuses to apply when the proxy now forwards to a different database server', async () => {
    const fixture = cliFixture();
    fixture.service.databaseIdentity.mockResolvedValueOnce({
      ...DATABASE_IDENTITY,
      systemIdentifier: '7400000000000000999',
      fingerprint: 'sysid:7400000000000000999/grapit',
    });

    await expect(
      runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps),
    ).rejects.toThrow('ACCOUNT_MERGE_DATABASE_SERVER_MISMATCH:sysid:7400000000000000999/grapit');
    expect(fixture.service.dryRun).not.toHaveBeenCalled();
    expect(fixture.service.apply).not.toHaveBeenCalled();
  });

  it('exits non-zero and records the failed verification when post-apply verify fails', async () => {
    const fixture = cliFixture();
    fixture.service.verify.mockResolvedValueOnce(
      verification({ ok: false, failedChecks: ['source_reservations_remaining'] }),
    );

    const exitCode = await runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps);

    expect(exitCode).toBe(1);
    expect(fixture.service.verify).toHaveBeenCalledWith('batch-1', { persist: true });
    expect(JSON.parse(fixture.stdout.at(-1)!)).toMatchObject({
      verificationOk: false,
      failedChecks: ['source_reservations_remaining'],
    });
    expect(JSON.parse(readFileSync(fixture.reportPath, 'utf8'))).toMatchObject({
      verification: { ok: false },
    });
  });

  it('refuses to apply against an unexpected database before reading or writing anything', async () => {
    const fixture = cliFixture();

    await expect(
      runAccountMergeCli(
        fixtureApplyArgs(fixture, { expectedDb: 'prod-host:5432/grapit' }),
        fixture.deps,
      ),
    ).rejects.toThrow(`ACCOUNT_MERGE_DATABASE_TARGET_MISMATCH:${DATABASE_DESCRIPTOR}`);
    expect(fixture.service.databaseIdentity).not.toHaveBeenCalled();
    expect(fixture.service.dryRun).not.toHaveBeenCalled();
    expect(fixture.service.apply).not.toHaveBeenCalled();
  });

  it('refuses to apply an allowlist edited after its hash was reviewed', async () => {
    const fixture = cliFixture();
    writeFileSync(
      fixture.allowlistPath,
      JSON.stringify([{ ...ALLOWLIST[0]!, targetUserId: 'manual-b', sourceUserIds: ['manual-a'] }]),
    );

    await expect(
      runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps),
    ).rejects.toThrow('ACCOUNT_MERGE_ALLOWLIST_HASH_MISMATCH');
    expect(fixture.service.apply).not.toHaveBeenCalled();
  });

  it('refuses to apply before the transaction when the report cannot be written', async () => {
    const fixture = cliFixture();

    await expect(
      runAccountMergeCli(
        fixtureApplyArgs(fixture, { reportPath: join(fixture.dir, 'missing', 'report.json') }),
        fixture.deps,
      ),
    ).rejects.toThrow('ACCOUNT_MERGE_REPORT_PATH_NOT_WRITABLE');
    expect(fixture.service.apply).not.toHaveBeenCalled();
  });

  it('stops before the transaction when an allowlist entry can never pass revalidation', async () => {
    const fixture = cliFixture();
    fixture.service.validateManualAllowlist.mockImplementationOnce(() => {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_IDENTITY_EVIDENCE_INCOMPLETE');
    });

    await expect(
      runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps),
    ).rejects.toThrow('ACCOUNT_MERGE_ALLOWLIST_IDENTITY_EVIDENCE_INCOMPLETE');
    expect(fixture.service.apply).not.toHaveBeenCalled();
  });

  it('requires --allow-active-sales while checkouts are in flight or an opening is near', async () => {
    const fixture = cliFixture();
    fixture.service.salesActivity.mockResolvedValue({
      ...QUIET_SALES,
      activeCheckoutReservations: 3,
      openingShowtimes: 1,
    });

    await expect(
      runAccountMergeCli(fixtureApplyArgs(fixture), fixture.deps),
    ).rejects.toThrow('ACCOUNT_MERGE_ACTIVE_SALES_CONFIRMATION_REQUIRED');
    expect(fixture.service.apply).not.toHaveBeenCalled();

    await expect(
      runAccountMergeCli(fixtureApplyArgs(fixture, { allowActiveSales: true }), fixture.deps),
    ).resolves.toBe(0);
    expect(fixture.service.apply).toHaveBeenCalledTimes(1);
  });

  it('dry-run with an allowlist validates it and prints the hash to record for apply', async () => {
    const fixture = cliFixture();
    const reportPath = join(fixture.dir, 'dry-run.json');

    const exitCode = await runAccountMergeCli(
      {
        ...applyArgs({ mode: 'dry-run', reportPath, allowlistPath: fixture.allowlistPath }),
        allowlistHash: null,
        dryRunHash: null,
        expectedDb: null,
        expectedServer: null,
      },
      fixture.deps,
    );

    expect(exitCode).toBe(0);
    expect(fixture.service.validateManualAllowlist).toHaveBeenCalledWith(
      expect.objectContaining({ manualReviewGroups: expect.any(Array) }),
      ALLOWLIST,
    );
    expect(JSON.parse(fixture.stdout.at(-1)!)).toEqual({
      mode: 'dry-run',
      databaseTarget: DATABASE_DESCRIPTOR,
      databaseServer: SERVER_FINGERPRINT,
      reportPath,
      dryRunHash: fixture.dryRunHash,
      allowlistHash: fixture.allowlistHash,
    });
    expect(fixture.service.apply).not.toHaveBeenCalled();
  });

  it('verify mode exits non-zero when checks fail', async () => {
    const fixture = cliFixture();
    fixture.service.verify.mockResolvedValueOnce(
      verification({ ok: false, failedChecks: ['ledger_mismatches'] }),
    );

    await expect(
      runAccountMergeCli(
        { ...applyArgs({ mode: 'verify', batchId: 'batch-1', reportPath: null }) },
        fixture.deps,
      ),
    ).resolves.toBe(1);
    expect(fixture.service.verify).toHaveBeenCalledWith('batch-1', { persist: true });
  });
});
