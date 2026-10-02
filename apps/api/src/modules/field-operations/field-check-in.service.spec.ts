import { UnauthorizedException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QrTicketScannerContract } from '../ticket/qr-ticket.service.js';
import { FieldCheckInService, fieldShowtimeListLowerBound } from './field-check-in.service.js';

// Admission, cancellation races, replay, benefit rights and prior-entry persistence
// are exercised through real HTTP/PostgreSQL in test/field-admission.integration.spec.ts.
// Keep only collaborator-failure and sensitive-output boundaries here.
function contract(): QrTicketScannerContract {
  return { ticketId: 'ticket-1', ticketItemId: 'item-1', userId: 'buyer-1', tokenVersion: 'v1', ticketStatus: 'ACTIVE',
    reservationId: 'order-1', paymentId: 'payment-1', showtimeId: '00000000-0000-4000-8000-000000000001',
    performanceId: 'event-1', performanceTitle: 'Show', showtimeAt: '2099-01-01T10:00:00Z', venueName: 'Hall',
    seatIdentity: { seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', row: 'A', number: '1', tierName: 'VIP' },
    seatLabels: ['1층 A-1'], maskedJti: 'jti_***', verifiedAt: new Date().toISOString() };
}
function dependencies() {
  const query: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) query[method] = vi.fn(() => query);
  query.limit = vi.fn(async () => []);
  const db = { select: vi.fn(() => query), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() };
  const qr = { verifyTicketForScannerContract: vi.fn(async () => contract()) };
  const audit = { write: vi.fn() };
  return { db, qr, audit, service: new FieldCheckInService(db as never, qr as never, audit as never) };
}
const token = 'eyJ-sensitive-token-with-full-jti';
const context = { scannerUserId: 'scanner-1' };

describe('Field verification boundaries', () => {
  it.each(['ticket', 'token'])('accepts QR URLs using the %s parameter without exposing the raw credential', async (param) => {
    const { service, qr, db } = dependencies();
    const result = await service.verify({ qrUrl: `https://example.test/field/check-in?${param}=${token}` }, context);
    expect(qr.verifyTicketForScannerContract).toHaveBeenCalledWith(token);
    expect(result).toMatchObject({ processable: true, ticket: { seatLabels: ['1층 A-1'] } });
    expect(JSON.stringify(result)).not.toContain(token); expect(db.update).not.toHaveBeenCalled();
  });
  it('redacts invalid credentials from audit and never mutates ticket rights', async () => {
    const { service, qr, db, audit } = dependencies(); qr.verifyTicketForScannerContract.mockRejectedValue(new UnauthorizedException());
    const result = await service.consume({ token, showtimeId: contract().showtimeId, deviceAttemptId: 'attempt-1', confirmed: true }, context);
    expect(result.outcome).toBe('tampered'); expect(db.transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain(token);
  });
  it('propagates infrastructure failures instead of labelling a valid customer QR forged', async () => {
    const { service, qr, audit } = dependencies(); qr.verifyTicketForScannerContract.mockRejectedValue(new Error('database unavailable'));
    await expect(service.verify({ token }, context)).rejects.toThrow('database unavailable');
    await expect(service.consume({ token, showtimeId: contract().showtimeId, deviceAttemptId: 'attempt-1', confirmed: true }, context)).rejects.toThrow('database unavailable');
    expect(audit.write).not.toHaveBeenCalled();
  });
  it('preserves admission verification while explicitly reporting unavailable benefit lookup', async () => {
    const { service, db } = dependencies(); db.select.mockImplementation(() => { throw new Error('benefit lookup failed'); });
    const result = await service.verify({ token }, context);
    expect(result).toMatchObject({ processable: true, ticket: { benefitEntitlements: [], benefitsAvailable: false } });
  });
});

const REQUESTED_SHOWTIME_ID = '00000000-0000-4000-8000-000000000099';

function recordingDependencies(options: { consumedReceipt?: boolean; ticketStatus?: QrTicketScannerContract['ticketStatus'] } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const statement = {
    onConflictDoNothing: vi.fn(() => statement),
    returning: vi.fn(async () => [{ id: 'scan-event-1' }]),
  };
  const insertBuilder = { values: vi.fn((values: Record<string, unknown>) => { inserted.push(values); return statement; }) };
  // Benefit lookup ends with orderBy().limit(); the consume-receipt lookup selects only an id.
  const select = vi.fn((fields?: Record<string, unknown>) => {
    const isReceiptLookup = Boolean(fields && Object.keys(fields).length === 1 && 'id' in fields);
    const query: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy']) query[method] = vi.fn(() => query);
    query.limit = vi.fn(async () => (isReceiptLookup && options.consumedReceipt ? [{ id: 'consume-receipt' }] : []));
    return query;
  });
  const db = { select, update: vi.fn(), insert: vi.fn(() => insertBuilder), transaction: vi.fn() };
  const qr = { verifyTicketForScannerContract: vi.fn(async () => ({ ...contract(), ticketStatus: options.ticketStatus ?? 'REVOKED' })) };
  const audit = { write: vi.fn() };
  return { db, qr, audit, inserted, statement, service: new FieldCheckInService(db as never, qr as never, audit as never) };
}

describe('Field showtime list (audit #112)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    // 23:00 KST: every showtime of the KST day stays selectable.
    ['2026-10-02T14:00:00.000Z', '2026-10-01T15:00:00.000Z'],
    // 01:00 KST: a late show that started before midnight stays selectable for 12 hours.
    ['2026-10-01T16:00:00.000Z', '2026-10-01T04:00:00.000Z'],
  ])('at %s lists showtimes starting from %s', (now, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    expect(fieldShowtimeListLowerBound().toISOString()).toBe(expected);
  });

  it('lists the nearest showtimes first from the lower bound instead of the latest 200', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T14:00:00.000Z'));
    const calls: Record<string, unknown[]> = {};
    const query: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
      query[method] = vi.fn((...args: unknown[]) => { calls[method] = args; return query; });
    }
    const service = new FieldCheckInService({ select: vi.fn(() => query) } as never, {} as never, {} as never);

    await service.listShowtimes();

    const dialect = new PgDialect();
    const where = dialect.sqlToQuery(calls.where![0] as SQL);
    expect(where.sql).toBe('"showtimes"."date_time" >= $1');
    expect(where.params[0]).toBe('2026-10-01T15:00:00.000Z');
    expect(calls.orderBy!.map((order) => dialect.sqlToQuery(order as SQL).sql))
      .toEqual(['"showtimes"."date_time" asc', '"showtimes"."id" asc']);
    expect(calls.limit).toEqual([200]);
  });
});

