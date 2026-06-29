import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

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
  AccountMergeService,
  type ManualMergeAllowlistEntry,
} from './account-merge.service.js';
import { hashJson } from './account-merge-policy.js';

type Row = Record<string, unknown>;

interface RecordingDbOptions {
  executeRows?: unknown[][];
  tableRows?: Record<string, Row[]>;
  updateActualCounts?: Record<string, number>;
}

function tableName(table: unknown): string {
  return getTableName(table as never);
}

function createRecordingDb(options: RecordingDbOptions = {}) {
  const executeRows = [...(options.executeRows ?? [])];
  const tx = createRecordingTx(options, executeRows);
  const db = {
    execute: vi.fn().mockImplementation(async () => ({
      rows: executeRows.shift() ?? [],
    })),
    transaction: vi.fn().mockImplementation(async (callback) => callback(tx)),
  };

  return { db, tx };
}

function createRecordingTx(options: RecordingDbOptions, executeRows: unknown[][]) {
  const tableRows = options.tableRows ?? {};
  const insertedBatches: Row[] = [];
  const insertedRowChanges: Row[] = [];
  const updateCalls: Array<{ tableName: string; values: Row }> = [];

  const tx = {
    insertedBatches,
    insertedRowChanges,
    updateCalls,
    execute: vi.fn().mockImplementation(async () => ({
      rows: executeRows.shift() ?? [],
    })),
    select: vi.fn().mockImplementation(() => ({
      from: (table: unknown) => ({
        where: async () => [...(tableRows[tableName(table)] ?? [])],
      }),
    })),
    update: vi.fn().mockImplementation((table: unknown) => {
      const name = tableName(table);
      return {
        set: (values: Row) => ({
          where: () => ({
            returning: async () => {
              updateCalls.push({ tableName: name, values });
              const rows = tableRows[name] ?? [];
              const actualCount =
                options.updateActualCounts?.[name] ?? rows.length;
              return rows.slice(0, actualCount).map((row) => ({
                ...row,
                ...values,
                returnedMarker: `${name}-returned`,
              }));
            },
          }),
        }),
      };
    }),
    insert: vi.fn().mockImplementation((table: unknown) => {
      const name = tableName(table);
      return {
        values: (values: Row | Row[]) => ({
          returning: async () => {
            const rows = Array.isArray(values) ? values : [values];
            if (name === tableName(accountMergeBatches)) {
              insertedBatches.push(...rows);
              return rows.map((row, index) => ({
                id: `batch-${index + 1}`,
                ...row,
              }));
            }
            if (name === tableName(accountMergeRowChanges)) {
              insertedRowChanges.push(...rows);
            }
            return rows;
          },
        }),
      };
    }),
  };

  return tx;
}

function candidateRows() {
  return [
    {
      groupKey: '821012345678|1995-05-15|hong',
      id: 'source-safe',
      name: 'Hong',
      phone: '+82 10-1234-5678',
      birthDate: '1995-05-15',
      isPhoneVerified: true,
      accountStatus: 'active',
      totalReservations: 0,
      confirmedReservations: 0,
    },
    {
      groupKey: '821012345678|1995-05-15|hong',
      id: 'target-safe',
      name: 'Hong',
      phone: '+82 10-1234-5678',
      birthDate: '1995-05-15',
      isPhoneVerified: true,
      accountStatus: 'active',
      totalReservations: 2,
      confirmedReservations: 1,
    },
    {
      groupKey: '821055556666|1991-02-03|kim',
      id: 'manual-a',
      name: 'Kim',
      phone: '+82 10-5555-6666',
      birthDate: '1991-02-03',
      isPhoneVerified: true,
      accountStatus: 'active',
      totalReservations: 1,
      confirmedReservations: 1,
    },
    {
      groupKey: '821055556666|1991-02-03|kim',
      id: 'manual-b',
      name: 'Kim',
      phone: '+82 10-5555-6666',
      birthDate: '1991-02-03',
      isPhoneVerified: true,
      accountStatus: 'active',
      totalReservations: 1,
      confirmedReservations: 1,
    },
	  ];
}

