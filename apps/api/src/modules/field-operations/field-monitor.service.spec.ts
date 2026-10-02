import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { FieldMonitorSummary } from '@grabit/shared';

import { reservations } from '../../database/schema/index.js';
import { FieldMonitorService } from './field-monitor.service.js';

type ChainCall = { method: string; args: unknown[] };

function chainResult<T>(rows: T[], calls: ChainCall[] = []) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }

      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
        return new Proxy({}, handler);
      };
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

const dialect = new PgDialect();
function render(value: unknown): string {
  return dialect.sqlToQuery(value as SQL).sql;
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

function objectGraphText(root: unknown): string {
  const seen = new WeakSet<object>();
  const values: string[] = [];

  function visit(value: unknown) {
    if (value == null) {
      return;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values.push(String(value));
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    Object.entries(value).forEach(([key, nested]) => {
      values.push(key);
      visit(nested);
    });
  }

  visit(root);
  return values.join(' ');
}

const SUMMARY_INPUT = {
  eventId: 'event-girl-rules-20260704',
  showtimeId: VALID_SHOWTIME_ID,
};

describe('FieldMonitorService RED contract', () => {
  it('returns KPI-first summary before scan log rows: entered, not-entered, entry rate, duplicate scans, rejected scans, offline synced, and abnormal alerts', async () => {
    const { service, db } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([{ totalTicketItems: 150, enteredCount: 120 }]))
      .mockReturnValueOnce(chainResult([
        {
          duplicateScanCount: 5,
          rejectedScanCount: 3,
          rejectedTamperedCount: 2,
          refundedCancelledCount: 1,
          offlineSyncedCount: 8,
          duplicateDetectedAt: new Date('2026-07-04T09:10:00.000Z'),
        },
      ]));

    const summary = await service.getSummary(SUMMARY_INPUT);

    expect(summary satisfies FieldMonitorSummary).toMatchObject({
      eventId: 'event-girl-rules-20260704',
      showtimeId: VALID_SHOWTIME_ID,
      enteredCount: 120,
      notEnteredCount: 30,
      entryRate: 0.8,
      duplicateScanCount: 5,
      rejectedScanCount: 3,
      offlinePendingCount: 0,
      offlineSyncedCount: 8,
      latestAbnormalAlerts: [
        expect.objectContaining({
          type: 'duplicate_spike',
          severity: 'warning',
          count: 5,
          detectedAt: '2026-07-04T09:10:00.000Z',
        }),
        expect.objectContaining({ type: 'rejected_tampered_scan', count: 2 }),
        expect.objectContaining({ type: 'refunded_cancelled_attempt', count: 1 }),
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

  it('counts entered KPI from active ticket items instead of one success scan per reservation', async () => {
    const { service, db } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([{ totalTicketItems: 708, enteredCount: 128 }]))
      .mockReturnValueOnce(chainResult([{}]));

    await service.getSummary(SUMMARY_INPUT);

    const statsSelect = db.select.mock.calls[0]?.[0] as Record<string, unknown>;
    const totalTicketItemsSql = objectGraphText(statsSelect.totalTicketItems);
    const enteredCountSql = objectGraphText(statsSelect.enteredCount);

    expect(totalTicketItemsSql).toContain('ticket_items');
    expect(enteredCountSql).toContain('ticket_items');
    expect(enteredCountSql).toContain('admission_state');
    expect(enteredCountSql).toContain('entered');
    expect(enteredCountSql).toContain('used_at');
    expect(enteredCountSql).not.toContain('tickets.status');
    expect(enteredCountSql).not.toContain('ticket_scan_events.result');
  });

  it('counts scan KPIs and alerts from the scan ledger at the gate showtime, independent of booking state (audit #114)', async () => {
    const { service, db } = createDependencies();
    const admissionCalls: ChainCall[] = [];
    const signalCalls: ChainCall[] = [];
    db.select
      .mockReturnValueOnce(chainResult([{ totalTicketItems: 2, enteredCount: 0 }], admissionCalls))
      .mockReturnValueOnce(chainResult([
        { duplicateScanCount: 0, rejectedScanCount: 2, rejectedTamperedCount: 1, refundedCancelledCount: 1 },
      ], signalCalls));

    const summary = await service.getSummary(SUMMARY_INPUT);

    // The admission query no longer joins scan events, so a cancelled booking cannot hide a rejection.
    expect(admissionCalls.some((call) => call.method === 'leftJoin')).toBe(false);

    const from = signalCalls.find((call) => call.method === 'from');
    expect(objectGraphText(from?.args[0])).toContain('ticket_scan_events');
    const joins = signalCalls.filter((call) => call.method.endsWith('Join'));
    expect(joins).toHaveLength(1);
    expect(render(joins[0]!.args[1])).toBe('"showtimes"."id" = $1');
    const where = render(signalCalls.find((call) => call.method === 'where')!.args[0]);
    expect(where).toContain('"ticket_scan_events"."requested_showtime_id" = $');
    expect(where).toContain('"ticket_scan_events"."requested_showtime_id" is null');
    expect(where).not.toMatch(/reservations|payments|ticket_items/);

    // KPI rejected count and the alerts come from the same rows and agree.
    expect(summary.rejectedScanCount).toBe(2);
    expect(summary.latestAbnormalAlerts.map((alert) => [alert.type, alert.count])).toEqual([
      ['rejected_tampered_scan', 1],
      ['refunded_cancelled_attempt', 1],
    ]);
  });

  it('never reports device-local offline backlog or sync failures as server-observed (audit #119)', async () => {
    const { service, db } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([{ totalTicketItems: 150, enteredCount: 100 }]))
      .mockReturnValueOnce(chainResult([
        {
          duplicateScanCount: 12,
          rejectedScanCount: 9,
          rejectedTamperedCount: 9,
          refundedCancelledCount: 0,
          offlinePendingCount: 17,
          offlineBacklogCount: 17,
          syncFailureCount: 3,
        },
      ]));

    const summary = await service.getSummary(SUMMARY_INPUT);

    expect(summary.offlinePendingCount).toBe(0);
    expect(summary.latestAbnormalAlerts.map((alert) => alert.type)).toEqual([
      'duplicate_spike',
      'rejected_tampered_scan',
    ]);
    expect(summary.latestAbnormalAlerts.map((alert) => alert.severity)).toEqual(['critical', 'critical']);
    const signalSelect = db.select.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(Object.keys(signalSelect)).not.toEqual(expect.arrayContaining(['offlinePendingCount']));
    expectNoRawMonitorLeak(summary);
  });

  it('keeps raw token, raw JTI, and PII out of secondary monitor log rows', async () => {
    const { service, db } = createDependencies();
    const calls: ChainCall[] = [];
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
    ], calls));

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
    const methods = calls.map((call) => call.method);
    expect(methods.indexOf('orderBy')).toBeGreaterThan(-1);
    expect(methods.indexOf('orderBy')).toBeLessThan(methods.indexOf('limit'));
    expectNoRawMonitorLeak(rows);
  });

  it('lists scan logs by gate showtime and keeps unverifiable QR rows without a booking (audit #113, #114)', async () => {
    const { service, db } = createDependencies();
    const calls: ChainCall[] = [];
    db.select.mockReturnValueOnce(chainResult([
      {
        id: 'scan-event-tampered',
        eventId: 'event-girl-rules-20260704',
        showtimeId: VALID_SHOWTIME_ID,
        result: 'tampered',
        syncState: 'not_required',
        scannerUserId: 'scanner-user-1',
        scannerName: 'Scanner',
        reservationNumber: null,
        seatLabel: null,
        source: 'online',
        metadata: { redactedTokenRef: 'qr:abc', stage: 'verify' },
        scannedAt: new Date('2026-07-04T09:20:00.000Z'),
        rejectionReason: '검증할 수 없는 QR 티켓입니다',
      },
    ], calls));

    const rows = await service.listScanLogs({ eventId: 'event-girl-rules-20260704', showtimeId: VALID_SHOWTIME_ID });

    expect(rows).toEqual([expect.objectContaining({
      outcome: 'tampered', reservationNumber: null, seatLabel: null, redactedTokenRef: 'qr:abc',
      showtimeId: VALID_SHOWTIME_ID,
    })]);
    const reservationJoin = calls.find((call) => call.method.endsWith('Join') && call.args[0] === reservations);
    expect(reservationJoin?.method).toBe('leftJoin');
    const where = render(calls.find((call) => call.method === 'where')!.args[0]);
    expect(where).toContain('"gate_showtimes"."performance_id" = $');
    expect(where).toContain('"ticket_scan_events"."requested_showtime_id" = $');
  });
});
