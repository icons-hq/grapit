import { describe, expect, it } from 'vitest';

import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  adminAuditEventSchema,
  adminCapabilitySchema,
  adminUserExportRequestSchema,
  adminUserListItemSchema,
  adminUserPermissionUpdateSchema,
  adminUserStatsResponseSchema,
  adminSeatOperationHistorySchema,
  adminReservationExportFilterSchema,
  adminSecurityStatusSchema,
  adminSeatOperationRequestSchema,
} from './admin-operations.schema';
import { resolveAdminCapabilitySnapshot } from '../types/admin-operations.types';

const VALID_SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';

describe('admin operations contract', () => {
  it('defines required capabilities and keeps admin as the all-capabilities bundle', () => {
    const requiredCapabilities = [
      'event.write',
      'event.publish',
      'support.manage',
      'support.escalate',
      'reservations.export_raw',
      'seat.disable',
      'seat.reactivate',
      'seat.manual_open',
      'banner.manage',
      'audit.read',
      'security.manage',
      'field.scan.verify',
      'field.scan.consume',
      'field.scan.sync',
      'settlement.export',
    ];

    expect(ADMIN_CAPABILITIES).toEqual(requiredCapabilities);
    expect(adminCapabilitySchema.parse('field.scan.verify')).toBe('field.scan.verify');
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.admin).toEqual(requiredCapabilities);
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.operator).toContain('support.manage');
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.operator).not.toContain(
      'reservations.export_raw',
    );
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.finance).toContain('settlement.export');
  });

  it('defines scanner as a lower-privilege field scan bundle only', () => {
    expect(ADMIN_CAPABILITY_BUNDLES).toContain('scanner');
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.scanner).toEqual([
      'field.scan.verify',
      'field.scan.consume',
      'field.scan.sync',
    ]);

    const scannerCapabilities = ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.scanner;
    const sensitiveFragments = [
      'reservations.export_raw',
      'security.manage',
      'settlement.export',
      'refund',
      'reservation',
      'user',
      'content',
    ];

    for (const fragment of sensitiveFragments) {
      expect(
        scannerCapabilities.some((capability) => capability.includes(fragment)),
      ).toBe(false);
    }
  });

  it('validates masked audit events for sensitive admin actions', () => {
    const parsed = adminAuditEventSchema.parse({
      id: 'audit-1',
      actorUserId: 'admin-1',
      action: 'event.publish',
      resourceType: 'performance',
      resourceId: 'performance-1',
      status: 'success',
      reason: 'launch publish check complete',
      changedFields: ['status', 'saleStartAt'],
      diff: {
        before: { status: 'draft' },
        after: { status: 'published' },
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Vitest',
      createdAt: '2026-05-14T00:00:00.000Z',
    });

    expect(parsed.action).toBe('event.publish');
    expect(parsed.diff.after).toEqual({ status: 'published' });
  });

  it('validates raw user export audit actions and reasoned export requests', () => {
    const audit = adminAuditEventSchema.parse({
      id: 'audit-user-export-1',
      actorUserId: 'admin-1',
      action: 'user.export_raw',
      resourceType: 'user_export',
      resourceId: 'raw_pii',
      status: 'success',
      reason: 'membership operations reconciliation',
      changedFields: ['columns', 'rowCount'],
      diff: {
        after: {
          columns: ['id', 'email'],
          rowCount: 2,
        },
      },
      createdAt: '2026-05-18T00:00:00.000Z',
    });

    expect(audit.action).toBe('user.export_raw');
    expect(() => adminUserExportRequestSchema.parse({ reason: '' })).toThrow(/사유/);
    expect(
      adminUserExportRequestSchema.parse({
        reason: ' membership operations reconciliation ',
      }).reason,
    ).toBe('membership operations reconciliation');
  });

  it('validates admin user list rows with masked contact fields and capability truth', () => {
    const parsed = adminUserListItemSchema.parse({
      id: 'user-1',
      maskedEmail: 'fa***@example.com',
      name: 'Fan',
      maskedPhone: '+82********78',
      role: 'admin',
      country: 'KR',
      preferredLocale: 'ko',
      marketingConsent: true,
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage', 'seat.disable'],
      verificationState: {
        emailVerified: true,
        phoneVerified: true,
      },
      reservationSummary: {
        total: 2,
        statuses: {
          pendingPayment: 1,
          confirmed: 1,
          cancelled: 0,
          failed: 0,
        },
        lastReservationAt: '2026-05-14T00:00:00.000Z',
      },
      lastActivityAt: '2026-05-14T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });

    expect(parsed.maskedEmail).toBe('fa***@example.com');
    expect(parsed.adminCapabilities).toContain('support.manage');
  });

  it('validates admin user statistics response with ratio buckets and signup trend', () => {
    const parsed = adminUserStatsResponseSchema.parse({
      total: 10,
      active: 8,
      withdrawn: 2,
      verification: {
        emailVerified: 7,
        phoneVerified: 6,
        fullyVerified: 5,
      },
      marketing: {
        consented: 4,
        notConsented: 6,
      },
      countries: [
        { value: 'KR', count: 6, ratio: 0.6 },
        { value: 'TH', count: 4, ratio: 0.4 },
      ],
      locales: [
        { value: 'ko', count: 7, ratio: 0.7 },
        { value: 'th', count: 3, ratio: 0.3 },
      ],
      signupTrend: [
        { date: '2026-05-17', count: 1 },
        { date: '2026-05-18', count: 2 },
      ],
      generatedAt: '2026-05-18T00:00:00.000Z',
    });

    expect(parsed.countries[0]?.ratio).toBe(0.6);
    expect(parsed.signupTrend[1]?.count).toBe(2);
  });

  it('requires reason and explicit confirmation for admin permission updates', () => {
    expect(() =>
      adminUserPermissionUpdateSchema.parse({
        role: 'admin',
        adminCapabilityBundle: 'admin',
        adminCapabilities: ['security.manage'],
        confirmed: true,
      }),
    ).toThrow(/사유/);

    expect(() =>
      adminUserPermissionUpdateSchema.parse({
        role: 'admin',
        adminCapabilityBundle: 'admin',
        reason: 'security owner rotation',
      }),
    ).toThrow(/확인/);

    const parsed = adminUserPermissionUpdateSchema.parse({
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: ['security.manage'],
      reason: 'security owner rotation',
      confirmed: true,
    });

    expect(parsed.confirmed).toBe(true);
    expect(parsed.reason).toBe('security owner rotation');
  });

  it('limits explicit non-admin bundles even when the coarse role remains admin', () => {
    expect(
      resolveAdminCapabilitySnapshot({
        id: 'admin-1',
        role: 'admin',
      }).superuser,
    ).toBe(true);

    const limited = resolveAdminCapabilitySnapshot({
      id: 'admin-2',
      role: 'admin',
      adminCapabilityBundle: 'operator',
      adminCapabilities: ['support.manage'],
    });

    expect(limited.superuser).toBe(false);
    expect(limited.capabilities).toEqual(['support.manage']);
    expect(limited.capabilities).not.toContain('security.manage');
  });

  it('resolves scanner capability snapshots as non-superuser field scan access', () => {
    const scanner = resolveAdminCapabilitySnapshot({
      id: 'scanner-1',
      role: 'admin',
      adminCapabilityBundle: 'scanner',
    });

    expect(scanner.bundle).toBe('scanner');
    expect(scanner.superuser).toBe(false);
    expect(scanner.capabilities).toEqual([
      'field.scan.verify',
      'field.scan.consume',
      'field.scan.sync',
    ]);
    expect(scanner.capabilities).not.toContain('settlement.export');
    expect(scanner.capabilities).not.toContain('reservations.export_raw');
    expect(scanner.capabilities).not.toContain('security.manage');

    const fixtureScanner = resolveAdminCapabilitySnapshot({
      id: 'scanner-2',
      role: 'scanner',
    });

    expect(fixtureScanner.bundle).toBe('scanner');
    expect(fixtureScanner.superuser).toBe(false);
  });

  it('requires a reason when raw reservation export can expose PII', () => {
    expect(() =>
      adminReservationExportFilterSchema.parse({
        eventId: 'event-1',
        tierName: 'VIP',
        zoneFloor: '1F',
        reservationStatus: 'CONFIRMED',
        audienceRegion: 'overseas',
        paymentMethod: 'ALIPAY_PLUS',
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
        exportType: 'raw_pii',
      }),
    ).toThrow(/사유/);

    const parsed = adminReservationExportFilterSchema.parse({
      eventId: 'event-1',
      tierName: 'VIP',
      zoneFloor: '1F',
      funnelStatus: 'PAYMENT_FAILED',
      audienceRegion: 'domestic',
      paymentMethod: 'CARD',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      exportType: 'raw_pii',
      reason: 'settlement reconciliation',
    });

    expect(parsed.exportType).toBe('raw_pii');
    expect(parsed.funnelStatus).toBe('PAYMENT_FAILED');
  });

  it('represents MFA only as a deferred accepted risk', () => {
    const parsed = adminSecurityStatusSchema.parse({
      mfa: {
        status: 'deferred_accepted_risk',
        note: 'MFA is tracked as a deferred accepted risk for Phase 25.',
      },
      ipAllowlist: {
        mode: 'enforced',
        activeRecords: 2,
        lastChangedAt: '2026-05-14T00:00:00.000Z',
      },
    });

    expect(parsed.mfa.status).toBe('deferred_accepted_risk');
    expect(() =>
      adminSecurityStatusSchema.parse({
        mfa: { status: 'complete' },
        ipAllowlist: { mode: 'enforced', activeRecords: 1 },
      }),
    ).toThrow();
    expect(() =>
      adminSecurityStatusSchema.parse({
        mfa: { status: 'implemented' },
        ipAllowlist: { mode: 'enforced', activeRecords: 1 },
      }),
    ).toThrow();
  });

  it('requires reasons for seat operations that change capacity', () => {
    const parsed = adminSeatOperationRequestSchema.parse({
      operation: 'seat.disable',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '1F:A-1',
      reason: 'facility sightline blocked',
      confirmed: true,
    });

    expect(parsed.operation).toBe('seat.disable');
    expect(() =>
      adminSeatOperationRequestSchema.parse({
        operation: 'seat.reactivate',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '1F:A-1',
        confirmed: true,
      }),
    ).toThrow(/사유/);
  });

  it('rejects malformed admin seat operation showtime IDs', () => {
    expect(() =>
      adminSeatOperationRequestSchema.parse({
        operation: 'seat.disable',
        showtimeId: 'malformed-showtime-id',
        seatKey: '1F:A-1',
        reason: '시야 제한',
        confirmed: true,
      }),
    ).toThrow(/회차 ID/);

    expect(() =>
      adminSeatOperationHistorySchema.parse({
        id: 'history-1',
        operation: 'seat.disable',
        showtimeId: 'malformed-showtime-id',
        seatKey: '1F:A-1',
        previousStatus: 'available',
        nextStatus: 'disabled',
        reason: '시야 제한',
        actorUserId: 'admin-1',
        auditEventId: 'audit-1',
        createdAt: '2026-05-14T00:00:00.000Z',
      }),
    ).toThrow(/회차 ID/);

    expect(
      adminSeatOperationRequestSchema.parse({
        operation: 'seat.disable',
        showtimeId: VALID_SHOWTIME_ID,
        seatKey: '1F:A-1',
        reason: '시야 제한',
        confirmed: true,
      }).showtimeId,
    ).toBe(VALID_SHOWTIME_ID);
  });
});