function incompleteIdentityRows() {
  return [
    {
      groupKey: '821099998888|1993-04-05|lee',
      id: 'inactive-1',
      name: 'Lee',
      phone: '+82 10-9999-8888',
      birthDate: '1993-04-05',
      isPhoneVerified: true,
      accountStatus: 'merged',
      totalReservations: 1,
      confirmedReservations: 0,
    },
    {
      groupKey: '821099998888|1993-04-05|lee',
      id: 'active-1',
      name: 'Lee',
      phone: '+82 10-9999-8888',
      birthDate: '1993-04-05',
      isPhoneVerified: true,
      accountStatus: 'active',
      totalReservations: 0,
      confirmedReservations: 0,
    },
  ];
}

function safeRevalidationRows() {
  return [
    {
      id: 'source-safe',
      name: 'Hong',
      phone: '+82 10-1234-5678',
      birthDate: '1995-05-15',
      isPhoneVerified: true,
      accountStatus: 'active',
    },
    {
      id: 'target-safe',
      name: 'Hong',
      phone: '+82 10-1234-5678',
      birthDate: '1995-05-15',
      isPhoneVerified: true,
      accountStatus: 'active',
    },
  ];
}

function safeReservationCountRows() {
  return [
    {
      userId: 'source-safe',
      totalReservations: 0,
      confirmedReservations: 0,
    },
    {
      userId: 'target-safe',
      totalReservations: 2,
      confirmedReservations: 1,
    },
  ];
}

function manualCandidateRows() {
  return candidateRows().filter((row) => row.name === 'Kim');
}

function manualRevalidationRows() {
  return [
    {
      id: 'manual-b',
      name: 'Kim',
      phone: '+82 10-5555-6666',
      birthDate: '1991-02-03',
      isPhoneVerified: true,
      accountStatus: 'active',
    },
    {
      id: 'manual-a',
      name: 'Kim',
      phone: '+82 10-5555-6666',
      birthDate: '1991-02-03',
      isPhoneVerified: true,
      accountStatus: 'active',
    },
  ];
}

function manualReservationCountRows() {
  return [
    {
      userId: 'manual-b',
      totalReservations: 1,
      confirmedReservations: 1,
    },
    {
      userId: 'manual-a',
      totalReservations: 1,
      confirmedReservations: 1,
    },
  ];
}

function safeDryRunHash(manualAllowlist: ManualMergeAllowlistEntry[] = []) {
  return hashJson({
    generatedAt: new Date(0),
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
    manualAllowlist,
  });
}

function manualDryRunHash(manualAllowlist: ManualMergeAllowlistEntry[] = []) {
  return hashJson({
    generatedAt: new Date(0),
    safeGroups: [],
    manualReviewGroups: [
      {
        kind: 'manual_review',
        groupKey: '821055556666|1991-02-03|kim',
        reason: 'multiple_confirmed_owners',
        userIds: ['manual-a', 'manual-b'],
      },
    ],
    manualAllowlist,
  });
}

function applyOptions(
  overrides: Partial<Parameters<AccountMergeService['apply']>[0]> = {},
) {
  return {
    operatorUserId: 'operator-1',
    reason: 'dedupe verified duplicate accounts',
    backupReference: 'gs://backup/account-merge.sql',
    reportPath: '/tmp/account-merge-report.json',
    dryRunHash: safeDryRunHash(),
    allowlistHash: null,
    manualAllowlist: [],
    ...overrides,
  };
}

function rowsForSource(sourceUserId = 'source-safe') {
  return {
    [tableName(reservations)]: [{ id: 'reservation-1', userId: sourceUserId }],
    [tableName(socialAccounts)]: [{ id: 'social-1', userId: sourceUserId }],
    [tableName(termsAgreements)]: [{ id: 'terms-1', userId: sourceUserId }],
    [tableName(consentAuditLogs)]: [{ id: 'consent-1', userId: sourceUserId }],
    [tableName(supportThreads)]: [{ id: 'support-1', userId: sourceUserId }],
    [tableName(refreshTokens)]: [
      { id: 'refresh-1', userId: sourceUserId, revokedAt: null },
    ],
    [tableName(emailVerificationTokens)]: [
      { id: 'email-token-1', userId: sourceUserId, consumedAt: null },
    ],
    [tableName(users)]: [
      {
        id: sourceUserId,
        accountStatus: 'active',
        marketingConsent: true,
        withdrawalReason: null,
      },
    ],
  };
}

