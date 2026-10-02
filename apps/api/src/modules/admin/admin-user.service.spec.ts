import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ZodError } from 'zod';
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  type AdminUserDetail,
} from '@grabit/shared';

import type { AdminAuditService } from './admin-audit.service.js';
import { AdminUserService } from './admin-user.service.js';

function userRow(overrides: Partial<{
  id: string;
  email: string;
  name: string;
  role: string;
  adminCapabilityBundle: string | null;
  adminCapabilities: string[];
  accountStatus: string;
}> = {}) {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'fan@example.com',
    name: overrides.name ?? 'Fan',
    phone: '+821012345678',
    gender: 'unspecified' as const,
    country: 'KR',
    birthDate: '1990-01-01',
    preferredLocale: 'ko',
    isEmailVerified: true,
    isPhoneVerified: true,
    marketingConsent: false,
    role: overrides.role ?? 'admin',
    adminCapabilityBundle: overrides.adminCapabilityBundle ?? 'admin',
    adminCapabilities: overrides.adminCapabilities ?? [],
    accountStatus: overrides.accountStatus ?? 'active',
    withdrawnAt: null,
    withdrawalReason: null,
    withdrawnByUserId: null,
    withdrawalSource: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-17T00:00:00.000Z'),
  };
}

function detailStub(id = 'target-user'): AdminUserDetail {
  return {
    id,
    email: 'target@example.com',
    maskedEmail: 'ta***@example.com',
    name: 'Target',
    phone: '+821099998888',
    maskedPhone: '+82********88',
    role: 'admin',
    country: 'KR',
    preferredLocale: 'ko',
    marketingConsent: false,
    adminCapabilityBundle: 'operator',
    adminCapabilities: ['support.manage'],
    accountStatus: 'active',
    withdrawnAt: null,
    withdrawalReason: null,
    withdrawalSource: null,
    verificationState: {
      emailVerified: true,
      phoneVerified: true,
    },
    reservationSummary: {
      total: 0,
      statuses: {
        pendingPayment: 0,
        confirmed: 0,
        cancelled: 0,
        failed: 0,
      },
      lastReservationAt: null,
    },
    lastActivityAt: '2026-05-17T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    account: {
      birthDate: '1990-01-01',
      gender: 'unspecified',
      updatedAt: '2026-05-17T00:00:00.000Z',
    },
    recentReservations: [],
    supportThreads: {
      total: 0,
      open: 0,
      escalated: 0,
      recentThreads: [],
    },
    recentAuditEvents: [],
  };
}

interface ActiveReservationRow {
  id: string;
  reservationNumber: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED';
  showtimeAt: Date | null;
}

interface BlockerCounts {
  pendingPayment: number;
  upcomingConfirmed: number;
}

function createMockDb(
  adminRows: ReturnType<typeof userRow>[],
  activeReservationRows: ActiveReservationRow[] = [],
  blockerCounts?: BlockerCounts,
) {
  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const deleteWhere = vi.fn().mockResolvedValue([]);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const selectWhere = vi.fn().mockResolvedValue(adminRows);
  // Withdrawal blocker queries: reservations LEFT JOIN showtimes. Awaiting the
  // WHERE resolves the count aggregate; ORDER BY ... LIMIT n is the sample.
  const counts: BlockerCounts = blockerCounts ?? {
    pendingPayment: activeReservationRows.filter((row) => row.status === 'PENDING_PAYMENT').length,
    upcomingConfirmed: activeReservationRows.filter((row) => row.status === 'CONFIRMED').length,
  };
  const reservationLimit = vi.fn().mockResolvedValue(activeReservationRows);
  const reservationOrderBy = vi.fn().mockReturnValue({ limit: reservationLimit });
  const reservationWhere = vi.fn(() =>
    Object.assign(Promise.resolve([counts]), { orderBy: reservationOrderBy }),
  );
  const leftJoin = vi.fn().mockReturnValue({ where: reservationWhere });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere, leftJoin });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const tx = { update, delete: deleteFn, select };
  const transaction = vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );

  return {
    db: { transaction },
    tx,
    updateSet,
    updateWhere,
    deleteFn,
    deleteWhere,
    select,
    leftJoin,
    reservationLimit,
  };
}

