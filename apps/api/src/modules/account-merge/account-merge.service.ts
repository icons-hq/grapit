import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  getTableName,
  inArray,
  isNull,
  sql,
  type SQLWrapper,
} from 'drizzle-orm';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  accountMergeBatches,
  accountMergeRowChanges,
  consentAuditLogs,
  emailVerificationTokens,
  refreshTokens,
  reservations,
  socialAccounts,
  supportThreads,
  termsAgreements,
  users,
} from '../../database/schema/index.js';
import {
  buildMergeGroupKey,
  classifyDuplicateGroup,
  hashAccountMergeDryRun,
  hashJson,
  type MergeCandidateUser,
  type MergeClassification,
  type ReservationCounts,
} from './account-merge-policy.js';

export interface ManualMergeAllowlistEntry {
  groupKey: string;
  targetUserId: string;
  sourceUserIds: string[];
  reason: string;
}

export interface AccountMergeDryRunOptions {
  includeManualAllowlist?: ManualMergeAllowlistEntry[];
}

export interface AccountMergeApplyOptions {
  operatorUserId: string | null;
  reason: string;
  backupReference: string;
  reportPath: string;
  dryRunHash: string;
  allowlistHash: string | null;
  manualAllowlist: ManualMergeAllowlistEntry[];
}

export interface AccountMergeVerifyResult {
  batchId: string;
  ok: boolean;
  failedChecks: string[];
  sourceUsersWithoutReservations: string[];
  sourceUsersWithoutSocialLinks: string[];
  sourceUsersWithoutTermsAgreements: string[];
  sourceUsersWithoutConsentAuditLogs: string[];
  sourceUsersWithoutSupportThreads: string[];
  sourceUsersWithPendingEmailVerificationTokens: string[];
  sourceUsersWithActiveRefreshTokens: string[];
  sourceUsersMarkedMerged: string[];
  targetUsersWithReservations: string[];
  ledgerMismatches: string[];
}

export interface AccountMergeDryRunResult {
  generatedAt: Date;
  safeGroups: Array<Extract<MergeClassification, { kind: 'safe' }>>;
  manualReviewGroups: Array<
    Extract<MergeClassification, { kind: 'manual_review' }>
  >;
  manualAllowlist: ManualMergeAllowlistEntry[];
}

export interface AccountMergeApplyResult {
  batchId: string;
  mergedGroups: number;
  mergedSourceUsers: number;
  rowChanges: AccountMergeReportRowChange[];
}

export interface AccountMergeReportRowChange {
  tableName: string;
  rowId: string;
  sourceUserId: string;
  targetUserId: string;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
}

type Row = Record<string, unknown>;
type AccountMergeTx = {
  execute: (query: SQLWrapper) => Promise<unknown>;
  select: () => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<Row[]>;
    };
  };
  update: (table: unknown) => {
    set: (values: Row) => {
      where: (condition: unknown) => {
        returning: () => Promise<Row[]>;
      };
    };
  };
  insert: (table: unknown) => {
    values: (values: Row | Row[]) => {
      returning: () => Promise<Row[]>;
    };
  };
};

type CandidateRow = {
  groupKey: string;
  id: string;
  name: string;
  phone: string;
  birthDate: string;
  isPhoneVerified: boolean;
  accountStatus: string;
  totalReservations: number;
  confirmedReservations: number;
  pendingPaymentReservations: number;
};

type MergeGroup = {
  groupKey: string;
  targetUserId: string;
  sourceUserIds: string[];
  origin: 'safe' | 'manual';
};

type LedgerChangeRow = {
  tableName: string;
  rowId: string;
  sourceUserId: string;
  targetUserId: string;
  afterSnapshot: Record<string, unknown>;
};

interface AccountMergeVerifyOptions {
  persist?: boolean;
}

type TableMoveOperation = {
  table: unknown;
  tableName: string;
  userIdColumn: unknown;
  changes: (
    targetUserId: string,
    now: Date,
    operatorUserId: string | null,
  ) => Row;
  condition?: (sourceUserIds: string[]) => unknown;
};

