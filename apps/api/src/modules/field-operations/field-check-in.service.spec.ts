import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FieldCheckInConsumeResponse,
  FieldCheckInVerifyResponse,
} from '@grabit/shared';

import { tickets } from '../../database/schema/index.js';
import type { QrTicketScannerContract } from '../ticket/qr-ticket.service.js';
import { FieldCheckInService } from './field-check-in.service.js';

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

function createUpdateResult<T>(rows: T[] = []) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function scannerContract(
  overrides: Partial<QrTicketScannerContract> = {},
): QrTicketScannerContract {
  return {
    tokenVersion: '2026-07',
    ticketStatus: 'ACTIVE',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    showtimeId: '00000000-0000-4000-8000-000000000001',
    performanceId: 'performance-1',
    performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
    showtimeAt: '2026-07-04T10:00:00.000Z',
    venueName: 'Donghae Arts Center',
    maskedJti: 'qr-jti...7890',
    verifiedAt: '2026-07-04T09:00:00.000Z',
    ...overrides,
  };
}

function createDependencies() {
  const qrTicketService = {
    verifyTicketForScannerContract: vi.fn(),
  };
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn().mockReturnValue(createUpdateResult()),
    transaction: vi.fn(),
  };
  const adminAuditService = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  const service = new FieldCheckInService(
    db as never,
    qrTicketService as never,
    adminAuditService as never,
  );

  return { service, qrTicketService, db, adminAuditService };
}

const RAW_QR_TOKEN = 'ey.raw.qr-ticket-token-with-sensitive-jti';
const FULL_RAW_JTI = 'qr-jti-full-raw-phase27-sensitive-1234567890';
const SCANNER_CONTEXT = {
  scannerUserId: 'scanner-user-1',
  deviceAttemptId: 'device-attempt-1',
  ipAddress: '203.0.113.44',
  userAgent: 'Field Scanner Mobile Browser',
};

function expectNoSensitiveLookupLeak(result: unknown) {
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(RAW_QR_TOKEN);
  expect(serialized).not.toContain(FULL_RAW_JTI);
  expect(serialized).not.toContain('Bearer raw-admin-token');
  expect(serialized).not.toContain('session=raw-cookie');
  expect(serialized).not.toContain('payment key');
  expect(serialized).not.toContain('payment_key_live_sensitive');
  expect(serialized).not.toContain('+821055501234');
  expect(serialized).not.toContain('buyer@example.com');
  expect(serialized).not.toMatch(/raw.*(token|JTI)/i);
}

describe('FieldCheckInService RED contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T09:00:00.000Z'));
  });

  it('normal active ticket verifies as processable without mutating tickets.usedAt, then consumes once as entered', async () => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ maskedJti: 'qr-jti...7890' }),
    );
    db.select.mockReturnValueOnce(chainResult([]));
    db.update.mockReturnValueOnce(createUpdateResult([
      {
        ticketId: 'ticket-1',
        usedAt: new Date('2026-07-04T09:01:00.000Z'),
      },
    ]));

    const verifyResult = await service.verify({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
    });
    const consumeResult = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(qrTicketService.verifyTicketForScannerContract).toHaveBeenCalledWith(RAW_QR_TOKEN);
    expect(verifyResult satisfies FieldCheckInVerifyResponse).toMatchObject({
      outcome: 'processable',
      processable: true,
      ticket: expect.objectContaining({
        ticketStatus: 'ACTIVE',
        redactedTokenRef: expect.any(String),
        maskedJti: 'qr-jti...7890',
      }),
    });
    expect(consumeResult satisfies FieldCheckInConsumeResponse).toMatchObject({
      outcome: 'entered',
      ticket: expect.objectContaining({
        ticketStatus: 'ACTIVE',
        redactedTokenRef: expect.any(String),
      }),
      scanEventId: expect.any(String),
      consumedAt: '2026-07-04T09:01:00.000Z',
    });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(tickets);
    expect(db.update.mock.results[0]?.value.set).toHaveBeenCalledWith({
      usedAt: new Date('2026-07-04T09:00:00.000Z'),
      updatedAt: new Date('2026-07-04T09:00:00.000Z'),
    });
    expect(
      JSON.stringify(db.update.mock.calls[0], (_key, value) =>
        value === tickets ? '[tickets-table]' : value,
      ),
    ).not.toContain('verify');
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.consume',
        resourceType: 'ticket',
        status: 'success',
      }),
      expect.anything(),
    );
    expectNoSensitiveLookupLeak(verifyResult);
    expectNoSensitiveLookupLeak(consumeResult);
  });

  it('duplicate or already_used consume returns prior scan context with redacted staff/device values', async () => {
    const { service, qrTicketService, db } = createDependencies();
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ maskedJti: 'qr-jti...7890' }),
    );
    db.select.mockReturnValueOnce(chainResult([
      {
        outcome: 'entered',
        scannedAt: new Date('2026-07-04T08:58:00.000Z'),
        scannerUserId: 'scanner-user-prior-sensitive',
        deviceAttemptId: 'device-attempt-prior-sensitive',
        rawToken: RAW_QR_TOKEN,
        rawJti: FULL_RAW_JTI,
      },
    ]));

    const result = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(['duplicate', 'already_used']).toContain(result.outcome);
    expect(result.priorScan).toMatchObject({
      scannedAt: '2026-07-04T08:58:00.000Z',
      scannerUserId: expect.stringMatching(/^scanner-user/),
      deviceAttemptId: expect.stringMatching(/^device-attempt/),
    });
    expect(JSON.stringify(result.priorScan)).not.toContain('raw');
    expectNoSensitiveLookupLeak(result);
  });

  it.each([
    ['tampered', new Error('signature mismatch')],
    ['refunded/cancelled', { ticketStatus: 'REVOKED', reservationStatus: 'CANCELLED' }],
    ['expired', { ticketStatus: 'EXPIRED' }],
    ['wrong-showtime', { showtimeId: '00000000-0000-4000-8000-000000000099' }],
    ['already-used', { ticketStatus: 'USED' }],
  ])('rejects %s input without sensitive lookup leakage', async (caseName, scannerState) => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();

    if (scannerState instanceof Error) {
      qrTicketService.verifyTicketForScannerContract.mockRejectedValue(scannerState);
    } else {
      qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
        scannerContract(scannerState as Partial<QrTicketScannerContract>),
      );
    }
    db.select.mockReturnValue(chainResult([]));

    const result = await service.verify({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.processable).toBe(false);
    expect([
      'tampered',
      'refunded_cancelled',
      'expired',
      'wrong_showtime',
      'already_used',
    ]).toContain(result.outcome);
    expect(result.rejectionReason).toEqual(expect.any(String));
    expect(db.update).not.toHaveBeenCalled();
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.verify',
        status: 'denied',
        after: expect.objectContaining({
          outcome: result.outcome,
          caseName,
          redactedTokenRef: expect.any(String),
        }),
      }),
      expect.anything(),
    );
    expectNoSensitiveLookupLeak(result);
  });
});
