import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  adminAuditActionEnum,
  ticketScanEvents,
  ticketScanResultEnum,
  ticketScanSourceEnum,
  ticketScanSyncStateEnum,
} from './index.js';
import * as schemaBarrel from './index.js';
import { ADMIN_AUDIT_ACTIONS } from '../../modules/admin/admin-audit.service.js';

function expectColumnName(column: { name: string } | undefined, name: string) {
  expect(column?.name).toBe(name);
}

function indexNames(table: unknown) {
  return getTableConfig(table as never).indexes.map((index) => index.config.name);
}

describe('Phase 27 ticket scan event schema contracts', () => {
  it('exports append-only scan event schema and enums through the schema barrel', () => {
    expect(schemaBarrel).toHaveProperty('ticketScanEvents');
    expect(schemaBarrel).toHaveProperty('ticketScanResultEnum');
    expect(schemaBarrel).toHaveProperty('ticketScanSourceEnum');
    expect(schemaBarrel).toHaveProperty('ticketScanSyncStateEnum');

    expect(ticketScanResultEnum.enumValues).toEqual([
      'success',
      'duplicate',
      'tampered',
      'refunded_cancelled',
      'expired',
      'wrong_showtime',
      'already_used',
      'offline_pending',
      'offline_synced',
      'offline_rejected',
      'sync_failure',
    ]);
    expect(ticketScanSourceEnum.enumValues).toEqual([
      'online',
      'offline_sync',
    ]);
    expect(ticketScanSyncStateEnum.enumValues).toEqual([
      'not_required',
      'pending',
      'synced',
      'rejected',
      'failed',
    ]);
  });

  it('stores redacted scanner evidence without raw QR token, PII, or payment fields', () => {
    expectColumnName(ticketScanEvents.ticketId, 'ticket_id');
    expectColumnName(ticketScanEvents.reservationId, 'reservation_id');
    expectColumnName(ticketScanEvents.showtimeId, 'showtime_id');
    expectColumnName(ticketScanEvents.scannerUserId, 'scanner_user_id');
    expectColumnName(ticketScanEvents.result, 'result');
    expectColumnName(ticketScanEvents.source, 'source');
    expectColumnName(ticketScanEvents.syncState, 'sync_state');
    expectColumnName(ticketScanEvents.priorScanEventId, 'prior_scan_event_id');
    expectColumnName(ticketScanEvents.deviceAttemptId, 'device_attempt_id');
    expectColumnName(ticketScanEvents.maskedJti, 'masked_jti');
    expectColumnName(ticketScanEvents.rejectionReason, 'rejection_reason');
    expectColumnName(ticketScanEvents.metadata, 'metadata');
    expectColumnName(ticketScanEvents.scannedAt, 'scanned_at');
    expectColumnName(ticketScanEvents.syncedAt, 'synced_at');
    expectColumnName(ticketScanEvents.createdAt, 'created_at');

    expect(ticketScanEvents).not.toHaveProperty('rawToken');
    expect(ticketScanEvents).not.toHaveProperty('rawJti');
    expect(ticketScanEvents).not.toHaveProperty('email');
    expect(ticketScanEvents).not.toHaveProperty('phone');
    expect(ticketScanEvents).not.toHaveProperty('paymentKey');
    expect(ticketScanEvents).not.toHaveProperty('cookie');
  });

  it('adds indexes needed by monitor, offline sync, settlement, and replay checks', () => {
    expect(indexNames(ticketScanEvents)).toEqual(
      expect.arrayContaining([
        'idx_ticket_scan_events_showtime_id',
        'idx_ticket_scan_events_result',
        'idx_ticket_scan_events_scanner_user_id',
        'idx_ticket_scan_events_device_attempt_id',
        'idx_ticket_scan_events_created_at',
        'idx_ticket_scan_events_device_attempt_unique',
      ]),
    );
  });

  it('attributes scans to the gate showtime and allows missing ticket identity only for unverifiable QR scans', () => {
    expectColumnName(ticketScanEvents.requestedShowtimeId, 'requested_showtime_id');
    expect(ticketScanEvents.requestedShowtimeId.notNull).toBe(false);
    expect(ticketScanEvents.ticketId.notNull).toBe(false);
    expect(ticketScanEvents.reservationId.notNull).toBe(false);
    expect(ticketScanEvents.showtimeId.notNull).toBe(false);
    expect(indexNames(ticketScanEvents)).toContain('idx_ticket_scan_events_requested_showtime_id');
    expect(getTableConfig(ticketScanEvents).checks.map((check) => check.name))
      .toContain('ticket_scan_events_attribution_check');

    const migrationsDir = resolve(__dirname, '../migrations');
    const journal = JSON.parse(readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    const entry = journal.entries.find((candidate) => candidate.tag.endsWith('_field_scan_event_attribution'));
    expect(entry).toBeDefined();
    const migration = readFileSync(resolve(migrationsDir, `${entry!.tag}.sql`), 'utf8');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "requested_showtime_id" uuid');
    for (const column of ['ticket_id', 'reservation_id', 'showtime_id']) {
      expect(migration).toContain(`ALTER COLUMN "${column}" DROP NOT NULL`);
    }
    expect(migration).toContain('"ticket_scan_events_attribution_check" CHECK');
    expect(migration).toContain(`OR ("result" = 'tampered' AND "requested_showtime_id" IS NOT NULL)`);
    expect(migration).toContain(`"metadata"->>'requestedShowtimeId'`);
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "idx_ticket_scan_events_requested_showtime_id"');
    expect(migration).not.toMatch(/\bDROP (TABLE|COLUMN)\b|\bDELETE FROM\b|\bTRUNCATE\b/);
  });

  it('extends admin audit action contracts for field scan and settlement evidence', () => {
    expect(adminAuditActionEnum.enumValues).toEqual(
      expect.arrayContaining([
        'field.scan.verify',
        'field.scan.consume',
        'field.scan.offline_sync',
        'settlement.export',
      ]),
    );
    expect(ADMIN_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'field.scan.verify',
        'field.scan.consume',
        'field.scan.offline_sync',
        'settlement.export',
      ]),
    );
  });
});