@Injectable()
export class AccountMergeService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async dryRun(
    options: AccountMergeDryRunOptions = {},
  ): Promise<AccountMergeDryRunResult> {
    const rows = normalizeRows<CandidateRow>(
      await this.db.execute(sql`
        with duplicate_identities as (
          select
            regexp_replace(phone, '[^0-9]', '', 'g') as normalized_phone,
            birth_date,
            lower(regexp_replace(trim(name), '[[:space:]]+', '', 'g')) as normalized_name
          from users
          where account_status = 'active'
          group by 1, 2, 3
          having count(*) > 1
        )
        select
          concat(identity.normalized_phone, '|', identity.birth_date, '|', identity.normalized_name) as "groupKey",
          users.id,
          users.name,
          users.phone,
          users.birth_date as "birthDate",
          users.is_phone_verified as "isPhoneVerified",
          users.account_status as "accountStatus",
          coalesce(reservation_counts.total, 0)::int as "totalReservations",
          coalesce(reservation_counts.confirmed, 0)::int as "confirmedReservations",
          coalesce(reservation_counts.pending_payment, 0)::int as "pendingPaymentReservations"
        from duplicate_identities identity
        join users
          on regexp_replace(users.phone, '[^0-9]', '', 'g') = identity.normalized_phone
          and users.birth_date = identity.birth_date
          and lower(regexp_replace(trim(users.name), '[[:space:]]+', '', 'g')) = identity.normalized_name
          and users.account_status = 'active'
        left join lateral (
          select
            count(*)::int as total,
            count(*) filter (where status = 'CONFIRMED')::int as confirmed,
            count(*) filter (where status = 'PENDING_PAYMENT')::int as pending_payment
          from reservations
          where reservations.user_id = users.id
        ) reservation_counts on true
        order by "groupKey", users.id
      `),
    ).map(normalizeCandidateRow);

    const groups = new Map<string, CandidateRow[]>();
    for (const row of rows.filter((row) => row.accountStatus === 'active')) {
      groups.set(row.groupKey, [...(groups.get(row.groupKey) ?? []), row]);
    }

    const safeGroups: AccountMergeDryRunResult['safeGroups'] = [];
    const manualReviewGroups: AccountMergeDryRunResult['manualReviewGroups'] =
      [];

    for (const [groupKey, groupRows] of groups) {
      if (groupRows.length < 2) {
        continue;
      }
      const reservationCounts: Record<string, ReservationCounts> = {};
      const usersInGroup: MergeCandidateUser[] = groupRows.map((row) => {
        reservationCounts[row.id] = {
          total: row.totalReservations,
          confirmed: row.confirmedReservations,
          pendingPayment: row.pendingPaymentReservations,
        };
        return {
          id: row.id,
          name: row.name,
          phone: row.phone,
          birthDate: row.birthDate,
          isPhoneVerified: row.isPhoneVerified,
          accountStatus: row.accountStatus,
        };
      });

      const classification = classifyDuplicateGroup({
        groupKey,
        users: usersInGroup,
        reservationCounts,
      });
      if (classification.kind === 'safe') {
        safeGroups.push(classification);
      } else {
        manualReviewGroups.push(classification);
      }
    }

    return {
      generatedAt: new Date(),
      safeGroups,
      manualReviewGroups,
      manualAllowlist: options.includeManualAllowlist ?? [],
    };
  }

  async apply(
    options: AccountMergeApplyOptions,
  ): Promise<AccountMergeApplyResult> {
    const dryRun = await this.dryRun({
      includeManualAllowlist: options.manualAllowlist,
    });
    assertApplyHashes(dryRun, options);
    const safeGroups = dryRun.safeGroups.map((group) => ({
      groupKey: group.groupKey,
      targetUserId: group.targetUserId,
      sourceUserIds: group.sourceUserIds,
      origin: 'safe' as const,
    }));
    const manualGroups = buildManualApplyGroups(
      dryRun.manualReviewGroups,
      options.manualAllowlist,
    );
    const groups = [...safeGroups, ...manualGroups];
    const mergedSourceUsers = groups.reduce(
      (sum, group) => sum + group.sourceUserIds.length,
      0,
    );
    if (groups.length === 0 || mergedSourceUsers === 0) {
      throw new Error('ACCOUNT_MERGE_NO_GROUPS_TO_APPLY');
    }

    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as AccountMergeTx;
      const now = new Date();
      const [batch] = await tx
        .insert(accountMergeBatches)
        .values({
          status: 'applied',
          operatorUserId: options.operatorUserId,
          reason: options.reason,
          backupReference: options.backupReference,
          dryRunHash: options.dryRunHash,
          allowlistHash: options.allowlistHash,
          reportPath: options.reportPath,
          aggregateCounts: {
            safeGroups: safeGroups.length,
            manualAllowlistGroups: manualGroups.length,
            mergedGroups: groups.length,
            mergedSourceUsers,
          },
          appliedAt: now,
        })
        .returning();
      const batchId = String(batch.id);
      const rowChanges: AccountMergeReportRowChange[] = [];

      for (const group of groups) {
        rowChanges.push(
          ...(await this.applyGroup(tx, batchId, group, now, options.operatorUserId)),
        );
      }

      return {
        batchId,
        mergedGroups: groups.length,
        mergedSourceUsers,
        rowChanges,
      };
    });
  }

  async verify(
    batchId: string,
    options: AccountMergeVerifyOptions = {},
  ): Promise<AccountMergeVerifyResult> {
    const batchRows = normalizeRows<{ status: string }>(
      await this.db.execute(sql`
        select status
        from account_merge_batches
        where id = ${batchId}
      `),
    );
    if (batchRows.length === 0) {
      throw new Error('ACCOUNT_MERGE_VERIFY_BATCH_NOT_FOUND');
    }
    if (!['applied', 'verified', 'failed'].includes(batchRows[0].status)) {
      throw new Error('ACCOUNT_MERGE_VERIFY_BATCH_NOT_APPLIED');
    }

    const ledgerRows = normalizeRows<LedgerChangeRow>(
      await this.db.execute(sql`
        select
          table_name as "tableName",
          row_id as "rowId",
          source_user_id as "sourceUserId",
          target_user_id as "targetUserId",
          after_snapshot as "afterSnapshot"
        from account_merge_row_changes
        where batch_id = ${batchId}
      `),
    );
    if (ledgerRows.length === 0) {
      throw new Error('ACCOUNT_MERGE_VERIFY_LEDGER_EMPTY');
    }

    const sourceUserIds = uniqueSorted(
      ledgerRows.map((row) => row.sourceUserId),
    );
    const targetUserIds = uniqueSorted(
      ledgerRows.map((row) => row.targetUserId),
    );

    const sourceUsersWithReservations = await this.userIdsFromQuery(sql`
      select distinct user_id as "userId"
      from reservations
      where user_id in (${uuidSqlList(sourceUserIds)})
    `);
    const sourceUsersWithSocialLinks = await this.userIdsFromQuery(sql`
      select distinct user_id as "userId"
      from social_accounts
      where user_id in (${uuidSqlList(sourceUserIds)})
    `);
    const sourceUsersWithTermsAgreements = await this.userIdsFromQuery(sql`
      select distinct user_id as "userId"
      from terms_agreements
      where user_id in (${uuidSqlList(sourceUserIds)})
    `);
    const sourceUsersWithConsentAuditLogs = await this.userIdsFromQuery(sql`
      select distinct user_id as "userId"
      from consent_audit_logs
      where user_id in (${uuidSqlList(sourceUserIds)})
    `);
    const sourceUsersWithSupportThreads = await this.userIdsFromQuery(sql`
      select distinct user_id as "userId"
      from support_threads
      where user_id in (${uuidSqlList(sourceUserIds)})
    `);

    const resultWithoutSummary = {
      batchId,
      sourceUsersWithoutReservations: differenceSorted(
        sourceUserIds,
        sourceUsersWithReservations,
      ),
      sourceUsersWithoutSocialLinks: differenceSorted(
        sourceUserIds,
        sourceUsersWithSocialLinks,
      ),
      sourceUsersWithoutTermsAgreements: differenceSorted(
        sourceUserIds,
        sourceUsersWithTermsAgreements,
      ),
      sourceUsersWithoutConsentAuditLogs: differenceSorted(
        sourceUserIds,
        sourceUsersWithConsentAuditLogs,
      ),
      sourceUsersWithoutSupportThreads: differenceSorted(
        sourceUserIds,
        sourceUsersWithSupportThreads,
      ),
      sourceUsersWithPendingEmailVerificationTokens: await this.userIdsFromQuery(sql`
        select distinct user_id as "userId"
        from email_verification_tokens
        where user_id in (${uuidSqlList(sourceUserIds)})
          and consumed_at is null
      `),
      sourceUsersWithActiveRefreshTokens: await this.userIdsFromQuery(sql`
        select distinct user_id as "userId"
        from refresh_tokens
        where user_id in (${uuidSqlList(sourceUserIds)})
          and revoked_at is null
      `),
      sourceUsersMarkedMerged: await this.userIdsFromQuery(sql`
        select id as "userId"
        from users
        where id in (${uuidSqlList(sourceUserIds)})
          and account_status = 'merged'
      `),
      targetUsersWithReservations: await this.userIdsFromQuery(sql`
        select distinct user_id as "userId"
        from reservations
        where user_id in (${uuidSqlList(targetUserIds)})
      `),
      ledgerMismatches: await this.findLedgerMismatches(ledgerRows),
    };
    const failedChecks = verificationFailedChecks(
      resultWithoutSummary,
      sourceUserIds,
      targetUserIds,
    );
    const result = {
      ok: failedChecks.length === 0,
      failedChecks,
      ...resultWithoutSummary,
    };
    if (options.persist) {
      await this.persistVerificationSummary(batchId, result);
    }
    return result;
  }

  private async applyGroup(
    tx: AccountMergeTx,
    batchId: string,
    group: MergeGroup,
    now: Date,
    operatorUserId: string | null,
  ): Promise<AccountMergeReportRowChange[]> {
    await this.revalidateAndLockGroup(tx, group);

    const rowChanges: AccountMergeReportRowChange[] = [];
    for (const operation of moveOperations) {
      rowChanges.push(
        ...(await this.applyOperation(
          tx,
          batchId,
          group,
          operation,
          now,
          operatorUserId,
        )),
      );
    }
    return rowChanges;
  }

  private async revalidateAndLockGroup(
    tx: AccountMergeTx,
    group: MergeGroup,
  ): Promise<void> {
    const userIds = uniqueSorted([group.targetUserId, ...group.sourceUserIds]);
    if (userIds.length !== group.sourceUserIds.length + 1) {
      throw new Error('ACCOUNT_MERGE_INVALID_GROUP:source_target_overlap');
    }

    const rows = normalizeRows<{
      id: string;
      name: string;
      phone: string;
      birthDate: string;
      isPhoneVerified: boolean;
      accountStatus: string;
    }>(await tx.execute(sql`
      select
        id,
        name,
        phone,
        birth_date as "birthDate",
        is_phone_verified as "isPhoneVerified",
        account_status as "accountStatus"
      from users
      where id in (${uuidSqlList(userIds)})
      for update
    `));
    if (rows.length !== userIds.length) {
      throw new Error('ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:missing_user');
    }

    await tx.execute(sql`
      select id
      from reservations
      where user_id in (${uuidSqlList(userIds)})
      for update
    `);
    const reservationRows = normalizeRows<{
      userId: string;
      totalReservations: number;
      confirmedReservations: number;
      pendingPaymentReservations: number;
    }>(await tx.execute(sql`
      select
        user_id as "userId",
        count(*)::int as "totalReservations",
        count(*) filter (where status = 'CONFIRMED')::int as "confirmedReservations",
        count(*) filter (where status = 'PENDING_PAYMENT')::int as "pendingPaymentReservations"
      from reservations
      where user_id in (${uuidSqlList(userIds)})
      group by user_id
    `));
    const reservationCounts: Record<string, ReservationCounts> = {};
    for (const row of reservationRows) {
      reservationCounts[row.userId] = {
        total: Number(row.totalReservations),
        confirmed: Number(row.confirmedReservations),
        pendingPayment: Number(row.pendingPaymentReservations),
      };
    }

    const usersInGroup: MergeCandidateUser[] = [];
    for (const row of rows) {
      if (row.accountStatus !== 'active' || !row.isPhoneVerified) {
        throw new Error('ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:inactive_or_unverified');
      }
      if (buildMergeGroupKey(row) !== group.groupKey) {
        throw new Error('ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:identity_changed');
      }
      usersInGroup.push({
        id: row.id,
        name: row.name,
        phone: row.phone,
        birthDate: row.birthDate,
        isPhoneVerified: row.isPhoneVerified,
        accountStatus: row.accountStatus,
      });
      reservationCounts[row.id] ??= { total: 0, confirmed: 0 };
    }

    const classification = classifyDuplicateGroup({
      groupKey: group.groupKey,
      users: usersInGroup,
      reservationCounts,
    });

    if (group.origin === 'safe') {
      if (
        classification.kind !== 'safe' ||
        classification.targetUserId !== group.targetUserId ||
        !sameStringSet(classification.sourceUserIds, group.sourceUserIds)
      ) {
        throw new Error('ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:classification_changed');
      }
      return;
    }

    if (
      classification.kind !== 'manual_review' ||
      !sameStringSet(classification.userIds, [group.targetUserId, ...group.sourceUserIds])
    ) {
      throw new Error('ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:manual_review_changed');
    }
  }

  private async applyOperation(
    tx: AccountMergeTx,
    batchId: string,
    group: MergeGroup,
    operation: TableMoveOperation,
    now: Date,
    operatorUserId: string | null,
  ): Promise<AccountMergeReportRowChange[]> {
    const condition =
      operation.condition?.(group.sourceUserIds) ??
      inArray(operation.userIdColumn as never, group.sourceUserIds);
    const beforeRows = await tx.select().from(operation.table).where(condition);
    if (beforeRows.length === 0) {
      return [];
    }

    const changes = operation.changes(group.targetUserId, now, operatorUserId);
    const updatedRows = await tx
      .update(operation.table)
      .set(changes)
      .where(condition)
      .returning();
    if (updatedRows.length !== beforeRows.length) {
      throw new Error(
        `ACCOUNT_MERGE_ROW_COUNT_MISMATCH:${operation.tableName}`,
      );
    }

    const updatedRowsById = new Map(
      updatedRows.map((row, index) => [String(row.id ?? index), row]),
    );
    const rowChanges = beforeRows.map((row, index) => {
      const updatedRow = updatedRowsById.get(String(row.id ?? index)) ?? updatedRows[index];
      const beforeSnapshot = recoverySnapshot(operation.tableName, row);
      const afterSnapshot = recoverySnapshot(
        operation.tableName,
        updatedRow ?? { ...row, ...changes },
      );
      return {
        batchId,
        mergeGroupKey: group.groupKey,
        tableName: operation.tableName,
        rowId: String(row.id),
        sourceUserId: sourceUserIdFor(row),
        targetUserId: group.targetUserId,
        beforeSnapshot,
        afterSnapshot,
        expectedRowCount: 1,
        actualRowCount: 1,
      };
    });
    await tx.insert(accountMergeRowChanges).values(rowChanges).returning();
    return rowChanges.map(
      ({
        tableName,
        rowId,
        sourceUserId,
        targetUserId,
        beforeSnapshot,
        afterSnapshot,
      }) => ({
        tableName,
        rowId,
        sourceUserId,
        targetUserId,
        beforeSnapshot,
        afterSnapshot,
      }),
    );
  }

  private async userIdsFromQuery(query: SQLWrapper): Promise<string[]> {
    const rows = normalizeRows<{ userId: string }>(await this.db.execute(query));
    return uniqueSorted(rows.map((row) => row.userId));
  }

  private async findLedgerMismatches(changes: LedgerChangeRow[]): Promise<string[]> {
    const mismatches: string[] = [];
    for (const change of changes) {
      const rows = normalizeRows<Row>(
        await this.db.execute(ledgerVerificationQuery(change)),
      );
      if (rows.length === 0 || !ledgerSnapshotMatches(change, rows[0])) {
        mismatches.push(`${change.tableName}:${change.rowId}`);
      }
    }
    return mismatches.sort();
  }

  private async persistVerificationSummary(
    batchId: string,
    verification: AccountMergeVerifyResult,
  ): Promise<void> {
    await this.db.execute(sql`
      update account_merge_batches
      set
        status = ${verification.ok ? 'verified' : 'failed'}::account_merge_batch_status,
        verification_summary = ${JSON.stringify({
          ok: verification.ok,
          failedChecks: verification.failedChecks,
          ledgerMismatches: verification.ledgerMismatches.length,
          sourceUsersWithActiveRefreshTokens:
            verification.sourceUsersWithActiveRefreshTokens.length,
          sourceUsersWithPendingEmailVerificationTokens:
            verification.sourceUsersWithPendingEmailVerificationTokens.length,
        })}::jsonb,
        verified_at = now()
      where id = ${batchId}::uuid
    `);
  }
}

