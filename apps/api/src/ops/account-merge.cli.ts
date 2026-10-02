import { randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AccountMergeModule } from '../modules/account-merge/account-merge.module.js';
import {
  hashAccountMergeDryRun,
  hashJson,
} from '../modules/account-merge/account-merge-policy.js';
import {
  AccountMergeService,
  type AccountMergeApplyResult,
  type AccountMergeDatabaseIdentity,
  type AccountMergeDryRunResult,
  type AccountMergeSalesActivity,
  type AccountMergeVerifyResult,
  type ManualMergeAllowlistEntry,
} from '../modules/account-merge/account-merge.service.js';

export type AccountMergeCliMode = 'dry-run' | 'apply' | 'verify';

export interface AccountMergeCliArgs {
  mode: AccountMergeCliMode;
  reportPath: string | null;
  allowlistPath: string | null;
  allowlistHash: string | null;
  backupReference: string | null;
  batchId: string | null;
  dryRunHash: string | null;
  expectedDb: string | null;
  expectedServer: string | null;
  operatorUserId: string | null;
  reason: string | null;
  allowActiveSales: boolean;
}

/** Connection target without credentials, printed before every run. */
export interface AccountMergeDatabaseTarget {
  host: string;
  port: string;
  database: string;
  user: string;
  /** `host:port/database`; the value `--expected-db` must match. */
  descriptor: string;
}

export type AccountMergeCliService = Pick<
  AccountMergeService,
  | 'dryRun'
  | 'apply'
  | 'verify'
  | 'validateManualAllowlist'
  | 'salesActivity'
  | 'databaseIdentity'
>;

export interface AccountMergeCliDeps {
  service: AccountMergeCliService;
  databaseUrl: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const VALUE_FLAGS: Record<string, keyof AccountMergeCliArgs> = {
  '--report': 'reportPath',
  '--allowlist': 'allowlistPath',
  '--allowlist-hash': 'allowlistHash',
  '--backup-reference': 'backupReference',
  '--batch-id': 'batchId',
  '--dry-run-hash': 'dryRunHash',
  '--expected-db': 'expectedDb',
  '--expected-server': 'expectedServer',
  '--operator-user-id': 'operatorUserId',
  '--reason': 'reason',
};

export function parseAccountMergeArgs(argv: string[]): AccountMergeCliArgs {
  const [modeValue, ...rest] = argv;
  if (
    modeValue !== 'dry-run' &&
    modeValue !== 'apply' &&
    modeValue !== 'verify'
  ) {
    throw new Error('ACCOUNT_MERGE_MODE_REQUIRED');
  }

  const args: AccountMergeCliArgs = {
    mode: modeValue,
    reportPath: null,
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
  };

  let index = 0;
  while (index < rest.length) {
    const key = rest[index];
    if (key === '--allow-active-sales') {
      args.allowActiveSales = true;
      index += 1;
      continue;
    }

    const value = rest[index + 1];
    if (!key || !value) {
      throw new Error('ACCOUNT_MERGE_INVALID_ARGUMENTS');
    }
    const field = VALUE_FLAGS[key];
    if (!field) {
      throw new Error(`ACCOUNT_MERGE_UNKNOWN_ARGUMENT:${key}`);
    }
    (args as unknown as Record<string, string>)[field] = value;
    index += 2;
  }

  return args;
}

export function requireApplySafetyInputs(args: AccountMergeCliArgs): void {
  if (args.mode !== 'apply') {
    return;
  }
  if (!args.reportPath) {
    throw new Error('ACCOUNT_MERGE_REPORT_REQUIRED');
  }
  if (!args.allowlistPath) {
    throw new Error('ACCOUNT_MERGE_ALLOWLIST_REQUIRED');
  }
  if (!args.backupReference) {
    throw new Error('ACCOUNT_MERGE_BACKUP_REFERENCE_REQUIRED');
  }
  if (!args.dryRunHash) {
    throw new Error('ACCOUNT_MERGE_DRY_RUN_HASH_REQUIRED');
  }
  if (!args.operatorUserId) {
    throw new Error('ACCOUNT_MERGE_OPERATOR_REQUIRED');
  }
  if (!args.reason || args.reason.trim().length < 10) {
    throw new Error('ACCOUNT_MERGE_REASON_REQUIRED');
  }
  if (!args.allowlistHash) {
    throw new Error('ACCOUNT_MERGE_ALLOWLIST_HASH_REQUIRED');
  }
  if (!args.expectedDb) {
    throw new Error('ACCOUNT_MERGE_EXPECTED_DB_REQUIRED');
  }
  if (!args.expectedServer) {
    throw new Error('ACCOUNT_MERGE_EXPECTED_SERVER_REQUIRED');
  }
}

/**
 * Parses DATABASE_URL the way node-postgres does (a `host` query parameter,
 * e.g. a Cloud SQL socket path, overrides the URL host) and drops the
 * password so the result can be printed.
 */
export function describeDatabaseTarget(
  databaseUrl: string | undefined,
): AccountMergeDatabaseTarget {
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error('ACCOUNT_MERGE_DATABASE_URL_REQUIRED');
  }

