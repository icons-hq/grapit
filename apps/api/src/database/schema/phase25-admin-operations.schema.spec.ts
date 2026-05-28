import { describe, expect, it } from 'vitest';

import {
  adminAccessAllowlist,
  adminAllowlistSourceEnum,
  adminAllowlistStatusEnum,
  adminAuditActionEnum,
  adminAuditLogs,
  adminAuditStatusEnum,
  seatInventories,
  seatOperationActionEnum,
  seatOperationHistory,
  seatStatusEnum,
  users,
} from './index.js';
import * as schemaBarrel from './index.js';

function expectColumnName(column: { name: string } | undefined, name: string) {
  expect(column?.name).toBe(name);
}

describe('Phase 25 admin operations security schema contracts', () => {
  it('covers all D-10 sensitive admin audit actions through the schema barrel', () => {
    expect(schemaBarrel).toHaveProperty('adminAuditLogs');
    expect(schemaBarrel).toHaveProperty('adminAuditActionEnum');
    expect(schemaBarrel).toHaveProperty('adminAuditStatusEnum');

    expect(adminAuditActionEnum.enumValues).toEqual([
      'event.publish',
      'event.update',
      'refund.admin_refund',
      'support.escalate',
      'seat.disable',
      'seat.reactivate',
      'seat.manual_open',
      'banner.manage',
      'reservations.export_raw',
      'field.scan.verify',
      'field.scan.consume',
      'field.scan.offline_sync',
      'settlement.export',
      'security.allowlist.update',
      'security.permission.update',
      'user.withdraw',
      'user.hard_delete',
      'user.export_raw',
    ]);
    expect(adminAuditStatusEnum.enumValues).toEqual([
      'success',
      'denied',
      'failed',
    ]);

    expectColumnName(adminAuditLogs.actorUserId, 'actor_user_id');
    expectColumnName(adminAuditLogs.action, 'action');
    expectColumnName(adminAuditLogs.resourceType, 'resource_type');
    expectColumnName(adminAuditLogs.resourceId, 'resource_id');
    expectColumnName(adminAuditLogs.status, 'status');
    expectColumnName(adminAuditLogs.reason, 'reason');
    expectColumnName(adminAuditLogs.ipAddress, 'ip_address');
    expectColumnName(adminAuditLogs.userAgent, 'user_agent');
    expectColumnName(adminAuditLogs.requestId, 'request_id');
    expectColumnName(adminAuditLogs.createdAt, 'created_at');
  });

  it('uses masked JSON diff columns instead of raw exported row storage', () => {
    expectColumnName(adminAuditLogs.changedFields, 'changed_fields');
    expectColumnName(
      adminAuditLogs.maskedBeforeSnapshot,
      'masked_before_snapshot',
    );
    expectColumnName(
      adminAuditLogs.maskedAfterSnapshot,
      'masked_after_snapshot',
    );
    expect(adminAuditLogs).not.toHaveProperty('rawExportRows');
    expect(adminAuditLogs).not.toHaveProperty('rawPiiSnapshot');
  });

  it('persists per-admin capability truth on user rows for capability guards', () => {
    expectColumnName(users.adminCapabilityBundle, 'admin_capability_bundle');
    expectColumnName(users.adminCapabilities, 'admin_capabilities');
    expectColumnName(users.accountStatus, 'account_status');
    expectColumnName(users.withdrawnAt, 'withdrawn_at');
    expectColumnName(users.withdrawalReason, 'withdrawal_reason');
    expectColumnName(users.withdrawnByUserId, 'withdrawn_by_user_id');
    expectColumnName(users.withdrawalSource, 'withdrawal_source');
  });

  it('stores env bootstrap allowlist records and DB-managed exceptions with audit linkage', () => {
    expect(schemaBarrel).toHaveProperty('adminAccessAllowlist');
    expect(schemaBarrel).toHaveProperty('adminAllowlistSourceEnum');
    expect(schemaBarrel).toHaveProperty('adminAllowlistStatusEnum');

    expect(adminAllowlistSourceEnum.enumValues).toEqual([
      'env_bootstrap',
      'db_managed',
      'temporary_exception',
    ]);
    expect(adminAllowlistStatusEnum.enumValues).toEqual([
      'active',
      'disabled',
      'expired',
    ]);

    expectColumnName(adminAccessAllowlist.cidr, 'cidr');
    expectColumnName(adminAccessAllowlist.label, 'label');
    expectColumnName(adminAccessAllowlist.source, 'source');
    expectColumnName(adminAccessAllowlist.status, 'status');
    expectColumnName(adminAccessAllowlist.reason, 'reason');
    expectColumnName(adminAccessAllowlist.createdByUserId, 'created_by_user_id');
    expectColumnName(adminAccessAllowlist.auditLogId, 'audit_log_id');
    expectColumnName(adminAccessAllowlist.expiresAt, 'expires_at');
    expectColumnName(adminAccessAllowlist.createdAt, 'created_at');
    expectColumnName(adminAccessAllowlist.updatedAt, 'updated_at');
  });
});

describe('Phase 25 admin seat operation schema contracts', () => {
  it('adds durable disabled seat inventory state before seat operation APIs', () => {
    expect(seatStatusEnum.enumValues).toEqual([
      'available',
      'locked',
      'held_cancelled',
      'sold',
      'disabled',
    ]);
    expectColumnName(seatInventories.status, 'status');
  });

  it('persists seat-centric disable/reactivate/manual-open history with audit linkage', () => {
    expect(schemaBarrel).toHaveProperty('seatOperationHistory');
    expect(schemaBarrel).toHaveProperty('seatOperationActionEnum');

    expect(seatOperationActionEnum.enumValues).toEqual([
      'seat.disable',
      'seat.reactivate',
      'seat.manual_open',
    ]);

    expectColumnName(seatOperationHistory.actorUserId, 'actor_user_id');
    expectColumnName(seatOperationHistory.action, 'action');
    expectColumnName(seatOperationHistory.showtimeId, 'showtime_id');
    expectColumnName(seatOperationHistory.seatInventoryId, 'seat_inventory_id');
    expectColumnName(seatOperationHistory.seatId, 'seat_id');
    expectColumnName(seatOperationHistory.floorKey, 'floor_key');
    expectColumnName(seatOperationHistory.seatKey, 'seat_key');
    expectColumnName(seatOperationHistory.previousStatus, 'previous_status');
    expectColumnName(seatOperationHistory.nextStatus, 'next_status');
    expectColumnName(seatOperationHistory.reason, 'reason');
    expectColumnName(seatOperationHistory.auditLogId, 'audit_log_id');
    expectColumnName(seatOperationHistory.reservationId, 'reservation_id');
    expectColumnName(seatOperationHistory.createdAt, 'created_at');
  });
});