const moveOperations: TableMoveOperation[] = [
  userIdMove(reservations, reservations.userId),
  userIdMove(socialAccounts, socialAccounts.userId),
  userIdMove(termsAgreements, termsAgreements.userId),
  userIdMove(consentAuditLogs, consentAuditLogs.userId),
  userIdMove(supportThreads, supportThreads.userId),
  {
    table: refreshTokens,
    tableName: getTableName(refreshTokens),
    userIdColumn: refreshTokens.userId,
    changes: (_targetUserId, now) => ({ revokedAt: now }),
    condition: (sourceUserIds) =>
      and(
        inArray(refreshTokens.userId, sourceUserIds),
        isNull(refreshTokens.revokedAt),
      ),
  },
  {
    table: emailVerificationTokens,
    tableName: getTableName(emailVerificationTokens),
    userIdColumn: emailVerificationTokens.userId,
    changes: (_targetUserId, now) => ({ consumedAt: now }),
    condition: (sourceUserIds) =>
      and(
        inArray(emailVerificationTokens.userId, sourceUserIds),
        isNull(emailVerificationTokens.consumedAt),
      ),
  },
  {
    table: users,
    tableName: getTableName(users),
    userIdColumn: users.id,
    changes: (targetUserId, now, operatorUserId) => ({
      accountStatus: 'merged',
      marketingConsent: false,
      updatedAt: now,
      withdrawalReason: `merged into ${targetUserId}`,
      withdrawalSource: 'admin',
      withdrawnByUserId: operatorUserId,
    }),
    condition: (sourceUserIds) => inArray(users.id, sourceUserIds),
  },
];

