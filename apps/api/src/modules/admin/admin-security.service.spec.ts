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
  const from = vi.fn().mockReturnValue({ where });
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

    const decision = await service.evaluateRequest(requestWithIp('203.0.113.10'), {
      actorUserId,
    });

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

    await expect(service.evaluateRequest(requestWithIp('203.0.113.88'), {
      actorUserId,
    })).resolves.toMatchObject({
      allowed: true,
      source: 'env_bootstrap',
      matchedCidr: '203.0.113.0/24',
    });
  });

  it('allows production DB-managed temporary exceptions and writes audit evidence', async () => {
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

    const decision = await service.evaluateRequest(requestWithIp('198.51.100.77'), {
      actorUserId,
      requestId: 'req-temp',
    });

    expect(decision).toMatchObject({
      allowed: true,
      source: 'temporary_exception',
      matchedCidr: '198.51.100.0/24',
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        action: 'security.allowlist.update',
        resourceType: 'admin_access_allowlist',
        resourceId: 'allowlist-temp-1',
        status: 'success',
        requestId: 'req-temp',
      }),
    );
  });

  it('denies production requests outside env and DB allowlists with audit evidence', async () => {
    const db = createMockDb();
    const audit = createMockAuditService();
    const service = new AdminSecurityService(db as never, audit, {
      env: {
        NODE_ENV: 'production',
        ADMIN_IP_ALLOWLIST_CIDRS: '203.0.113.0/24',
      },
    });

    const decision = await service.evaluateRequest(requestWithIp('198.51.100.9'), {
      actorUserId,
      requestId: 'req-deny',
    });

    expect(decision).toMatchObject({
      allowed: false,
      source: 'denied',
      ipAddress: '198.51.100.9',
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        action: 'security.allowlist.update',
        resourceType: 'admin_access_allowlist',
        resourceId: '198.51.100.9',
        status: 'denied',
        requestId: 'req-deny',
      }),
    );
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
