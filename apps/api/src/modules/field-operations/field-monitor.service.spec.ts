import { describe, expect, it, vi } from 'vitest';
import type { FieldMonitorSummary } from '@grabit/shared';

import { FieldMonitorService } from './field-monitor.service.js';

function chainResult<T>(rows: T[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }

      return () => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

function createDependencies() {
  const db = {
    select: vi.fn(),
  };
  const service = new FieldMonitorService(db as never);

  return { service, db };
}

const VALID_SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const RAW_QR_TOKEN = 'ey.monitor.raw-token-with-jti';
const FULL_RAW_JTI = 'qr-jti-monitor-full-raw-1234567890';

function expectNoRawMonitorLeak(result: unknown) {
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(RAW_QR_TOKEN);
  expect(serialized).not.toContain(FULL_RAW_JTI);
  expect(serialized).not.toContain('rawToken');
  expect(serialized).not.toContain('rawJti');
  expect(serialized).not.toContain('payment key');
  expect(serialized).not.toContain('session=raw-cookie');
  expect(serialized).not.toContain('+821055501234');
  expect(serialized).not.toContain('buyer@example.com');
}

describe('FieldMonitorService RED contract', () => {
  it('returns KPI-first summary before scan log rows: entered, not-entered, entry rate, duplicate scans, rejected scans, offline pending, offline synced, and abnormal alerts', async () => {
    const { service, db } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([
        {
          totalReservations: 150,
          enteredCount: 120,
          duplicateScanCount: 5,
          rejectedScanCount: 3,
          offlinePendingCount: 4,
          offlineSyncedCount: 8,
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          type: 'duplicate_spike',
          severity: 'warning',
          message: 'Duplicate scans exceeded baseline',
          count: 5,
          detectedAt: new Date('2026-07-04T09:10:00.000Z'),
        },
      ]));

    const summary = await service.getSummary({
      eventId: 'event-girl-rules-20260704',
      showtimeId: VALID_SHOWTIME_ID,
    });

    expect(summary satisfies FieldMonitorSummary).toMatchObject({
      eventId: 'event-girl-rules-20260704',
      showtimeId: VALID_SHOWTIME_ID,
      enteredCount: 120,
      notEnteredCount: 30,
      entryRate: 0.8,
      duplicateScanCount: 5,
      rejectedScanCount: 3,
      offlinePendingCount: 4,
      offlineSyncedCount: 8,
      latestAbnormalAlerts: [
        expect.objectContaining({
          type: 'duplicate_spike',
          severity: 'warning',
          count: 5,
        }),
      ],
    });
    expect(Object.keys(summary).slice(0, 8)).toEqual([
      'eventId',
      'showtimeId',
      'enteredCount',
      'notEnteredCount',
      'entryRate',
      'duplicateScanCount',
      'rejectedScanCount',
      'offlinePendingCount',
    ]);
    expectNoRawMonitorLeak(summary);
  });

  it('raises abnormal alerts for duplicate spikes, rejected/tampered attempts, refunded/cancelled attempts, offline backlog, and sync failures', async () => {
    const { service, db } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([
        {
          totalReservations: 150,
          enteredCount: 100,
          duplicateScanCount: 12,
          rejectedScanCount: 9,
          offlinePendingCount: 17,
          offlineSyncedCount: 3,
        },
      ]))
      .mockReturnValueOnce(chainResult([
        { type: 'duplicate_spike', severity: 'critical', count: 12 },
        { type: 'rejected_tampered_scan', severity: 'critical', count: 4 },
        { type: 'refunded_cancelled_attempt', severity: 'warning', count: 2 },
        { type: 'offline_backlog', severity: 'warning', count: 17 },
        { type: 'sync_failure', severity: 'critical', count: 3 },
      ]));

    const summary = await service.getSummary({
      eventId: 'event-girl-rules-20260704',
      showtimeId: VALID_SHOWTIME_ID,
    });

    expect(summary.latestAbnormalAlerts.map((alert) => alert.type)).toEqual([
      'duplicate_spike',
      'rejected_tampered_scan',
      'refunded_cancelled_attempt',
      'offline_backlog',
      'sync_failure',
    ]);
    expect(summary.latestAbnormalAlerts.map((alert) => alert.message).join(' ')).toMatch(
      /tampered|refunded|cancelled|offline|sync/i,
    );
    expectNoRawMonitorLeak(summary);
  });

  it('keeps raw token, raw JTI, and PII out of secondary monitor log rows', async () => {
    const { service, db } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        id: 'scan-event-1',
        eventId: 'event-girl-rules-20260704',
        showtimeId: VALID_SHOWTIME_ID,
        outcome: 'rejected',
        syncState: 'rejected',
        scannerUserId: 'scanner-user-1',
        deviceAttemptId: 'device-attempt-1',
        redactedTokenRef: 'tok_abc...7890',
        scannedAt: new Date('2026-07-04T09:15:00.000Z'),
        rejectionReason: 'tampered signature',
        rawToken: RAW_QR_TOKEN,
        rawJti: FULL_RAW_JTI,
        phone: '+821055501234',
        email: 'buyer@example.com',
      },
    ]));

    const rows = await service.listScanLogs({
      eventId: 'event-girl-rules-20260704',
      showtimeId: VALID_SHOWTIME_ID,
      outcome: 'rejected',
      syncState: 'rejected',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'scan-event-1',
        outcome: 'rejected',
        syncState: 'rejected',
        redactedTokenRef: 'tok_abc...7890',
        rejectionReason: 'tampered signature',
      }),
    ]);
    expectNoRawMonitorLeak(rows);
  });
});