const movedOwnershipTables: string[] = [
  getTableName(reservations),
  getTableName(socialAccounts),
  getTableName(termsAgreements),
  getTableName(consentAuditLogs),
  getTableName(supportThreads),
];

function userIdMove(table: unknown, userIdColumn: unknown): TableMoveOperation {
  return {
    table,
    tableName: getTableName(table as never),
    userIdColumn,
    changes: (targetUserId) => ({ userId: targetUserId }),
  };
}

function normalizeRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function buildManualApplyGroups(
  manualReviewGroups: Array<Extract<MergeClassification, { kind: 'manual_review' }>>,
  manualAllowlist: ManualMergeAllowlistEntry[],
): MergeGroup[] {
  const manualReviewByKey = new Map(
    manualReviewGroups.map((group) => [group.groupKey, group]),
  );

  return manualAllowlist.map((entry) => {
    const reviewGroup = manualReviewByKey.get(entry.groupKey);
    if (!reviewGroup) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_GROUP_NOT_FOUND');
    }

    const sourceUserIds = uniqueSorted(entry.sourceUserIds);
    if (sourceUserIds.length === 0) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_SOURCES_REQUIRED');
    }
    if (sourceUserIds.length !== entry.sourceUserIds.length) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_DUPLICATE_SOURCE');
    }
    if (sourceUserIds.includes(entry.targetUserId)) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_SOURCE_TARGET_OVERLAP');
    }

    const reviewUserIds = new Set(reviewGroup.userIds);
    if (!reviewUserIds.has(entry.targetUserId)) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_TARGET_NOT_IN_GROUP');
    }
    for (const sourceUserId of sourceUserIds) {
      if (!reviewUserIds.has(sourceUserId)) {
        throw new Error('ACCOUNT_MERGE_ALLOWLIST_SOURCE_NOT_IN_GROUP');
      }
    }

    const allowlistedUserIds = new Set([entry.targetUserId, ...sourceUserIds]);
    if (allowlistedUserIds.size !== reviewUserIds.size) {
      throw new Error('ACCOUNT_MERGE_ALLOWLIST_INCOMPLETE_GROUP');
    }

    return {
      groupKey: entry.groupKey,
      targetUserId: entry.targetUserId,
      sourceUserIds,
      origin: 'manual',
    };
  });
}