function setupPermissionService(options: {
  actor: ReturnType<typeof userRow>;
  target: ReturnType<typeof userRow>;
  adminRows?: ReturnType<typeof userRow>[];
  activeReservationRows?: ActiveReservationRow[];
  blockerCounts?: BlockerCounts;
}) {
  const mockDb = createMockDb(
    options.adminRows ?? [options.actor, options.target],
    options.activeReservationRows,
    options.blockerCounts,
  );
  const auditService = createAuditService();
  const service = new AdminUserService(mockDb.db as never, auditService);

  const findUserById = vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
    Promise.resolve(id === options.actor.id ? options.actor : options.target),
  );
  vi.spyOn(service, 'getUserDetail').mockResolvedValue(detailStub(options.target.id));
  vi.spyOn(service as never, 'enforceUserRefreshFamilyLimit').mockResolvedValue(undefined);

  return { mockDb, auditService, service, findUserById };
}

function createAuditService() {
  return {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    query: vi.fn().mockResolvedValue([]),
  } as unknown as AdminAuditService & {
    write: Mock;
  };
}

describe('AdminUserService permission updates', () => {
  it('persists permission changes and writes masked security.permission.update audit context', async () => {
    const actor = userRow({
      id: 'actor-admin',
      email: 'admin@example.com',
      adminCapabilityBundle: 'admin',
    });
    const target = userRow({
      id: 'target-user',
      email: 'target@example.com',
      adminCapabilityBundle: 'admin',
    });
    const mockDb = createMockDb([actor, target]);
    const auditService = createAuditService();
    const service = new AdminUserService(mockDb.db as never, auditService);

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-admin' ? actor : target),
    );
    vi.spyOn(service, 'getUserDetail').mockResolvedValue(detailStub('target-user'));

    const result = await service.updatePermissions(
      'actor-admin',
      'target-user',
      {
        role: 'admin',
        adminCapabilityBundle: 'operator',
        adminCapabilities: ['support.manage'],
        reason: 'CS operator rotation',
        confirmed: true,
      },
      {
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin',
        requestId: 'req-admin-user-1',
      },
    );

    expect(result.adminCapabilityBundle).toBe('operator');
    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      role: 'admin',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
    }));
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'actor-admin',
        action: 'security.permission.update',
        resourceType: 'user',
        resourceId: 'target-user',
        status: 'success',
        reason: 'CS operator rotation',
        changedFields: [
          'adminCapabilityBundle',
          'adminCapabilities',
          'adminSuperuser',
          'effectiveAdminCapabilities',
        ],
        after: expect.objectContaining({
          adminCapabilityBundle: 'operator',
          adminCapabilities: ['support.manage'],
          adminSuperuser: false,
          effectiveAdminCapabilities: ['support.manage'],
        }),
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin',
        requestId: 'req-admin-user-1',
      }),
      mockDb.tx,
    );
  });

  it('rejects actors that do not currently have security.manage', async () => {
    const actor = userRow({
      id: 'actor-operator',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
    });
    const target = userRow({ id: 'target-user' });
    const mockDb = createMockDb([target]);
    const service = new AdminUserService(mockDb.db as never, createAuditService());

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-operator' ? actor : target),
    );

    await expect(
      service.updatePermissions('actor-operator', 'target-user', {
        role: 'admin',
        adminCapabilityBundle: 'admin',
        adminCapabilities: [],
        reason: 'attempt escalation',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects self-lockout when the actor would remove their own security.manage', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const mockDb = createMockDb([actor]);
    const service = new AdminUserService(mockDb.db as never, createAuditService());

    vi.spyOn(service as never, 'findUserById').mockResolvedValue(actor);

    await expect(
      service.updatePermissions('actor-admin', 'actor-admin', {
        role: 'admin',
        adminCapabilityBundle: 'operator',
        adminCapabilities: ['support.manage'],
        reason: 'remove own admin power',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects changes that would leave no security.manage admin account', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({ id: 'target-user', adminCapabilityBundle: 'admin' });
    const mockDb = createMockDb([target]);
    const service = new AdminUserService(mockDb.db as never, createAuditService());

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-admin' ? actor : target),
    );

    await expect(
      service.updatePermissions('actor-admin', 'target-user', {
        role: 'user',
        adminCapabilityBundle: null,
        adminCapabilities: [],
        reason: 'decommission admin account',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects merged target permission updates without writing permissions or audit logs', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({
      id: 'merged-user',
      accountStatus: 'merged',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });
    const mockDb = createMockDb([actor]);
    const auditService = createAuditService();
    const service = new AdminUserService(mockDb.db as never, auditService);

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-admin' ? actor : target),
    );

    await expect(
      service.updatePermissions('actor-admin', 'merged-user', {
        role: 'admin',
        adminCapabilityBundle: 'operator',
        adminCapabilities: ['support.manage'],
        reason: 'reactivate merged duplicate',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('reapplies the user refresh-token family limit when an admin is downgraded to user', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({ id: 'target-user', adminCapabilityBundle: 'operator' });
    const mockDb = createMockDb([actor, target]);
    const service = new AdminUserService(mockDb.db as never, createAuditService());
    const enforceSpy = vi
      .spyOn(service as never, 'enforceUserRefreshFamilyLimit')
      .mockResolvedValue(undefined);

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-admin' ? actor : target),
    );
    vi.spyOn(service, 'getUserDetail').mockResolvedValue(detailStub('target-user'));

    await service.updatePermissions('actor-admin', 'target-user', {
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
      reason: 'downgrade temporary admin',
      confirmed: true,
    });

    expect(enforceSpy).toHaveBeenCalledWith('target-user', mockDb.tx);
  });
});

describe('AdminUserService withdrawals', () => {
  it('removes linked social accounts when an admin withdraws a user', async () => {
    const actor = userRow({
      id: 'actor-admin',
      email: 'admin@example.com',
      adminCapabilityBundle: 'admin',
    });
    const target = userRow({
      id: 'target-user',
      email: 'target@example.com',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
    });
    const mockDb = createMockDb([actor]);
    const auditService = createAuditService();
    const service = new AdminUserService(mockDb.db as never, auditService);

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-admin' ? actor : target),
    );
    vi.spyOn(service, 'getUserDetail').mockResolvedValue(detailStub('target-user'));

    await service.withdrawUser(
      'actor-admin',
      'target-user',
      { reason: 'user requested deletion', confirmed: true },
      { ipAddress: '203.0.113.10', userAgent: 'Vitest Admin', requestId: 'req-withdraw' },
    );

    expect(mockDb.deleteFn).toHaveBeenCalledTimes(1);
    expect(mockDb.deleteWhere).toHaveBeenCalledTimes(1);
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.withdraw',
        resourceId: 'target-user',
        changedFields: expect.arrayContaining(['socialAccounts']),
      }),
      mockDb.tx,
    );
  });

  it('treats merged account admin withdrawal as inactive without overwriting status', async () => {
    const actor = userRow({
      id: 'actor-admin',
      email: 'admin@example.com',
      adminCapabilityBundle: 'admin',
    });
    const target = userRow({
      id: 'merged-user',
      email: 'merged@example.com',
      accountStatus: 'merged',
    });
    const mockDb = createMockDb([actor]);
    const auditService = createAuditService();
    const service = new AdminUserService(mockDb.db as never, auditService);

    vi.spyOn(service as never, 'findUserById').mockImplementation((id: string) =>
      Promise.resolve(id === 'actor-admin' ? actor : target),
    );
    vi.spyOn(service, 'getUserDetail').mockResolvedValue({
      ...detailStub('merged-user'),
      accountStatus: 'merged',
    });

    await expect(
      service.withdrawUser('actor-admin', 'merged-user', {
        reason: 'duplicate account merged',
        confirmed: true,
      }),
    ).resolves.toMatchObject({
      accountStatus: 'merged',
    });

    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(mockDb.deleteFn).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });
});

describe('AdminUserService raw user export and statistics', () => {
  it('preserves merged account status in detail responses', async () => {
    const mergedUser = userRow({
      id: 'merged-user',
      email: 'merged@example.com',
      accountStatus: 'merged',
    });
    const auditService = createAuditService();
    const service = new AdminUserService({} as never, auditService);

    vi.spyOn(service as never, 'findUserById').mockResolvedValue(mergedUser);
    vi.spyOn(service as never, 'fetchReservationSummaries').mockResolvedValue(
      new Map([
        [
          'merged-user',
          {
            total: 0,
            statuses: {
              pendingPayment: 0,
              confirmed: 0,
              cancelled: 0,
              failed: 0,
            },
            lastReservationAt: null,
          },
        ],
      ]),
    );
    vi.spyOn(service as never, 'fetchRecentReservations').mockResolvedValue([]);
    vi.spyOn(service as never, 'fetchSupportThreadSummary').mockResolvedValue({
      total: 0,
      open: 0,
      escalated: 0,
      recentThreads: [],
    });

    await expect(service.getUserDetail('merged-user')).resolves.toMatchObject({
      id: 'merged-user',
      accountStatus: 'merged',
    });
  });

  it('builds raw users CSV without secret columns and writes non-PII audit metadata', async () => {
    const auditService = createAuditService();
    const service = new AdminUserService({} as never, auditService);
    vi.spyOn(service as never, 'selectUserExportRows').mockResolvedValue([
      {
        ...userRow({
          id: 'user-formula',
          email: '=fan@example.com',
          role: 'admin',
          adminCapabilityBundle: 'admin',
          adminCapabilities: ['security.manage'],
        }),
        withdrawnAt: null,
        withdrawalReason: null,
        withdrawnByUserId: null,
        withdrawalSource: null,
      },
    ]);

    const result = await service.exportUsers({
      actorUserId: 'actor-admin',
      reason: 'membership operations reconciliation',
      ipAddress: '203.0.113.10',
      userAgent: 'Vitest Admin',
    });

    expect(result.filename).toMatch(/^user-export-raw-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('"id","email","name","phone"');
    expect(result.csv).toContain('"user-formula","\'=fan@example.com"');
    expect(result.csv).not.toContain('password_hash');
    expect(result.csv).not.toContain('refresh');
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'actor-admin',
        action: 'user.export_raw',
        resourceType: 'user_export',
        resourceId: 'raw_pii',
        status: 'success',
        reason: 'membership operations reconciliation',
        changedFields: ['columns', 'rowCount'],
        after: expect.objectContaining({
          rowCount: 1,
          columns: expect.arrayContaining(['id', 'email', 'updated_at']),
        }),
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin',
      }),
    );
  });

  it('prefixes raw users CSV with a UTF-8 BOM for Excel-compatible Korean names', async () => {
    const auditService = createAuditService();
    const service = new AdminUserService({} as never, auditService);
    vi.spyOn(service as never, 'selectUserExportRows').mockResolvedValue([
      userRow({
        id: 'user-korean',
        name: '김예매',
      }),
    ]);

    const result = await service.exportUsers({
      actorUserId: 'actor-admin',
      reason: 'membership operations reconciliation',
    });

    expect(result.csv.charCodeAt(0)).toBe(0xfeff);
    expect(result.csv).toContain('"김예매"');
  });

  it('aggregates all-time user stats and fills a 30-day KST signup trend', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T03:00:00.000Z'));
    const service = new AdminUserService({} as never, createAuditService());
    vi.spyOn(service as never, 'selectUserStatsSummary').mockResolvedValue({
      total: 10,
      active: 7,
      withdrawn: 2,
      merged: 1,
      emailVerified: 7,
      phoneVerified: 6,
      fullyVerified: 5,
      marketingConsented: 4,
    });
    vi.spyOn(service as never, 'selectUserStatsRatioRows')
      .mockResolvedValueOnce([
        { value: 'KR', count: 6 },
        { value: 'TH', count: 4 },
      ])
      .mockResolvedValueOnce([
        { value: 'ko', count: 7 },
        { value: 'th', count: 3 },
      ]);
    vi.spyOn(service as never, 'selectUserSignupTrendRows').mockResolvedValue([
      { date: '2026-05-17', count: 2 },
      { date: '2026-05-18', count: 1 },
    ]);

    const stats = await service.getUserStats();
    vi.useRealTimers();

    expect(stats.total).toBe(10);
    expect(stats.active).toBe(7);
    expect(stats.withdrawn).toBe(2);
    expect(stats.merged).toBe(1);
    expect(stats.marketing).toEqual({ consented: 4, notConsented: 6 });
    expect(stats.countries).toEqual([
      { value: 'KR', count: 6, ratio: 0.6 },
      { value: 'TH', count: 4, ratio: 0.4 },
    ]);
    expect(stats.locales[0]).toEqual({ value: 'ko', count: 7, ratio: 0.7 });
    expect(stats.signupTrend).toHaveLength(30);
    expect(stats.signupTrend.at(-2)).toEqual({ date: '2026-05-17', count: 2 });
    expect(stats.signupTrend.at(-1)).toEqual({ date: '2026-05-18', count: 1 });
  });
});