describe('Verify-stage rejection ledger (audit #113, #114)', () => {
  it('records one rejected scan per attempt at the requested gate showtime without the raw QR', async () => {
    const { service, inserted, statement } = recordingDependencies();

    const result = await service.verify({ token, showtimeId: REQUESTED_SHOWTIME_ID, deviceAttemptId: 'attempt-1' }, context);

    expect(result.outcome).toBe('wrong_showtime');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      ticketItemId: 'item-1',
      showtimeId: contract().showtimeId,
      requestedShowtimeId: REQUESTED_SHOWTIME_ID,
      result: 'wrong_showtime',
      source: 'online',
      syncState: 'not_required',
      deviceAttemptId: 'verify:attempt-1',
      metadata: expect.objectContaining({ stage: 'verify', requestedShowtimeId: REQUESTED_SHOWTIME_ID }),
    });
    expect(statement.onConflictDoNothing).toHaveBeenCalled();
    expect(JSON.stringify(inserted)).not.toContain(token);
  });

  it.each([
    ['REVOKED', 'refunded_cancelled'],
    ['USED', 'already_used'],
    ['EXPIRED', 'expired'],
  ] as const)('records a %s ticket rejected at its own showtime as %s', async (ticketStatus, outcome) => {
    const { service, inserted } = recordingDependencies({ ticketStatus });

    await service.verify({ token, showtimeId: contract().showtimeId, deviceAttemptId: 'attempt-1' }, context);

    expect(inserted).toEqual([expect.objectContaining({ result: outcome, requestedShowtimeId: contract().showtimeId })]);
  });

  it('adds nothing when consume already recorded the same attempt, such as the re-check right after entry', async () => {
    const { service, db } = recordingDependencies({ ticketStatus: 'USED', consumedReceipt: true });

    const result = await service.verify({ token, showtimeId: contract().showtimeId, deviceAttemptId: 'attempt-1' }, context);

    expect(result.outcome).toBe('already_used');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('keeps audit-only behavior for callers that do not identify the scan attempt', async () => {
    const { service, db, audit } = recordingDependencies();

    await service.verify({ token, showtimeId: contract().showtimeId }, context);

    expect(db.insert).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'field.scan.verify', status: 'denied',
      after: expect.objectContaining({ requestedShowtimeId: contract().showtimeId }),
    }), expect.anything());
  });

  it('attributes an unverifiable QR only to the gate showtime', async () => {
    const { service, qr, inserted } = recordingDependencies();
    qr.verifyTicketForScannerContract.mockRejectedValue(new UnauthorizedException());

    const result = await service.verify({ token, showtimeId: REQUESTED_SHOWTIME_ID, deviceAttemptId: 'attempt-1' }, context);

    expect(result.outcome).toBe('tampered');
    expect(inserted).toEqual([expect.objectContaining({
      ticketId: null, ticketItemId: null, reservationId: null, showtimeId: null,
      requestedShowtimeId: REQUESTED_SHOWTIME_ID, result: 'tampered', deviceAttemptId: 'verify:attempt-1',
    })]);
    expect(JSON.stringify(inserted)).not.toContain(token);
  });

  it('cannot attribute an unverifiable QR without a gate showtime', async () => {
    const { service, qr, db } = recordingDependencies();
    qr.verifyTicketForScannerContract.mockRejectedValue(new UnauthorizedException());

    await service.verify({ token, deviceAttemptId: 'attempt-1' }, context);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('records an unverifiable QR at consume once per attempt and returns its receipt', async () => {
    const { service, qr, inserted, statement, db } = recordingDependencies();
    qr.verifyTicketForScannerContract.mockRejectedValue(new UnauthorizedException());

    const result = await service.consume({ token, showtimeId: REQUESTED_SHOWTIME_ID, deviceAttemptId: 'attempt-1', confirmed: true },
      { scannerUserId: 'scanner-1', scanSource: 'offline_sync' });

    expect(result).toMatchObject({ outcome: 'tampered', scanEventId: 'scan-event-1' });
    expect(inserted).toEqual([expect.objectContaining({
      ticketId: null, requestedShowtimeId: REQUESTED_SHOWTIME_ID, result: 'tampered',
      source: 'offline_sync', syncState: 'rejected', deviceAttemptId: 'attempt-1',
    })]);
    expect(statement.onConflictDoNothing).toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