function assertApplyHashes(
  dryRun: AccountMergeDryRunResult,
  options: AccountMergeApplyOptions,
): void {
  if (options.dryRunHash !== hashAccountMergeDryRun(dryRun)) {
    throw new Error('ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH');
  }

  const allowlistHash = hashJson(options.manualAllowlist);
  if (
    (options.manualAllowlist.length > 0 || options.allowlistHash !== null) &&
    options.allowlistHash !== allowlistHash
  ) {
    throw new Error('ACCOUNT_MERGE_ALLOWLIST_HASH_MISMATCH');
  }
}

function normalizeCandidateRow(row: CandidateRow): CandidateRow {
  return {
    groupKey: String(row.groupKey),
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    birthDate: String(row.birthDate),
    isPhoneVerified: Boolean(row.isPhoneVerified),
    accountStatus: String(row.accountStatus),
    totalReservations: Number(row.totalReservations),
    confirmedReservations: Number(row.confirmedReservations),
    pendingPaymentReservations: Number(row.pendingPaymentReservations ?? 0),
  };
}

function recoverySnapshot(tableName: string, row: Row): Record<string, unknown> {
  if (movedOwnershipTables.includes(tableName)) {
    return {
      id: row.id ?? null,
      userId: row.userId ?? null,
    };
  }
  if (tableName === getTableName(refreshTokens)) {
    return {
      id: row.id ?? null,
      userId: row.userId ?? null,
      revokedAt: row.revokedAt ?? null,
    };
  }
  if (tableName === getTableName(emailVerificationTokens)) {
    return {
      id: row.id ?? null,
      userId: row.userId ?? null,
      consumedAt: row.consumedAt ?? null,
    };
  }
  if (tableName === getTableName(users)) {
    return {
      id: row.id ?? null,
      accountStatus: row.accountStatus ?? null,
      marketingConsent: row.marketingConsent ?? null,
      withdrawalReason: row.withdrawalReason ?? null,
      withdrawalSource: row.withdrawalSource ?? null,
      withdrawnByUserId: row.withdrawnByUserId ?? null,
    };
  }
  return {
    id: row.id ?? null,
  };
}