describe('AdminUserService admin bundle contract (audit #42, #144)', () => {
  it('rejects narrowing the superuser admin bundle instead of silently granting every capability', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({
      id: 'scanner-shared',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });
    const { mockDb, auditService, service } = setupPermissionService({ actor, target });

    await expect(
      service.updatePermissions('actor-admin', 'scanner-shared', {
        role: 'admin',
        adminCapabilityBundle: 'admin',
        adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
        reason: 'shared field scanner account',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ZodError);

    expect(mockDb.db.transaction).not.toHaveBeenCalled();
    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('stores the admin bundle canonically and audits the effective superuser access', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({
      id: 'target-user',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
    });
    const { mockDb, auditService, service } = setupPermissionService({ actor, target });

    await service.updatePermissions('actor-admin', 'target-user', {
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: [...ADMIN_CAPABILITIES],
      reason: 'promote security owner',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: [],
    }));
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: expect.arrayContaining(['adminSuperuser', 'effectiveAdminCapabilities']),
        after: expect.objectContaining({
          adminCapabilityBundle: 'admin',
          adminSuperuser: true,
          effectiveAdminCapabilities: [...ADMIN_CAPABILITIES],
        }),
      }),
      mockDb.tx,
    );
  });

  it('persists bundle defaults explicitly when a non-admin bundle is saved without capabilities', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({
      id: 'target-user',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });
    const { mockDb, service } = setupPermissionService({ actor, target });

    await service.updatePermissions('actor-admin', 'target-user', {
      role: 'admin',
      adminCapabilityBundle: 'finance',
      adminCapabilities: [],
      reason: 'finance reviewer',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      adminCapabilityBundle: 'finance',
      adminCapabilities: [...ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.finance],
    }));
  });

  it('revokes all admin access with a role-only change even when bundle and capabilities are left over', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const target = userRow({
      id: 'compromised-admin',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage', 'seat.manual_open'],
    });
    const { mockDb, auditService, service } = setupPermissionService({ actor, target });

    await service.updatePermissions('actor-admin', 'compromised-admin', {
      role: 'user',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage', 'seat.manual_open'],
      reason: 'credential leak suspected',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    }));
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({
          role: 'user',
          adminSuperuser: false,
          effectiveAdminCapabilities: [],
        }),
      }),
      mockDb.tx,
    );
  });
});

