import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AdminSecurityController } from './admin-security.controller.js';
import { AdminSecurityService } from './admin-security.service.js';
import type { AdminAuditService } from './admin-audit.service.js';

function requestWithIp(ip: string): Request {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
    get: vi.fn(() => undefined),
  } as unknown as Request;
}

function createService(env: Record<string, string | undefined>) {
  const rows = [
    {
      id: 'allowlist-office',
      cidr: '198.51.100.0/24',
      label: 'Office',
      source: 'db_managed',
      status: 'active',
      reason: 'office',
      expiresAt: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue(rows),
    }),
  };
  const audit = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AdminAuditService & { write: ReturnType<typeof vi.fn> };

  return {
    audit,
    service: new AdminSecurityService(db as never, audit, { env }),
  };
}

describe('AdminSecurityController status (audit #43)', () => {
  it('never reports production admin IP allowlist as enforced while no guard blocks requests', async () => {
    const { audit, service } = createService({
      NODE_ENV: 'production',
      ADMIN_IP_ALLOWLIST_CIDRS: '203.0.113.0/24',
    });
    const controller = new AdminSecurityController(service);

    const status = await controller.getSecurityStatus(requestWithIp('100.64.0.10'));

    expect(status.ipAllowlist).toEqual({
      mode: 'monitoring',
      activeRecords: 2,
      lastChangedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(status.currentRequest).toMatchObject({
      allowed: false,
      enforced: false,
      source: 'denied',
      maskedIpAddress: '100.64.0.0',
    });
    expect(status.deferredMfaCopy).toContain('차단하지 않는 모니터링 전용');
    expect(status.mfa.note).toBe(status.deferredMfaCopy);
    // Opening the security screen must not write allowlist.update audit rows.
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('reports the allowlist as disabled outside production', async () => {
    const { audit, service } = createService({ NODE_ENV: 'development' });
    const controller = new AdminSecurityController(service);

    const status = await controller.getSecurityStatus(requestWithIp('203.0.113.10'));

    expect(status.ipAllowlist.mode).toBe('disabled');
    expect(status.currentRequest).toMatchObject({
      allowed: true,
      enforced: false,
      source: 'non_production_bypass',
    });
    expect(audit.write).not.toHaveBeenCalled();
  });
});