function verificationFailedChecks(
  verification: Omit<AccountMergeVerifyResult, 'ok' | 'failedChecks'>,
  sourceUserIds: string[],
  targetUserIds: string[],
): string[] {
  const failedChecks: string[] = [];
  if (!sameStringSet(verification.sourceUsersWithoutReservations, sourceUserIds)) {
    failedChecks.push('source_reservations_remaining');
  }
  if (!sameStringSet(verification.sourceUsersWithoutSocialLinks, sourceUserIds)) {
    failedChecks.push('source_social_links_remaining');
  }
  if (!sameStringSet(verification.sourceUsersWithoutTermsAgreements, sourceUserIds)) {
    failedChecks.push('source_terms_agreements_remaining');
  }
  if (!sameStringSet(verification.sourceUsersWithoutConsentAuditLogs, sourceUserIds)) {
    failedChecks.push('source_consent_audit_logs_remaining');
  }
  if (!sameStringSet(verification.sourceUsersWithoutSupportThreads, sourceUserIds)) {
    failedChecks.push('source_support_threads_remaining');
  }
  if (verification.sourceUsersWithPendingEmailVerificationTokens.length > 0) {
    failedChecks.push('source_pending_email_verification_tokens');
  }
  if (verification.sourceUsersWithActiveRefreshTokens.length > 0) {
    failedChecks.push('source_active_refresh_tokens');
  }
  if (!sameStringSet(verification.sourceUsersMarkedMerged, sourceUserIds)) {
    failedChecks.push('source_users_not_marked_merged');
  }
  if (!targetUserIds.every((userId) => verification.targetUsersWithReservations.includes(userId))) {
    failedChecks.push('target_reservations_missing');
  }
  if (verification.ledgerMismatches.length > 0) {
    failedChecks.push('ledger_mismatches');
  }
  return failedChecks.sort();
}