describe('AdminUserService delegation ceiling (audit #120)', () => {
  const delegate = userRow({
    id: 'delegate-admin',
    adminCapabilityBundle: 'operator',
    adminCapabilities: [...ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.operator, 'security.manage'],
  });
  const superuser = userRow({ id: 'root-admin', adminCapabilityBundle: 'admin' });

  it('blocks a non-superuser security admin from promoting themselves to the admin bundle', async () => {
    const { mockDb, auditService, service } = setupPermissionService({
      actor: delegate,
      target: delegate,
      adminRows: [delegate, superuser],
    });

    await expect(
      service.updatePermissions('delegate-admin', 'delegate-admin', {
        role: 'admin',
        adminCapabilityBundle: 'admin',
        adminCapabilities: [],
        reason: 'self escalation',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('blocks a delegate from granting capabilities they do not hold', async () => {
    const target = userRow({
      id: 'target-user',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });
    const { mockDb, service } = setupPermissionService({ actor: delegate, target });

    await expect(
      service.updatePermissions('delegate-admin', 'target-user', {
        role: 'admin',
        adminCapabilityBundle: 'finance',
        adminCapabilities: ['reservations.read', 'refund.admin_refund'],
        reason: 'grant refund',
        confirmed: true,
      }),
    ).rejects.toThrow(/refund\.admin_refund/);

    expect(mockDb.updateSet).not.toHaveBeenCalled();
  });

  it('blocks a delegate from widening their own access', async () => {
    const narrowDelegate = userRow({
      id: 'narrow-delegate',
      adminCapabilityBundle: 'reviewer',
      adminCapabilities: ['support.manage', 'security.manage'],
    });
    const { mockDb, service } = setupPermissionService({
      actor: narrowDelegate,
      target: narrowDelegate,
      adminRows: [narrowDelegate, superuser],
    });

    await expect(
      service.updatePermissions('narrow-delegate', 'narrow-delegate', {
        role: 'admin',
        adminCapabilityBundle: 'reviewer',
        adminCapabilities: ['support.manage', 'security.manage', 'audit.read'],
        reason: 'self widen',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockDb.updateSet).not.toHaveBeenCalled();
  });

  it('blocks a delegate from demoting or withdrawing a superuser account', async () => {
    const permission = setupPermissionService({ actor: delegate, target: superuser });

    await expect(
      permission.service.updatePermissions('delegate-admin', 'root-admin', {
        role: 'user',
        adminCapabilityBundle: null,
        adminCapabilities: [],
        reason: 'lock out root',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permission.mockDb.updateSet).not.toHaveBeenCalled();

    const withdrawal = setupPermissionService({ actor: delegate, target: superuser });
    await expect(
      withdrawal.service.withdrawUser('delegate-admin', 'root-admin', {
        reason: 'lock out root',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(withdrawal.mockDb.updateSet).not.toHaveBeenCalled();
    expect(withdrawal.mockDb.deleteFn).not.toHaveBeenCalled();
  });

  it('still lets a delegate grant a subset of their own capabilities', async () => {
    const target = userRow({
      id: 'target-user',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });
    const { mockDb, service } = setupPermissionService({ actor: delegate, target });

    await service.updatePermissions('delegate-admin', 'target-user', {
      role: 'admin',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage', 'support.escalate'],
      reason: 'CS shift',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage', 'support.escalate'],
    }));
  });

  it('keeps superusers unrestricted', async () => {
    const target = userRow({
      id: 'target-user',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });
    const { mockDb, service } = setupPermissionService({ actor: superuser, target });

    await service.updatePermissions('root-admin', 'target-user', {
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: [],
      reason: 'second security owner',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      adminCapabilityBundle: 'admin',
    }));
  });
});

describe('AdminUserService scanner bundle normalization (audit #122)', () => {
  const scanner = userRow({
    id: 'scanner-user',
    email: 'scanner@example.com',
    adminCapabilityBundle: 'scanner',
    adminCapabilities: [],
  });

  it('keeps the scanner bundle in list/detail rows', async () => {
    const service = new AdminUserService({} as never, createAuditService());
    vi.spyOn(service as never, 'findUserById').mockResolvedValue(scanner);
    vi.spyOn(service as never, 'fetchReservationSummaries').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'fetchRecentReservations').mockResolvedValue([]);
    vi.spyOn(service as never, 'fetchSupportThreadSummary').mockResolvedValue({
      total: 0,
      open: 0,
      escalated: 0,
      recentThreads: [],
    });

    await expect(service.getUserDetail('scanner-user')).resolves.toMatchObject({
      role: 'admin',
      adminCapabilityBundle: 'scanner',
    });
  });

  it('records the scanner bundle in the permission audit before snapshot and allows narrowing it', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const { mockDb, auditService, service } = setupPermissionService({ actor, target: scanner });

    await service.updatePermissions('actor-admin', 'scanner-user', {
      role: 'admin',
      adminCapabilityBundle: 'scanner',
      adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
      reason: 'entry only scanner',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      adminCapabilityBundle: 'scanner',
      adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
    }));
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: ['adminCapabilities', 'effectiveAdminCapabilities'],
        before: expect.objectContaining({
          adminCapabilityBundle: 'scanner',
          adminSuperuser: false,
          effectiveAdminCapabilities: [...ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.scanner],
        }),
      }),
      mockDb.tx,
    );
  });

  it('does not count a scanner account without explicit capabilities as a security admin', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const lastSecurityAdmin = userRow({ id: 'target-user', adminCapabilityBundle: 'admin' });
    const { mockDb, service } = setupPermissionService({
      actor,
      target: lastSecurityAdmin,
      // Only the target and a default scanner account are role=admin rows.
      adminRows: [lastSecurityAdmin, scanner],
    });

    await expect(
      service.updatePermissions('actor-admin', 'target-user', {
        role: 'user',
        adminCapabilityBundle: null,
        adminCapabilities: [],
        reason: 'decommission',
        confirmed: true,
      }),
    ).rejects.toThrow(/마지막 security.manage/);
    expect(mockDb.updateSet).not.toHaveBeenCalled();
  });
});

describe('AdminUserService unknown stored bundle (u12 consistency, audit #42 #122)', () => {
  // role=admin with a bundle this build does not know: the shared resolver and
  // the guards fail closed. The service must agree instead of falling back to
  // the legacy role=admin superuser rule.
  const unknownBundle = userRow({
    id: 'unknown-bundle-admin',
    email: 'unknown@example.com',
    adminCapabilityBundle: 'superadmin',
    adminCapabilities: [],
  });
  const delegate = userRow({
    id: 'delegate-admin',
    adminCapabilityBundle: 'operator',
    adminCapabilities: [...ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.operator, 'security.manage'],
  });

  it('does not count it as a security admin when the last real one is demoted', async () => {
    const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
    const lastSecurityAdmin = userRow({ id: 'target-user', adminCapabilityBundle: 'admin' });
    const { mockDb, service } = setupPermissionService({
      actor,
      target: lastSecurityAdmin,
      adminRows: [lastSecurityAdmin, unknownBundle],
    });

    await expect(
      service.updatePermissions('actor-admin', 'target-user', {
        role: 'user',
        adminCapabilityBundle: null,
        adminCapabilities: [],
        reason: 'decommission',
        confirmed: true,
      }),
    ).rejects.toThrow(/마지막 security.manage/);
    expect(mockDb.updateSet).not.toHaveBeenCalled();
  });

  it('audits it as not superuser and lets a non-superuser delegate repair it', async () => {
    const { mockDb, auditService, service } = setupPermissionService({
      actor: delegate,
      target: unknownBundle,
      adminRows: [delegate, unknownBundle],
    });

    await service.updatePermissions('delegate-admin', 'unknown-bundle-admin', {
      role: 'admin',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
      reason: 'repair mistyped bundle',
      confirmed: true,
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
    }));
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        before: expect.objectContaining({
          adminSuperuser: false,
          effectiveAdminCapabilities: [],
        }),
      }),
      mockDb.tx,
    );
  });

  it('reports the guard-effective access in list and detail rows', async () => {
    const service = new AdminUserService({} as never, createAuditService());
    vi.spyOn(service as never, 'findUserById').mockResolvedValue(unknownBundle);
    vi.spyOn(service as never, 'fetchReservationSummaries').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'fetchRecentReservations').mockResolvedValue([]);
    vi.spyOn(service as never, 'fetchSupportThreadSummary').mockResolvedValue({
      total: 0,
      open: 0,
      escalated: 0,
      recentThreads: [],
    });

    await expect(service.getUserDetail('unknown-bundle-admin')).resolves.toMatchObject({
      role: 'admin',
      adminCapabilityBundle: null,
      adminSuperuser: false,
      effectiveAdminCapabilities: [],
    });
  });

  it('reports legacy role-only admins as superuser in detail rows', async () => {
    const legacy = userRow({ id: 'legacy-admin', adminCapabilityBundle: null, adminCapabilities: [] });
    const service = new AdminUserService({} as never, createAuditService());
    vi.spyOn(service as never, 'findUserById').mockResolvedValue({ ...legacy, adminCapabilityBundle: null });
    vi.spyOn(service as never, 'fetchReservationSummaries').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'fetchRecentReservations').mockResolvedValue([]);
    vi.spyOn(service as never, 'fetchSupportThreadSummary').mockResolvedValue({
      total: 0,
      open: 0,
      escalated: 0,
      recentThreads: [],
    });

    await expect(service.getUserDetail('legacy-admin')).resolves.toMatchObject({
      adminCapabilityBundle: null,
      adminSuperuser: true,
      effectiveAdminCapabilities: [...ADMIN_CAPABILITIES],
    });
  });
});

