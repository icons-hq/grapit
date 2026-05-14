import { describe, expect, it } from 'vitest';

import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  adminAuditEventSchema,
  adminCapabilitySchema,
  adminSeatOperationHistorySchema,
  adminReservationExportFilterSchema,
  adminSecurityStatusSchema,
  adminSeatOperationRequestSchema,
} from './admin-operations.schema';

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
    ];

    expect(ADMIN_CAPABILITIES).toEqual(requiredCapabilities);
    expect(adminCapabilitySchema.parse('event.publish')).toBe('event.publish');
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.admin).toEqual(requiredCapabilities);
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.operator).toContain('support.manage');
    expect(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.operator).not.toContain(
      'reservations.export_raw',
    );
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
      reservationStatus: 'CONFIRMED',
      audienceRegion: 'domestic',
      paymentMethod: 'CARD',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      exportType: 'raw_pii',
      reason: 'settlement reconciliation',
    });

    expect(parsed.exportType).toBe('raw_pii');
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
