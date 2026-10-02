import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AdminSecurityService } from './admin-security.service.js';
import type { AdminAuditService } from './admin-audit.service.js';

function requestWithIp(ip: string): Request {
  return {
    ip,
    socket: { remoteAddress: '10.0.0.1' },
  } as Request;
}

function createMockAuditService() {
  return {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AdminAuditService & {
    write: ReturnType<typeof vi.fn>;
  };
}

function createMockDb(rows: Array<Record<string, unknown>> = []) {
  const where = vi.fn().mockResolvedValue(rows);
  // The allowlist table is loaded whole: `select().from()` resolves rows.
  const from = vi.fn().mockReturnValue(
    Object.assign(Promise.resolve(rows), { where }),
  );
  const select = vi.fn().mockReturnValue({ from });
  const returning = vi.fn().mockResolvedValue([{ id: 'allowlist-1' }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    select,
    insert,
    _where: where,
    _values: values,
  };
}

const actorUserId = '00000000-0000-4000-8000-000000000001';

describe('AdminSecurityService', () => {
  it('explicitly allows non-production bypass without audit noise', async () => {
    const db = createMockDb();
    const audit = createMockAuditService();
    const service = new AdminSecurityService(db as never, audit, {
      env: { NODE_ENV: 'development' },
    });

    const decision = await service.evaluateRequest(requestWithIp('203.0.113.10'));

    expect(decision).toMatchObject({
      allowed: true,
      source: 'non_production_bypass',
      ipAddress: '203.0.113.10',
    });
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('allows production requests from env/bootstrap CIDRs', async () => {
    const service = new AdminSecurityService(
      createMockDb() as never,
      createMockAuditService(),
      {
        env: {
          NODE_ENV: 'production',
          ADMIN_IP_ALLOWLIST_CIDRS: '203.0.113.0/24, 198.51.100.42',
        },
      },
    );

    await expect(service.evaluateRequest(requestWithIp('203.0.113.88'))).resolves.toMatchObject({
      allowed: true,
      source: 'env_bootstrap',
      matchedCidr: '203.0.113.0/24',
    });
  });

  it('matches production DB-managed temporary exceptions without writing audit rows', async () => {
    const db = createMockDb([{
      id: 'allowlist-temp-1',
      cidr: '198.51.100.0/24',
      source: 'temporary_exception',
      status: 'active',
      label: 'Ops temporary VPN',
      reason: 'incident response',
      expiresAt: new Date(Date.now() + 60_000),
    }]);
    const audit = createMockAuditService();
    const service = new AdminSecurityService(db as never, audit, {
      env: { NODE_ENV: 'production' },
    });

    const decision = await service.evaluateRequest(requestWithIp('198.51.100.77'));

    expect(decision).toMatchObject({
      allowed: true,
      source: 'temporary_exception',
      matchedCidr: '198.51.100.0/24',
    });
    // audit #43: a status read is not an allowlist change.
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('flags production requests outside env and DB allowlists without blocking or audit rows', async () => {
    const db = createMockDb();
    const audit = createMockAuditService();
    const service = new AdminSecurityService(db as never, audit, {
      env: {
        NODE_ENV: 'production',
        ADMIN_IP_ALLOWLIST_CIDRS: '203.0.113.0/24',
      },
    });

    const decision = await service.evaluateRequest(requestWithIp('198.51.100.9'));

    expect(decision).toMatchObject({
      allowed: false,
      source: 'denied',
      ipAddress: '198.51.100.9',
    });
    expect(decision.reason).toMatch(/monitoring-only/);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('reports the allowlist as monitoring-only in production with real record counts', async () => {
    const now = new Date('2026-10-02T00:00:00.000Z');
    const db = createMockDb([
      {
        id: 'allowlist-office',
        cidr: '198.51.100.0/24',
        source: 'db_managed',
        status: 'active',
        label: 'Office',
        reason: 'office',
        expiresAt: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-20T00:00:00.000Z'),
      },
      {
        id: 'allowlist-expired',
        cidr: '192.0.2.0/24',
        source: 'temporary_exception',
        status: 'active',
        label: 'Old VPN',
        reason: 'incident',
        expiresAt: new Date('2026-09-30T00:00:00.000Z'),
        createdAt: new Date('2026-09-29T00:00:00.000Z'),
        updatedAt: new Date('2026-09-29T00:00:00.000Z'),
      },
      {
        id: 'allowlist-disabled',
        cidr: '192.0.2.10',
        source: 'db_managed',
        status: 'disabled',
        label: 'Retired',
        reason: 'retired',
        expiresAt: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-25T00:00:00.000Z'),
      },
    ]);
    const audit = createMockAuditService();
    const service = new AdminSecurityService(db as never, audit, {
      env: {
        NODE_ENV: 'production',
        ADMIN_IP_ALLOWLIST_CIDRS: '203.0.113.0/24',
      },
      now: () => now,
    });

    const status = await service.getAllowlistStatus(requestWithIp('100.64.0.1'));

    expect(status).toMatchObject({
      mode: 'monitoring',
      enforced: false,
      // 1 env CIDR + 1 active, unexpired DB record.
      activeRecords: 2,
      // Latest change across all rows, including expired ones.
      lastChangedAt: '2026-09-29T00:00:00.000Z',
      decision: { allowed: false, source: 'denied' },
    });
    expect(status.mode).not.toBe('enforced');
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('reports the allowlist as disabled outside production', async () => {
    const service = new AdminSecurityService(createMockDb() as never, createMockAuditService(), {
      env: { NODE_ENV: 'development' },
    });

    await expect(service.getAllowlistStatus(requestWithIp('203.0.113.10'))).resolves.toMatchObject({
      mode: 'disabled',
      enforced: false,
      activeRecords: 0,
      lastChangedAt: null,
      decision: { allowed: true, source: 'non_production_bypass' },
    });
  });

  it('requires security.manage and writes audit evidence for allowlist changes', async () => {
    const db = createMockDb();
    const audit = createMockAuditService();
    const service = new AdminSecurityService(db as never, audit, {
      env: { NODE_ENV: 'production' },
    });

    await expect(service.createAllowlistRecord({
      actorUserId,
      hasSecurityManage: false,
      cidr: '192.0.2.10',
      label: 'Missing capability',
      source: 'db_managed',
      reason: 'operator change',
    })).rejects.toBeInstanceOf(ForbiddenException);

    await service.createAllowlistRecord({
      actorUserId,
      hasSecurityManage: true,
      cidr: '192.0.2.10',
      label: 'Ops office',
      source: 'db_managed',
      reason: 'approved admin workstation',
      requestId: 'req-change',
    });

    expect(db._values).toHaveBeenCalledWith(
      expect.objectContaining({
        cidr: '192.0.2.10',
        label: 'Ops office',
        source: 'db_managed',
        reason: 'approved admin workstation',
        auditLogId: 'audit-1',
      }),
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        action: 'security.allowlist.update',
        resourceType: 'admin_access_allowlist',
        resourceId: '192.0.2.10',
        status: 'denied',
      }),
      db,
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        action: 'security.allowlist.update',
        resourceType: 'admin_access_allowlist',
        resourceId: '192.0.2.10',
        status: 'success',
        requestId: 'req-change',
      }),
      db,
    );
  });
});