describe('AccountMergeService', () => {
  it('dry-run classifies safe and manual review groups from duplicate identities', async () => {
    const { db } = createRecordingDb({ executeRows: [candidateRows()] });
    const service = new AccountMergeService(db as never);

    const result = await service.dryRun({});

    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.safeGroups).toEqual([
      {
        kind: 'safe',
        groupKey: '821012345678|1995-05-15|hong',
        targetUserId: 'target-safe',
        sourceUserIds: ['source-safe'],
      },
    ]);
    expect(result.manualReviewGroups).toEqual([
      {
        kind: 'manual_review',
        groupKey: '821055556666|1991-02-03|kim',
        reason: 'multiple_confirmed_owners',
        userIds: ['manual-a', 'manual-b'],
      },
    ]);
    expect(result.manualAllowlist).toEqual([]);
  });

  it('dry-run reports incomplete identity duplicate groups for manual review', async () => {
    const { db } = createRecordingDb({ executeRows: [incompleteIdentityRows()] });
    const service = new AccountMergeService(db as never);

    const result = await service.dryRun({});

    expect(result.safeGroups).toEqual([]);
    expect(result.manualReviewGroups).toEqual([
      {
        kind: 'manual_review',
        groupKey: '821099998888|1993-04-05|lee',
        reason: 'identity_evidence_incomplete',
        userIds: ['active-1', 'inactive-1'],
      },
    ]);
  });

  it('dry-run returns included manual allowlist entries for operator reports', async () => {
    const manualAllowlist: ManualMergeAllowlistEntry[] = [
      {
        groupKey: 'manual-group',
        targetUserId: 'manual-target',
        sourceUserIds: ['manual-source'],
        reason: 'operator reviewed duplicate social signup',
      },
    ];
    const { db } = createRecordingDb({ executeRows: [[]] });
    const service = new AccountMergeService(db as never);

    const result = await service.dryRun({ includeManualAllowlist: manualAllowlist });

    expect(result.manualAllowlist).toEqual(manualAllowlist);
  });

  it('applies a safe merge by moving buyer-owned rows and revoking source sessions in the expected order', async () => {
    const { db, tx } = createRecordingDb({
      executeRows: [candidateRows(), safeRevalidationRows(), [], safeReservationCountRows()],
      tableRows: rowsForSource(),
    });
    const service = new AccountMergeService(db as never);

    await service.apply(applyOptions());

    expect(tx.updateCalls.map((call) => call.tableName)).toEqual([
      'reservations',
      'social_accounts',
      'terms_agreements',
      'consent_audit_logs',
      'support_threads',
      'refresh_tokens',
      'email_verification_tokens',
      'users',
    ]);
    expect(tx.updateCalls[0]).toMatchObject({
      tableName: 'reservations',
      values: { userId: 'target-safe' },
    });
    expect(tx.updateCalls[5]).toMatchObject({
      tableName: 'refresh_tokens',
      values: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects apply when the supplied dry-run hash is not the current dry-run hash', async () => {
    const { db, tx } = createRecordingDb({
      executeRows: [candidateRows()],
      tableRows: rowsForSource(),
    });
    const service = new AccountMergeService(db as never);

    await expect(
      service.apply(applyOptions({ dryRunHash: 'stale-dry-run-hash' })),
    ).rejects.toThrow('ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH');
    expect(tx.updateCalls).toEqual([]);
  });

  it('rejects apply when the current dry-run has no mergeable groups', async () => {
    const emptyDryRun = {
      generatedAt: new Date(0),
      safeGroups: [],
      manualReviewGroups: [],
      manualAllowlist: [],
    };
    const { db, tx } = createRecordingDb({ executeRows: [[]] });
    const service = new AccountMergeService(db as never);

    await expect(
      service.apply(
        applyOptions({
          dryRunHash: hashJson(emptyDryRun),
        }),
      ),
    ).rejects.toThrow('ACCOUNT_MERGE_NO_GROUPS_TO_APPLY');
    expect(tx.insertedBatches).toEqual([]);
    expect(tx.updateCalls).toEqual([]);
  });

  it('applies a manual allowlist merge with explicit target and sources', async () => {
    const manualAllowlist: ManualMergeAllowlistEntry[] = [
      {
        groupKey: '821055556666|1991-02-03|kim',
        targetUserId: 'manual-a',
        sourceUserIds: ['manual-b'],
        reason: 'operator reviewed duplicate social signup',
      },
    ];
    const allowlistHash = hashJson(manualAllowlist);
    const { db, tx } = createRecordingDb({
      executeRows: [
        manualCandidateRows(),
        manualRevalidationRows(),
        [],
        manualReservationCountRows(),
      ],
      tableRows: rowsForSource('manual-b'),
    });
    const service = new AccountMergeService(db as never);

    const result = await service.apply(
      applyOptions({
        dryRunHash: manualDryRunHash(manualAllowlist),
        allowlistHash,
        manualAllowlist,
      }),
    );

    expect(result).toMatchObject({
      batchId: 'batch-1',
      mergedGroups: 1,
      mergedSourceUsers: 1,
    });
    expect(tx.insertedBatches[0]).toMatchObject({
      status: 'applied',
      allowlistHash,
      aggregateCounts: {
        safeGroups: 0,
        manualAllowlistGroups: 1,
        mergedGroups: 1,
        mergedSourceUsers: 1,
      },
    });
    expect(tx.updateCalls[0]).toMatchObject({
      tableName: 'reservations',
      values: { userId: 'manual-a' },
    });
  });

  it('rejects apply when the supplied manual allowlist hash is stale', async () => {
    const manualAllowlist: ManualMergeAllowlistEntry[] = [
      {
        groupKey: '821055556666|1991-02-03|kim',
        targetUserId: 'manual-a',
        sourceUserIds: ['manual-b'],
        reason: 'operator reviewed duplicate social signup',
      },
    ];
    const { db, tx } = createRecordingDb({
      executeRows: [manualCandidateRows()],
      tableRows: rowsForSource('manual-b'),
    });
    const service = new AccountMergeService(db as never);

    await expect(
      service.apply(
        applyOptions({
          dryRunHash: manualDryRunHash(manualAllowlist),
          allowlistHash: 'stale-allowlist-hash',
          manualAllowlist,
        }),
      ),
    ).rejects.toThrow('ACCOUNT_MERGE_ALLOWLIST_HASH_MISMATCH');
    expect(tx.updateCalls).toEqual([]);
  });

  it('rejects manual allowlist entries outside the current manual review group', async () => {
    const manualAllowlist: ManualMergeAllowlistEntry[] = [
      {
        groupKey: '821055556666|1991-02-03|kim',
        targetUserId: 'manual-a',
        sourceUserIds: ['unrelated-source'],
        reason: 'operator reviewed duplicate social signup',
      },
    ];
    const { db } = createRecordingDb({ executeRows: [manualCandidateRows()] });
    const service = new AccountMergeService(db as never);

    await expect(
      service.apply(
        applyOptions({
          dryRunHash: manualDryRunHash(manualAllowlist),
          allowlistHash: hashJson(manualAllowlist),
          manualAllowlist,
        }),
      ),
    ).rejects.toThrow('ACCOUNT_MERGE_ALLOWLIST_SOURCE_NOT_IN_GROUP');
  });

  it('aborts before row moves when transaction revalidation finds an inactive account', async () => {
    const { db, tx } = createRecordingDb({
      executeRows: [
        candidateRows(),
        [
          {
            id: 'source-safe',
            name: 'Hong',
            phone: '+82 10-1234-5678',
            birthDate: '1995-05-15',
            isPhoneVerified: true,
            accountStatus: 'active',
          },
          {
            id: 'target-safe',
            name: 'Hong',
            phone: '+82 10-1234-5678',
            birthDate: '1995-05-15',
            isPhoneVerified: true,
            accountStatus: 'merged',
          },
        ],
      ],
      tableRows: rowsForSource(),
    });
    const service = new AccountMergeService(db as never);

    await expect(service.apply(applyOptions())).rejects.toThrow(
      'ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:inactive_or_unverified',
    );
    expect(tx.updateCalls).toEqual([]);
    expect(tx.insertedRowChanges).toEqual([]);
  });

  it('marks source accounts as merged and writes row-level recovery records', async () => {
    const { db, tx } = createRecordingDb({
      executeRows: [candidateRows(), safeRevalidationRows(), [], safeReservationCountRows()],
      tableRows: rowsForSource(),
    });
    const service = new AccountMergeService(db as never);

    await service.apply(applyOptions());

    const userUpdate = tx.updateCalls.find(
      (call) => call.tableName === 'users',
    );
    expect(userUpdate?.values).toMatchObject({
      accountStatus: 'merged',
      marketingConsent: false,
      withdrawalReason: 'merged into target-safe',
      withdrawalSource: 'admin',
      withdrawnByUserId: 'operator-1',
      updatedAt: expect.any(Date),
    });
    expect(tx.insertedRowChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'reservations',
          rowId: 'reservation-1',
          sourceUserId: 'source-safe',
          targetUserId: 'target-safe',
          beforeSnapshot: expect.objectContaining({ userId: 'source-safe' }),
          afterSnapshot: expect.objectContaining({
            returnedMarker: 'reservations-returned',
            userId: 'target-safe',
          }),
          expectedRowCount: 1,
          actualRowCount: 1,
        }),
        expect.objectContaining({
          tableName: 'users',
          rowId: 'source-safe',
          beforeSnapshot: expect.objectContaining({ accountStatus: 'active' }),
          afterSnapshot: expect.objectContaining({
            accountStatus: 'merged',
            marketingConsent: false,
          }),
        }),
      ]),
    );
  });

  it('rolls back and throws when update row count differs from expected', async () => {
    const { db } = createRecordingDb({
      executeRows: [candidateRows(), safeRevalidationRows(), [], safeReservationCountRows()],
      tableRows: rowsForSource(),
      updateActualCounts: { reservations: 0 },
    });
    const service = new AccountMergeService(db as never);

    await expect(service.apply(applyOptions())).rejects.toThrow(
      'ACCOUNT_MERGE_ROW_COUNT_MISMATCH:reservations',
    );
  });

  it('aborts before row moves when transaction reservation counts change classification', async () => {
    const { db, tx } = createRecordingDb({
      executeRows: [
        candidateRows(),
        safeRevalidationRows(),
        [],
        [
          {
            userId: 'source-safe',
            totalReservations: 1,
            confirmedReservations: 1,
          },
          {
            userId: 'target-safe',
            totalReservations: 2,
            confirmedReservations: 1,
          },
        ],
      ],
      tableRows: rowsForSource(),
    });
    const service = new AccountMergeService(db as never);

    await expect(service.apply(applyOptions())).rejects.toThrow(
      'ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:classification_changed',
    );
    expect(tx.updateCalls).toEqual([]);
  });

  it('rejects verify when the batch does not exist', async () => {
    const { db } = createRecordingDb({ executeRows: [[]] });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('missing-batch')).rejects.toThrow(
      'ACCOUNT_MERGE_VERIFY_BATCH_NOT_FOUND',
    );
  });

  it('rejects verify when an applied batch has no row-level ledger', async () => {
    const { db } = createRecordingDb({
      executeRows: [[{ status: 'applied' }], []],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).rejects.toThrow(
      'ACCOUNT_MERGE_VERIFY_LEDGER_EMPTY',
    );
  });

  it('verifies target visibility and source cleanup after a batch', async () => {
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'reservations',
            rowId: 'reservation-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { userId: 'target-safe' },
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [{ userId: 'source-with-pending-email' }],
        [{ userId: 'source-with-token' }],
        [{ userId: 'source-safe' }],
        [{ userId: 'target-safe' }],
        [{ id: 'reservation-1', userId: 'target-safe' }],
      ],
    });
    const service = new AccountMergeService(db as never);

    const result = await service.verify('batch-1');

    expect(result).toEqual({
      batchId: 'batch-1',
      sourceUsersWithoutReservations: ['source-safe'],
      sourceUsersWithoutSocialLinks: ['source-safe'],
      sourceUsersWithoutTermsAgreements: ['source-safe'],
      sourceUsersWithoutConsentAuditLogs: ['source-safe'],
      sourceUsersWithoutSupportThreads: ['source-safe'],
      sourceUsersWithPendingEmailVerificationTokens: ['source-with-pending-email'],
      sourceUsersWithActiveRefreshTokens: ['source-with-token'],
      sourceUsersMarkedMerged: ['source-safe'],
      targetUsersWithReservations: ['target-safe'],
      ledgerMismatches: [],
    });
  });

  it('reports ledger mismatches when a changed row is not on its recorded target', async () => {
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'reservations',
            rowId: 'reservation-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { userId: 'target-safe' },
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ userId: 'source-safe' }],
        [{ userId: 'target-safe' }],
        [{ id: 'reservation-1', userId: 'other-target' }],
      ],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).resolves.toMatchObject({
      ledgerMismatches: ['reservations:reservation-1'],
    });
  });

  it('reports ledger mismatches when a required recovery snapshot field is missing', async () => {
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'reservations',
            rowId: 'reservation-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: {},
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ id: 'reservation-1', userId: 'target-safe' }],
      ],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).resolves.toMatchObject({
      ledgerMismatches: ['reservations:reservation-1'],
    });
  });

  it('reports ledger mismatches when token recovery timestamps are missing', async () => {
    const timestamp = new Date('2026-06-29T00:00:00.000Z');
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'refresh_tokens',
            rowId: 'refresh-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { revokedAt: timestamp },
          },
          {
            tableName: 'email_verification_tokens',
            rowId: 'email-token-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { consumedAt: timestamp },
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ id: 'refresh-1', revokedAt: null }],
        [{ id: 'email-token-1', consumedAt: null }],
      ],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).resolves.toMatchObject({
      ledgerMismatches: [
        'email_verification_tokens:email-token-1',
        'refresh_tokens:refresh-1',
      ],
    });
  });

  it('reports ledger mismatches when token recovery timestamps differ from the snapshot', async () => {
    const timestamp = new Date('2026-06-29T00:00:00.000Z');
    const staleTimestamp = new Date('2026-06-29T00:01:00.000Z');
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'refresh_tokens',
            rowId: 'refresh-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { revokedAt: timestamp },
          },
          {
            tableName: 'email_verification_tokens',
            rowId: 'email-token-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { consumedAt: timestamp },
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ id: 'refresh-1', revokedAt: staleTimestamp }],
        [{ id: 'email-token-1', consumedAt: staleTimestamp }],
      ],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).resolves.toMatchObject({
      ledgerMismatches: [
        'email_verification_tokens:email-token-1',
        'refresh_tokens:refresh-1',
      ],
    });
  });

  it('accepts equivalent postgres and ISO timestamp strings in token recovery snapshots', async () => {
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'refresh_tokens',
            rowId: 'refresh-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { revokedAt: '2026-06-29T04:46:37.337Z' },
          },
          {
            tableName: 'email_verification_tokens',
            rowId: 'email-token-1',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: { consumedAt: '2026-06-29T04:46:37.337Z' },
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ userId: 'source-safe' }],
        [],
        [{ id: 'refresh-1', revokedAt: '2026-06-29 04:46:37.337+00' }],
        [
          {
            id: 'email-token-1',
            consumedAt: '2026-06-29 04:46:37.337+00',
          },
        ],
      ],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).resolves.toMatchObject({
      ledgerMismatches: [],
    });
  });

  it('reports ledger mismatches when a row exists but differs from the recovery snapshot', async () => {
    const { db } = createRecordingDb({
      executeRows: [
        [{ status: 'applied' }],
        [
          {
            tableName: 'users',
            rowId: 'source-safe',
            sourceUserId: 'source-safe',
            targetUserId: 'target-safe',
            afterSnapshot: {
              accountStatus: 'merged',
              marketingConsent: false,
              withdrawalReason: 'merged into target-safe',
              withdrawalSource: 'admin',
              withdrawnByUserId: 'operator-1',
            },
          },
        ],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [{ userId: 'source-safe' }],
        [{ userId: 'target-safe' }],
        [
          {
            id: 'source-safe',
            accountStatus: 'merged',
            marketingConsent: true,
            withdrawalReason: 'merged into target-safe',
            withdrawalSource: 'admin',
            withdrawnByUserId: 'operator-1',
          },
        ],
      ],
    });
    const service = new AccountMergeService(db as never);

    await expect(service.verify('batch-1')).resolves.toMatchObject({
      ledgerMismatches: ['users:source-safe'],
    });
  });
});
