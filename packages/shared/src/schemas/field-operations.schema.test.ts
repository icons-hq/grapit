import { describe, expect, it } from 'vitest';

import {
  FIELD_CHECK_IN_OUTCOMES,
  FIELD_OFFLINE_SYNC_STATES,
  fieldCheckInConsumeRequestSchema,
  fieldCheckInVerifyRequestSchema,
  fieldMonitorLogFilterSchema,
  fieldMonitorSummarySchema,
  fieldOfflineSyncAttemptSchema,
  fieldOfflineSyncResponseSchema,
  settlementExportRequestSchema,
  settlementExportResponseSchema,
  settlementSummarySchema,
} from './field-operations.schema';
import { fieldCheckInVerifyRequestSchema as exportedVerifyRequestSchema } from '../index';

const VALID_SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const VALID_EVENT_ID = 'event-girl-rules-20260704';
const VALID_ISO = '2026-07-04T09:00:00.000Z';

const FORBIDDEN_VISIBLE_FIELDS = [
  'email',
  'phone',
  'rawToken',
  'rawJti',
  'paymentKey',
  'cookie',
];

describe('field operations contract', () => {
  it('accepts opaque token or QR URL verify requests without state-changing confirmation or raw PII fields', () => {
    expect(
      fieldCheckInVerifyRequestSchema.parse({
        token: 'opaque-ticket-token',
        showtimeId: VALID_SHOWTIME_ID,
      }),
    ).toEqual({
      token: 'opaque-ticket-token',
      showtimeId: VALID_SHOWTIME_ID,
    });

    expect(
      fieldCheckInVerifyRequestSchema.parse({
        qrUrl: 'https://heygrabit.com/field/check-in?token=opaque-ticket-token',
      }).qrUrl,
    ).toBe('https://heygrabit.com/field/check-in?token=opaque-ticket-token');

    expect(() =>
      fieldCheckInVerifyRequestSchema.parse({
        token: 'opaque-ticket-token',
        confirmed: true,
      }),
    ).toThrow();

    for (const field of FORBIDDEN_VISIBLE_FIELDS) {
      expect(() =>
        fieldCheckInVerifyRequestSchema.parse({
          token: 'opaque-ticket-token',
          [field]: 'leak',
        }),
      ).toThrow();
    }
  });

  it('requires explicit manual consume fields and confirmed true after scanner review', () => {
    const parsed = fieldCheckInConsumeRequestSchema.parse({
      token: 'opaque-ticket-token',
      showtimeId: VALID_SHOWTIME_ID,
      deviceAttemptId: 'device-attempt-1',
      confirmed: true,
    });

    expect(parsed.confirmed).toBe(true);
    expect(parsed.deviceAttemptId).toBe('device-attempt-1');

    expect(() =>
      fieldCheckInConsumeRequestSchema.parse({
        token: 'opaque-ticket-token',
        showtimeId: VALID_SHOWTIME_ID,
        deviceAttemptId: 'device-attempt-1',
      }),
    ).toThrow(/확인/);

    expect(() =>
      fieldCheckInConsumeRequestSchema.parse({
        token: 'opaque-ticket-token',
        showtimeId: VALID_SHOWTIME_ID,
        confirmed: true,
      }),
    ).toThrow(/attempt/);
  });

  it('models server-authoritative field outcomes and offline sync states', () => {
    expect(FIELD_CHECK_IN_OUTCOMES).toEqual([
      'processable',
      'entered',
      'duplicate',
      'tampered',
      'refunded_cancelled',
      'expired',
      'wrong_showtime',
      'already_used',
      'offline_pending',
      'synced',
      'rejected',
    ]);
    expect(FIELD_OFFLINE_SYNC_STATES).toEqual(['pending', 'synced', 'rejected']);

    const pending = fieldOfflineSyncAttemptSchema.parse({
      deviceAttemptId: 'device-attempt-1',
      scannerUserId: 'scanner-user-1',
      showtimeId: VALID_SHOWTIME_ID,
      attemptedAt: VALID_ISO,
      redactedTokenRef: 'tok_abc...xyz',
      syncState: 'pending',
    });

    expect(pending.syncState).toBe('pending');
    expect(pending.redactedTokenRef).toBe('tok_abc...xyz');

    const response = fieldOfflineSyncResponseSchema.parse({
      results: [
        {
          deviceAttemptId: 'device-attempt-1',
          syncState: 'synced',
          outcome: 'entered',
          resolvedAt: VALID_ISO,
        },
        {
          deviceAttemptId: 'device-attempt-2',
          syncState: 'rejected',
          outcome: 'tampered',
          resolvedAt: VALID_ISO,
          reason: 'signature mismatch',
        },
      ],
    });

    expect(response.results.map((result) => result.syncState)).toEqual([
      'synced',
      'rejected',
    ]);
  });

  it('defines KPI-first monitor DTOs and secondary log filters without raw token or PII rows', () => {
    const summary = fieldMonitorSummarySchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      enteredCount: 120,
      notEnteredCount: 30,
      entryRate: 0.8,
      duplicateScanCount: 3,
      rejectedScanCount: 2,
      offlinePendingCount: 4,
      offlineSyncedCount: 8,
      latestAbnormalAlerts: [
        {
          type: 'duplicate_spike',
          severity: 'warning',
          message: 'Duplicate scans increased',
          count: 3,
          detectedAt: VALID_ISO,
        },
      ],
      updatedAt: VALID_ISO,
    });

    expect(summary.latestAbnormalAlerts[0]?.type).toBe('duplicate_spike');
    expect(summary.offlinePendingCount).toBe(4);

    const filters = fieldMonitorLogFilterSchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      outcome: 'duplicate',
      syncState: 'rejected',
      scannerUserId: 'scanner-user-1',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-05',
    });

    expect(filters.outcome).toBe('duplicate');

    for (const field of FORBIDDEN_VISIBLE_FIELDS) {
      expect(() =>
        fieldMonitorLogFilterSchema.parse({
          eventId: VALID_EVENT_ID,
          [field]: 'leak',
        }),
      ).toThrow();
    }
  });

  it('defines settlement summary and export datasets for post-event operations', () => {
    const summary = settlementSummarySchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      currency: 'KRW',
      grossSalesAmount: 3_000_000,
      paidReservationCount: 150,
      refundedAmount: 200_000,
      refundCount: 4,
      enteredCount: 120,
      noShowCount: 30,
      entryRate: 0.8,
      generatedAt: VALID_ISO,
    });

    expect(summary.noShowCount).toBe(30);

    const request = settlementExportRequestSchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      dataset: 'settlement_accounting_input',
      reason: 'post-event settlement reconciliation',
    });

    expect(request.dataset).toBe('settlement_accounting_input');

    const response = settlementExportResponseSchema.parse({
      exportId: 'export-1',
      dataset: 'entry_status',
      filename: 'entry-status.csv',
      rowCount: 150,
      generatedAt: VALID_ISO,
    });

    expect(response.rowCount).toBe(150);

    for (const dataset of [
      'entry_status',
      'no_show_reservations',
      'reservation_payment_refund_summary',
      'settlement_accounting_input',
    ]) {
      expect(settlementExportRequestSchema.parse({
        eventId: VALID_EVENT_ID,
        dataset,
        reason: 'operator requested export',
      }).dataset).toBe(dataset);
    }
  });

  it('exports field operations contracts from the shared barrel', () => {
    expect(exportedVerifyRequestSchema).toBe(fieldCheckInVerifyRequestSchema);
  });
});
