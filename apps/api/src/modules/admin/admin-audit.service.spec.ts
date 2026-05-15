import { describe, expect, it, vi } from 'vitest';

import {
  ADMIN_AUDIT_ACTIONS,
  AdminAuditService,
  type AdminAuditAction,
  type AdminAuditStatus,
} from './admin-audit.service.js';

function createMockDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'audit-1' }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    insert,
    _values: values,
  };
}

function writeInput(overrides: {
  action?: AdminAuditAction;
  status?: AdminAuditStatus;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
} = {}) {
  return {
    actorUserId: '00000000-0000-4000-8000-000000000001',
    action: overrides.action ?? 'event.publish',
    resourceType: 'performance',
    resourceId: 'perf-1',
    status: overrides.status ?? 'success',
    reason: 'operator confirmed sensitive action',
    before: overrides.before ?? {},
    after: overrides.after ?? {},
    ipAddress: '198.51.100.10',
    userAgent: 'Vitest Admin Console',
    requestId: 'req-25-07',
  };
}

describe('AdminAuditService', () => {
  it('supports every D-10 sensitive admin action and status', async () => {
    const db = createMockDb();
    const service = new AdminAuditService(db as never);
    const statuses: AdminAuditStatus[] = ['success', 'denied', 'failed'];

    for (const [index, action] of ADMIN_AUDIT_ACTIONS.entries()) {
      await service.write(writeInput({
        action,
        status: statuses[index % statuses.length]!,
      }));
    }

    expect(ADMIN_AUDIT_ACTIONS).toEqual([
      'event.publish',
      'event.update',
      'refund.admin_refund',
      'support.escalate',
      'seat.disable',
      'seat.reactivate',
      'seat.manual_open',
      'banner.manage',
      'reservations.export_raw',
      'security.allowlist.update',
      'security.permission.update',
    ]);
    expect(db._values).toHaveBeenCalledTimes(ADMIN_AUDIT_ACTIONS.length);
    expect(db._values.mock.calls.map(([row]) => row.action)).toEqual(
      ADMIN_AUDIT_ACTIONS,
    );
    expect(db._values.mock.calls.map(([row]) => row.status)).toContain('denied');
    expect(db._values.mock.calls.map(([row]) => row.status)).toContain('failed');
  });

  it('uses an explicit transaction client for atomic mutation plus audit writes', async () => {
    const db = createMockDb();
    const tx = createMockDb();
    const service = new AdminAuditService(db as never);

    await service.write(writeInput({ action: 'seat.disable' }), tx as never);

    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('stores only masked changed-field snapshots for PII, credentials, OTPs, tokens, and IPs', async () => {
    const db = createMockDb();
    const service = new AdminAuditService(db as never);

    await service.write(writeInput({
      action: 'security.permission.update',
      before: {
        email: 'operator@example.com',
        phone: '+821012345678',
        ipAddress: '203.0.113.44',
        password: 'plaintext-password',
        token: 'tok_live_sensitive',
        otpCode: '123456',
        credentials: { apiSecret: 'sk_live_secret' },
        displayName: 'Old name',
        unchanged: 'same',
      },
      after: {
        email: 'changed@example.com',
        phone: '+821099988877',
        ipAddress: '203.0.113.99',
        password: 'new-plaintext-password',
        token: 'new_tok_live_sensitive',
        otpCode: '654321',
        credentials: { apiSecret: 'new_sk_live_secret' },
        displayName: 'New name',
        unchanged: 'same',
      },
    }));

    const [inserted] = db._values.mock.calls[0]!;
    const serialized = JSON.stringify(inserted);

    expect(inserted.changedFields).toEqual([
      'email',
      'phone',
      'ipAddress',
      'password',
      'token',
      'otpCode',
      'credentials',
      'displayName',
    ]);
    expect(inserted.maskedBeforeSnapshot).toMatchObject({
      email: 'op***@example.com',
      phone: '+82********78',
      ipAddress: '203.0.113.0',
      password: '[redacted]',
      token: '[redacted]',
      otpCode: '[redacted]',
      credentials: { apiSecret: '[redacted]' },
      displayName: 'Old name',
    });
    expect(serialized).not.toContain('operator@example.com');
    expect(serialized).not.toContain('+821012345678');
    expect(serialized).not.toContain('plaintext-password');
    expect(serialized).not.toContain('tok_live_sensitive');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('sk_live_secret');
  });

  it('never persists raw CSV export row values in audit snapshots', async () => {
    const db = createMockDb();
    const service = new AdminAuditService(db as never);

    await service.write(writeInput({
      action: 'reservations.export_raw',
      before: {},
      after: {
        exportType: 'raw_pii',
        rawExportRows: [{
          email: 'raw-customer@example.com',
          phone: '+821055501234',
          reservationNumber: 'R-RAW-001',
          amount: 99000,
        }],
        csvRows: ['=HYPERLINK("https://evil.example")'],
        filters: { eventId: 'event-1' },
      },
    }));

    const [inserted] = db._values.mock.calls[0]!;
    const serialized = JSON.stringify(inserted);

    expect(inserted.maskedAfterSnapshot).toMatchObject({
      exportType: 'raw_pii',
      rawExportRows: '[redacted:csv_rows:1]',
      csvRows: '[redacted:csv_rows:1]',
      filters: { eventId: 'event-1' },
    });
    expect(serialized).not.toContain('raw-customer@example.com');
    expect(serialized).not.toContain('+821055501234');
    expect(serialized).not.toContain('R-RAW-001');
    expect(serialized).not.toContain('HYPERLINK');
  });
});
