import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { AdminUserDetail } from '@grabit/shared';

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

function createMockDb(adminRows: ReturnType<typeof userRow>[]) {
  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const deleteWhere = vi.fn().mockResolvedValue([]);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const selectWhere = vi.fn().mockResolvedValue(adminRows);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
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
  };
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
        changedFields: ['adminCapabilityBundle', 'adminCapabilities'],
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