  const raw = databaseUrl.trim();
  let url: URL;
  let urlHost: string;
  try {
    url = new URL(raw);
    urlHost = decodeURIComponent(url.hostname);
  } catch {
    // `user:pass@/db?host=/socket` has credentials without a host, which
    // WHATWG URL rejects; node-postgres retries with a placeholder host.
    try {
      url = new URL(raw.replace('@/', '@account-merge-placeholder/'));
      urlHost = '';
    } catch {
      throw new Error('ACCOUNT_MERGE_DATABASE_URL_INVALID');
    }
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('ACCOUNT_MERGE_DATABASE_URL_INVALID');
  }

  const host = url.searchParams.get('host') || urlHost || 'localhost';
  const port = url.searchParams.get('port') || url.port || '5432';
  const database =
    decodeURIComponent(url.pathname.replace(/^\//, '')) ||
    url.searchParams.get('dbname') ||
    '';
  const user = decodeURIComponent(url.username) || url.searchParams.get('user') || '';

  return {
    host,
    port,
    database,
    user,
    descriptor: `${host}:${port}/${database}`,
  };
}

export function assertExpectedDatabase(
  target: AccountMergeDatabaseTarget,
  expectedDb: string,
): void {
  if (expectedDb.trim() !== target.descriptor) {
    throw new Error(`ACCOUNT_MERGE_DATABASE_TARGET_MISMATCH:${target.descriptor}`);
  }
}

/**
 * Compares the server-side identity with the value recorded from the
 * reviewed dry-run. The client-side descriptor cannot tell instances apart
 * behind a local cloud-sql-proxy (always 127.0.0.1:<port>).
 */
export function assertExpectedServer(
  identity: AccountMergeDatabaseIdentity,
  expectedServer: string,
): void {
  if (expectedServer.trim() !== identity.fingerprint) {
    throw new Error(`ACCOUNT_MERGE_DATABASE_SERVER_MISMATCH:${identity.fingerprint}`);
  }
}

/** Compares the allowlist on disk with the hash recorded at review time. */
export function assertReviewedAllowlistHash(
  manualAllowlist: ManualMergeAllowlistEntry[],
  reviewedAllowlistHash: string,
): void {
  if (hashJson(manualAllowlist) !== reviewedAllowlistHash.trim()) {
    throw new Error('ACCOUNT_MERGE_ALLOWLIST_HASH_MISMATCH');
  }
}

/**
 * Proves the report can be written before the merge transaction commits, so
 * an apply never succeeds without its protected evidence file.
 */
export function assertReportPathWritable(path: string): void {
  const probePath = join(
    dirname(path),
    `.account-merge-report-probe-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  try {
    const fd = openSync(probePath, 'wx', 0o600);
    try {
      writeSync(fd, 'probe');
    } finally {
      closeSync(fd);
    }
    if (existsSync(path)) {
      accessSync(path, fsConstants.W_OK);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    throw new Error(`ACCOUNT_MERGE_REPORT_PATH_NOT_WRITABLE:${code}`);
  } finally {
    try {
      unlinkSync(probePath);
    } catch {
      // The probe was never created.
    }
  }
}

export function assertSalesQuietOrAcknowledged(
  activity: AccountMergeSalesActivity,
  allowActiveSales: boolean,
): void {
  const salesActive =
    activity.activeCheckoutReservations > 0 || activity.openingShowtimes > 0;
  if (salesActive && !allowActiveSales) {
    throw new Error('ACCOUNT_MERGE_ACTIVE_SALES_CONFIRMATION_REQUIRED');
  }
}

export function writeProtectedReport(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

export function buildApplyReport({
  dryRun,
  allowlistHash,
  result,
  verification,
  verifyError,
  databaseTarget,
  databaseServer,
  salesActivity,
}: {
  dryRun: AccountMergeDryRunResult;
  allowlistHash: string;
  result: AccountMergeApplyResult;
  /** null when verify itself failed after the commit; see verifyError. */
  verification: AccountMergeVerifyResult | null;
  verifyError?: string;
  databaseTarget?: string;
  databaseServer?: string;
  salesActivity?: AccountMergeSalesActivity;
}) {
  return {
    ...(databaseTarget ? { databaseTarget } : {}),
    ...(databaseServer ? { databaseServer } : {}),
    ...(salesActivity ? { salesActivity } : {}),
    dryRun,
    allowlistHash,
    result: {
      batchId: result.batchId,
      mergedGroups: result.mergedGroups,
      mergedSourceUsers: result.mergedSourceUsers,
    },
    rowChanges: result.rowChanges,
    ticketLimitWarnings: result.ticketLimitWarnings,
    verification,
    ...(verifyError ? { verifyError } : {}),
  };
}

export function hasVerificationFailures(
  verification: Pick<AccountMergeVerifyResult, 'ok' | 'failedChecks'>,
): boolean {
  return !verification.ok || verification.failedChecks.length > 0;
}

export function readManualAllowlist(path: string): ManualMergeAllowlistEntry[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('ACCOUNT_MERGE_ALLOWLIST_INVALID');
  }

  for (const entry of parsed) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof (entry as ManualMergeAllowlistEntry).groupKey !== 'string' ||
      typeof (entry as ManualMergeAllowlistEntry).targetUserId !== 'string' ||
      !Array.isArray((entry as ManualMergeAllowlistEntry).sourceUserIds) ||
      typeof (entry as ManualMergeAllowlistEntry).reason !== 'string'
    ) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_INVALID');
    }
  }

  return parsed as ManualMergeAllowlistEntry[];
}

/** Runs one CLI command and returns the process exit code. */
export async function runAccountMergeCli(
  args: AccountMergeCliArgs,
  deps: AccountMergeCliDeps,
): Promise<number> {
  const { service } = deps;
  const target = describeDatabaseTarget(deps.databaseUrl);
  deps.stderr(JSON.stringify({ mode: args.mode, databaseTarget: target }));
  if (args.mode === 'apply') {
    // Fail on the cheap client-side checks before touching the database.
    requireApplySafetyInputs(args);
    assertExpectedDatabase(target, args.expectedDb!);
  }
  const server = await service.databaseIdentity();
  deps.stderr(JSON.stringify({ mode: args.mode, databaseServer: server }));

  if (args.mode === 'dry-run') {
    if (!args.reportPath) {
      throw new Error('ACCOUNT_MERGE_REPORT_REQUIRED');
    }

    const manualAllowlist = args.allowlistPath
      ? readManualAllowlist(args.allowlistPath)
      : [];
    const dryRun = await service.dryRun({ includeManualAllowlist: manualAllowlist });
    writeProtectedReport(args.reportPath, dryRun);
    if (args.allowlistPath) {
      // Surface allowlist entries apply would reject while the operator is
      // still reviewing, instead of at apply time.
      service.validateManualAllowlist(dryRun, manualAllowlist);
    }
    deps.stdout(
      JSON.stringify({
        mode: 'dry-run',
        databaseTarget: target.descriptor,
        databaseServer: server.fingerprint,
        reportPath: args.reportPath,
        dryRunHash: hashAccountMergeDryRun(dryRun),
        ...(args.allowlistPath ? { allowlistHash: hashJson(manualAllowlist) } : {}),
      }),
    );
    return 0;
  }

  if (args.mode === 'apply') {
    assertExpectedServer(server, args.expectedServer!);
    assertReportPathWritable(args.reportPath!);

    const manualAllowlist = readManualAllowlist(args.allowlistPath!);
    assertReviewedAllowlistHash(manualAllowlist, args.allowlistHash!);
    const dryRun = await service.dryRun({ includeManualAllowlist: manualAllowlist });
    if (args.dryRunHash !== hashAccountMergeDryRun(dryRun)) {
      throw new Error('ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH');
    }
    service.validateManualAllowlist(dryRun, manualAllowlist);

    const salesActivity = await service.salesActivity();
    deps.stderr(JSON.stringify({ mode: 'apply', salesActivity }));
    assertSalesQuietOrAcknowledged(salesActivity, args.allowActiveSales);

    const allowlistHash = args.allowlistHash!.trim();
    const result = await service.apply({
      operatorUserId: args.operatorUserId,
      reason: args.reason!,
      backupReference: args.backupReference!,
      reportPath: args.reportPath!,
      dryRunHash: args.dryRunHash!,
      allowlistHash,
      manualAllowlist,
    });
    // Committed from here on; keep the batch id visible even if verify or
    // the report write fails next.
    deps.stderr(JSON.stringify({ mode: 'apply', stage: 'committed', batchId: result.batchId }));

    let verification: AccountMergeVerifyResult | null = null;
    let verifyError: string | undefined;
    try {
      verification = await service.verify(result.batchId, { persist: true });
    } catch (error) {
      // The merge is committed. Still write the evidence report (with the
      // committed result) and exit non-zero; the batch stays 'applied' until
      // `verify --batch-id` succeeds.
      verifyError = error instanceof Error ? error.message : String(error);
      deps.stderr(JSON.stringify({
        mode: 'apply',
        stage: 'verify_failed',
        batchId: result.batchId,
        error: verifyError,
      }));
    }
    writeProtectedReport(args.reportPath!, buildApplyReport({
      dryRun,
      allowlistHash,
      result,
      verification,
      verifyError,
      databaseTarget: target.descriptor,
      databaseServer: server.fingerprint,
      salesActivity,
    }));
    deps.stdout(
      JSON.stringify({
        mode: 'apply',
        databaseTarget: target.descriptor,
        databaseServer: server.fingerprint,
        batchId: result.batchId,
        mergedGroups: result.mergedGroups,
        mergedSourceUsers: result.mergedSourceUsers,
        ticketLimitWarnings: result.ticketLimitWarnings.length,
        verificationOk: verification?.ok ?? false,
        failedChecks: verification?.failedChecks ?? [],
        ...(verifyError ? { verifyError } : {}),
      }),
    );
    return verification && !hasVerificationFailures(verification) ? 0 : 1;
  }

  if (!args.batchId) {
    throw new Error('ACCOUNT_MERGE_BATCH_ID_REQUIRED');
  }

  const verification = await service.verify(args.batchId, { persist: true });
  if (args.reportPath) {
    writeProtectedReport(args.reportPath, verification);
  }
  deps.stdout(JSON.stringify({
    mode: 'verify',
    databaseTarget: target.descriptor,
    databaseServer: server.fingerprint,
    verification,
  }));
  return hasVerificationFailures(verification) ? 1 : 0;
}

async function main(): Promise<void> {
  const args = parseAccountMergeArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AccountMergeModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    process.exitCode = await runAccountMergeCli(args, {
      service: app.get(AccountMergeService),
      databaseUrl: app.get(ConfigService).get<string>('DATABASE_URL'),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('account-merge.cli.js')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