describe('AdminUserService withdrawal blockers (audit #44)', () => {
  const actor = userRow({ id: 'actor-admin', adminCapabilityBundle: 'admin' });
  const buyer = userRow({
    id: 'buyer-user',
    role: 'user',
    adminCapabilityBundle: null,
    adminCapabilities: [],
  });

  it('refuses to withdraw a member with a pending payment or an upcoming confirmed ticket', async () => {
    const { mockDb, auditService, service } = setupPermissionService({
      actor,
      target: buyer,
      adminRows: [actor],
      activeReservationRows: [
        {
          id: 'reservation-pending',
          reservationNumber: 'R-PENDING',
          status: 'PENDING_PAYMENT',
          showtimeAt: new Date('2026-10-10T10:00:00.000Z'),
        },
        {
          id: 'reservation-confirmed',
          reservationNumber: 'R-CONFIRMED',
          status: 'CONFIRMED',
          showtimeAt: new Date('2026-10-11T10:00:00.000Z'),
        },
      ],
    });

    const error = await service
      .withdrawUser('actor-admin', 'buyer-user', {
        reason: 'CS deletion request',
        confirmed: true,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    const response = (error as ConflictException).getResponse() as Record<string, unknown>;
    expect(response).toMatchObject({
      code: 'ACCOUNT_WITHDRAWAL_BLOCKED',
      blockers: [
        { key: 'pending_payment_reservations', label: '결제 진행 중 예매', count: 1 },
        { key: 'upcoming_confirmed_reservations', label: '관람 예정 확정 예매', count: 1 },
      ],
      reservations: [
        expect.objectContaining({ reservationNumber: 'R-PENDING', status: 'PENDING_PAYMENT' }),
        expect.objectContaining({
          reservationNumber: 'R-CONFIRMED',
          status: 'CONFIRMED',
          showtimeAt: '2026-10-11T10:00:00.000Z',
        }),
      ],
    });
    // The message alone must explain the block (extra fields may be stripped).
    expect((error as ConflictException).message).toContain('결제 진행 중 예매 1건');
    expect((error as ConflictException).message).toContain('관람 예정 확정 예매 1건');
    // The blocker queries (count + sample) run on the withdrawal transaction, and nothing is written.
    expect(mockDb.leftJoin).toHaveBeenCalledTimes(2);
    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(mockDb.deleteFn).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('withdraws a member whose reservations are all past or closed', async () => {
    const { mockDb, auditService, service } = setupPermissionService({
      actor,
      target: buyer,
      adminRows: [actor],
      activeReservationRows: [],
    });

    await service.withdrawUser('actor-admin', 'buyer-user', {
      reason: 'CS deletion request',
      confirmed: true,
    });

    // The count aggregate ran; with nothing blocking, no sample is read.
    expect(mockDb.leftJoin).toHaveBeenCalledTimes(1);
    expect(mockDb.reservationLimit).not.toHaveBeenCalled();
    expect(mockDb.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      accountStatus: 'withdrawn',
      withdrawalSource: 'admin',
    }));
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.withdraw', resourceId: 'buyer-user' }),
      mockDb.tx,
    );
  });

  it('reports every blocking reservation in the count, not only the sampled rows', async () => {
    const sample: ActiveReservationRow[] = Array.from({ length: 10 }, (_, index) => ({
      id: `reservation-${index}`,
      reservationNumber: `R-${index}`,
      status: 'PENDING_PAYMENT',
      showtimeAt: new Date('2026-10-10T10:00:00.000Z'),
    }));
    const { mockDb, service } = setupPermissionService({
      actor,
      target: buyer,
      adminRows: [actor],
      activeReservationRows: sample,
      blockerCounts: { pendingPayment: 130, upcomingConfirmed: 7 },
    });

    const error = await service
      .withdrawUser('actor-admin', 'buyer-user', { reason: 'CS deletion request', confirmed: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      blockers: [
        { key: 'pending_payment_reservations', count: 130 },
        { key: 'upcoming_confirmed_reservations', count: 7 },
      ],
    });
    expect((error as ConflictException).message).toContain('결제 진행 중 예매 130건');
    expect((error as ConflictException).message).toContain('관람 예정 확정 예매 7건');
    // Only the sample list is capped.
    expect(mockDb.reservationLimit).toHaveBeenCalledWith(10);
    expect(((error as ConflictException).getResponse() as { reservations: unknown[] }).reservations).toHaveLength(10);
  });

  it('locks the target row before reading blockers and re-checks its status under the lock', async () => {
    const { mockDb, auditService, service, findUserById } = setupPermissionService({
      actor,
      target: { ...buyer, accountStatus: 'withdrawn' },
      adminRows: [actor],
    });

    await service.withdrawUser('actor-admin', 'buyer-user', {
      reason: 'CS deletion request',
      confirmed: true,
    });

    expect(findUserById).toHaveBeenNthCalledWith(1, 'buyer-user', mockDb.tx, { forUpdate: true });
    // Already withdrawn on the locked row: nothing is read or written again.
    expect(mockDb.leftJoin).not.toHaveBeenCalled();
    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });
});
