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
  role: string;
  adminCapabilityBundle: string | null;
  adminCapabilities: string[];
}> = {}) {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'fan@example.com',
    name: 'Fan',
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
    accountStatus: 'active',
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

  const selectWhere = vi.fn().mockResolvedValue(adminRows);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const tx = { update, select };
  const transaction = vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );

  return {
    db: { transaction },
    tx,
    updateSet,
    updateWhere,
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
});
