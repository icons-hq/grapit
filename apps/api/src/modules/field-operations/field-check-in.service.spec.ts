import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { QrTicketScannerContract } from '../ticket/qr-ticket.service.js';
import { FieldCheckInService } from './field-check-in.service.js';

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