function sourceUserIdFor(row: Row): string {
  if (typeof row.userId === 'string') {
    return row.userId;
  }
  if (typeof row.id === 'string') {
    return row.id;
  }
  return String(row.userId ?? row.id);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function differenceSorted(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort();
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && uniqueSorted(left).join('|') === uniqueSorted(right).join('|');
}

function uuidSqlList(values: string[]): SQLWrapper {
  if (values.length === 0) {
    return sql`null::uuid`;
  }

  return sql.join(values.map((value) => sql`${value}::uuid`), sql`, `);
}

function ledgerVerificationQuery(change: LedgerChangeRow): SQLWrapper {
  if (change.tableName === getTableName(reservations)) {
    return sql`
      select id::text as id, user_id::text as "userId"
      from reservations
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(socialAccounts)) {
    return sql`
      select id::text as id, user_id::text as "userId"
      from social_accounts
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(termsAgreements)) {
    return sql`
      select id::text as id, user_id::text as "userId"
      from terms_agreements
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(consentAuditLogs)) {
    return sql`
      select id::text as id, user_id::text as "userId"
      from consent_audit_logs
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(supportThreads)) {
    return sql`
      select id::text as id, user_id::text as "userId"
      from support_threads
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(refreshTokens)) {
    return sql`
      select id::text as id, revoked_at as "revokedAt"
      from refresh_tokens
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(emailVerificationTokens)) {
    return sql`
      select id::text as id, consumed_at as "consumedAt"
      from email_verification_tokens
      where id = ${change.rowId}::uuid
    `;
  }
  if (change.tableName === getTableName(users)) {
    return sql`
      select
        id::text as id,
        account_status as "accountStatus",
        marketing_consent as "marketingConsent",
        withdrawal_reason as "withdrawalReason",
        withdrawal_source as "withdrawalSource",
        withdrawn_by_user_id::text as "withdrawnByUserId"
      from users
      where id = ${change.rowId}::uuid
    `;
  }

  return sql`select null where false`;
}

function ledgerSnapshotMatches(
  change: LedgerChangeRow,
  currentRow: Row,
): boolean {
  if (change.tableName === getTableName(refreshTokens)) {
    return (
      currentRow.revokedAt !== null &&
      currentRow.revokedAt !== undefined &&
      snapshotFieldMatches(change.afterSnapshot, currentRow, 'revokedAt')
    );
  }

  if (change.tableName === getTableName(emailVerificationTokens)) {
    return (
      currentRow.consumedAt !== null &&
      currentRow.consumedAt !== undefined &&
      snapshotFieldMatches(change.afterSnapshot, currentRow, 'consumedAt')
    );
  }

  if (change.tableName === getTableName(users)) {
    return [
      'accountStatus',
      'marketingConsent',
      'withdrawalReason',
      'withdrawalSource',
      'withdrawnByUserId',
    ].every((field) =>
      snapshotFieldMatches(change.afterSnapshot, currentRow, field),
    );
  }

  if (
    movedOwnershipTables.includes(change.tableName)
  ) {
    return (
      currentRow.userId === change.targetUserId &&
      snapshotFieldMatches(change.afterSnapshot, currentRow, 'userId')
    );
  }

  return false;
}

function snapshotFieldMatches(
  afterSnapshot: Record<string, unknown>,
  currentRow: Row,
  field: string,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(afterSnapshot, field)) {
    return false;
  }

  return (
    normalizeComparable(afterSnapshot[field]) ===
    normalizeComparable(currentRow[field])
  );
}

function normalizeComparable(value: unknown): string | number | boolean | null {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const timestamp = normalizeTimestampString(value);
    return timestamp ?? value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null) {
    return null;
  }
  return String(value);
}

function normalizeTimestampString(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.test(value)) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}
