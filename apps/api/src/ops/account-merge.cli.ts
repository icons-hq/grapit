import {
  chmodSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AccountMergeModule } from '../modules/account-merge/account-merge.module.js';
import {
  hashAccountMergeDryRun,
  hashJson,
} from '../modules/account-merge/account-merge-policy.js';
import {
  AccountMergeService,
  type AccountMergeApplyResult,
  type AccountMergeDryRunResult,
  type AccountMergeVerifyResult,
  type ManualMergeAllowlistEntry,
} from '../modules/account-merge/account-merge.service.js';

export type AccountMergeCliMode = 'dry-run' | 'apply' | 'verify';

export interface AccountMergeCliArgs {
  mode: AccountMergeCliMode;
  reportPath: string | null;
  allowlistPath: string | null;
  backupReference: string | null;
  batchId: string | null;
  dryRunHash: string | null;
  operatorUserId: string | null;
  reason: string | null;
}

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
    backupReference: null,
    batchId: null,
    dryRunHash: null,
    operatorUserId: null,
    reason: null,
  };

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key || !value) {
      throw new Error('ACCOUNT_MERGE_INVALID_ARGUMENTS');
    }

    if (key === '--report') {
      args.reportPath = value;
    } else if (key === '--allowlist') {
      args.allowlistPath = value;
    } else if (key === '--backup-reference') {
      args.backupReference = value;
    } else if (key === '--batch-id') {
      args.batchId = value;
    } else if (key === '--dry-run-hash') {
      args.dryRunHash = value;
    } else if (key === '--operator-user-id') {
      args.operatorUserId = value;
    } else if (key === '--reason') {
      args.reason = value;
    } else {
      throw new Error(`ACCOUNT_MERGE_UNKNOWN_ARGUMENT:${key}`);
    }
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
}: {
  dryRun: AccountMergeDryRunResult;
  allowlistHash: string;
  result: AccountMergeApplyResult;
  verification: AccountMergeVerifyResult;
}) {
  return {
    dryRun,
    allowlistHash,
    result: {
      batchId: result.batchId,
      mergedGroups: result.mergedGroups,
      mergedSourceUsers: result.mergedSourceUsers,
    },
    rowChanges: result.rowChanges,
    verification,
  };
}

export function hasVerificationFailures(
  verification: Pick<AccountMergeVerifyResult, 'ok' | 'failedChecks'>,
): boolean {
  return !verification.ok || verification.failedChecks.length > 0;
}

function readManualAllowlist(path: string): ManualMergeAllowlistEntry[] {
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

async function main(): Promise<void> {
  const args = parseAccountMergeArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AccountMergeModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const service = app.get(AccountMergeService);

    if (args.mode === 'dry-run') {
      if (!args.reportPath) {
        throw new Error('ACCOUNT_MERGE_REPORT_REQUIRED');
      }

      const dryRun = await service.dryRun();
      writeProtectedReport(args.reportPath, dryRun);
      console.log(
        JSON.stringify({
          mode: 'dry-run',
          reportPath: args.reportPath,
          dryRunHash: hashAccountMergeDryRun(dryRun),
        }),
      );
      return;
    }

    if (args.mode === 'apply') {
      requireApplySafetyInputs(args);

      const manualAllowlist = readManualAllowlist(args.allowlistPath!);
      const dryRun = await service.dryRun();
      const currentDryRunHash = hashAccountMergeDryRun(dryRun);
      if (args.dryRunHash !== currentDryRunHash) {
        throw new Error('ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH');
      }

      const allowlistHash = hashJson(manualAllowlist);
      const result = await service.apply({
        operatorUserId: args.operatorUserId,
        reason: args.reason!,
        backupReference: args.backupReference!,
        reportPath: args.reportPath!,
        dryRunHash: args.dryRunHash,
        allowlistHash,
        manualAllowlist,
      });
      const verification = await service.verify(result.batchId);

      writeProtectedReport(args.reportPath!, buildApplyReport({
        dryRun,
        allowlistHash,
        result,
        verification,
      }));
      console.log(
        JSON.stringify({
          mode: 'apply',
          batchId: result.batchId,
          mergedGroups: result.mergedGroups,
          mergedSourceUsers: result.mergedSourceUsers,
          verificationOk: verification.ok,
        }),
      );
      return;
    }

    if (!args.batchId) {
      throw new Error('ACCOUNT_MERGE_BATCH_ID_REQUIRED');
    }

    const verification = await service.verify(args.batchId, { persist: true });
    if (args.reportPath) {
      writeProtectedReport(args.reportPath, verification);
    }
    console.log(JSON.stringify({ mode: 'verify', verification }));
    if (hasVerificationFailures(verification)) {
      process.exitCode = 1;
    }
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
