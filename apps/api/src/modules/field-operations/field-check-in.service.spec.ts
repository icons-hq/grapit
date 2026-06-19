import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FieldCheckInConsumeResponse,
  FieldCheckInVerifyResponse,
} from '@grabit/shared';

import {
  ticketBenefitEntitlements,
  ticketBenefitRedemptionRecords,
  ticketItems,
  ticketScanEvents,
  tickets,
} from '../../database/schema/index.js';
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

function createSelectResult<T>(rows: T[] = []) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createInsertResult<T>(rows: T[] = [{ id: 'scan-event-1' } as T]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function sqlPredicateHasParamValue(predicate: unknown, value: string): boolean {
  const candidate = predicate as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };

  if (candidate.constructor?.name === 'Param') {
    return candidate.value === value;
  }

  if (!Array.isArray(candidate.queryChunks)) {
    return false;
  }

  return candidate.queryChunks.some((chunk) => sqlPredicateHasParamValue(chunk, value));
}

function scannerContract(
  overrides: Partial<QrTicketScannerContract> = {},
): QrTicketScannerContract {
  return {
    tokenVersion: '2026-07',
    ticketStatus: 'ACTIVE',
    ticketItemId: 'ticket-item-1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    showtimeId: '00000000-0000-4000-8000-000000000001',
    performanceId: 'performance-1',
    performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
    showtimeAt: '2026-07-04T10:00:00.000Z',
    venueName: 'Donghae Arts Center',
    seatIdentity: {
      seatId: 'A-1',
      seatKey: '1F:A-1',
      floorKey: '1F',
      floorLabel: '1층',
      row: 'A',
      number: '1',
      tierName: 'VIP',
    },
    seatLabels: ['VIP A열 1번'],
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
const BENEFIT_ENTITLEMENT_ID = '00000000-0000-4000-8000-0000000000b1';
const BENEFIT_RUN_ID = '00000000-0000-4000-8000-0000000000d1';
const SCANNER_CONTEXT = {
  scannerUserId: 'scanner-user-1',
  deviceAttemptId: 'device-attempt-1',
  ipAddress: '203.0.113.44',
  userAgent: 'Field Scanner Mobile Browser',
};

function benefitDisplayCopy(name = '6:1') {
  return {
    ko: { name, description: `${name} 이벤트 참여 혜택` },
    en: { name, description: `${name} event benefit` },
    'zh-CN': { name, description: `${name} 活动福利` },
    th: { name, description: `สิทธิประโยชน์กิจกรรม ${name}` },
  };
}

function benefitEntitlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BENEFIT_ENTITLEMENT_ID,
    showtimeId: '00000000-0000-4000-8000-000000000001',
    ticketItemId: 'ticket-item-1',
    benefitIdentity: 'benefit_6_to_1',
    benefitKind: 'limited',
    displayCopySnapshot: benefitDisplayCopy(),
    source: 'live_run',
    runId: BENEFIT_RUN_ID,
    state: 'active',
    inactiveReason: null,
    redeemedAt: null,
    redeemedByUserId: null,
    createdAt: new Date('2026-07-04T08:00:00.000Z'),
    updatedAt: new Date('2026-07-04T08:00:00.000Z'),
    ...overrides,
  };
}

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
    const priorScanLookup = createSelectResult([]);
    const updateTicket = createUpdateResult([
      {
        ticketId: 'ticket-1',
        usedAt: new Date('2026-07-04T09:01:00.000Z'),
      },
    ]);
    const updateTicketItem = createUpdateResult([{ ticketItemId: 'ticket-item-1' }]);
    const insertScanEvent = createInsertResult([{ id: 'scan-event-1' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ maskedJti: 'qr-jti...7890' }),
    );
    db.select.mockReturnValue(priorScanLookup);
    db.update
      .mockReturnValueOnce(updateTicket)
      .mockReturnValueOnce(updateTicketItem);
    db.insert.mockReturnValueOnce(insertScanEvent);

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
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.update).toHaveBeenCalledWith(tickets);
    expect(db.update).toHaveBeenCalledWith(ticketItems);
    expect(db.update).not.toHaveBeenCalledWith(ticketBenefitEntitlements);
    expect(updateTicket.set).toHaveBeenCalledWith({
      usedAt: new Date('2026-07-04T09:00:00.000Z'),
      updatedAt: new Date('2026-07-04T09:00:00.000Z'),
    });
    expect(updateTicketItem.set).toHaveBeenCalledWith({
      admissionState: 'entered',
      enteredAt: new Date('2026-07-04T09:00:00.000Z'),
      updatedAt: new Date('2026-07-04T09:00:00.000Z'),
    });
    expect(sqlPredicateHasParamValue(priorScanLookup.where.mock.calls[0]?.[0], 'ticket-item-1'))
      .toBe(true);
    expect(sqlPredicateHasParamValue(
      updateTicket.set.mock.results[0]?.value.where.mock.calls[0]?.[0],
      'ticket-item-1',
    )).toBe(true);
    expect(sqlPredicateHasParamValue(
      updateTicketItem.set.mock.results[0]?.value.where.mock.calls[0]?.[0],
      'ticket-item-1',
    )).toBe(true);
    expect(db.insert).toHaveBeenCalledWith(ticketScanEvents);
    expect(db.insert).not.toHaveBeenCalledWith(ticketBenefitRedemptionRecords);
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket-1',
        ticketItemId: 'ticket-item-1',
        reservationId: 'reservation-1',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        result: 'success',
      }),
    );
    expect(
      JSON.stringify(db.update.mock.calls[0], (_key, value) =>
        value === tickets ? '[tickets-table]' : value,
      ),
    ).not.toContain('verify');
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.consume',
        resourceType: 'ticket',
        resourceId: 'ticket-item-1',
        status: 'success',
      }),
      expect.anything(),
    );
    expectNoSensitiveLookupLeak(verifyResult);
    expectNoSensitiveLookupLeak(consumeResult);
  });

  it.each([
    ['before showtime', '2026-07-04T08:30:00.000Z'],
    ['after showtime', '2026-07-04T11:30:00.000Z'],
  ])('keeps active QR tickets processable and consumable %s', async (_label, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([]);
    const priorScanLookup = createSelectResult([]);
    const updateTicket = createUpdateResult([
      {
        ticketId: 'ticket-1',
        usedAt: new Date(nowIso),
      },
    ]);
    const updateTicketItem = createUpdateResult([{ ticketItemId: 'ticket-item-1' }]);
    const insertScanEvent = createInsertResult([{ id: 'scan-event-1' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({
        ticketId: 'ticket-1',
        showtimeAt: '2026-07-04T10:00:00.000Z',
      }),
    );
    db.select
      .mockReturnValueOnce(entitlementLookup)
      .mockReturnValueOnce(priorScanLookup);
    db.update
      .mockReturnValueOnce(updateTicket)
      .mockReturnValueOnce(updateTicketItem);
    db.insert.mockReturnValueOnce(insertScanEvent);

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

    expect(verifyResult).toMatchObject({
      outcome: 'processable',
      processable: true,
      ticket: expect.objectContaining({
        showtimeLabel: '2026-07-04T10:00:00.000Z',
        ticketStatus: 'ACTIVE',
      }),
      rejectionReason: null,
    });
    expect(consumeResult).toMatchObject({
      outcome: 'entered',
      consumedAt: nowIso,
    });
    expect(db.update).toHaveBeenCalledWith(tickets);
    expect(db.update).toHaveBeenCalledWith(ticketItems);
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketItemId: 'ticket-item-1',
        result: 'success',
      }),
    );
  });

  it('verify response includes benefit entitlements for the scanned ticket item', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([
      benefitEntitlementRow(),
      benefitEntitlementRow({
        id: '00000000-0000-4000-8000-0000000000b2',
        source: 'configuration',
        runId: null,
        benefitKind: 'included',
        benefitIdentity: 'vip_drink',
        displayCopySnapshot: benefitDisplayCopy('무료 음료'),
      }),
    ]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ maskedJti: 'qr-jti...7890' }),
    );
    db.select.mockReturnValueOnce(entitlementLookup);

    const verifyResult = await service.verify({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
    });

    expect(verifyResult).toMatchObject({
      outcome: 'processable',
      ticket: {
        benefitEntitlements: [
          expect.objectContaining({
            id: BENEFIT_ENTITLEMENT_ID,
            benefitIdentity: 'benefit_6_to_1',
            kind: 'limited',
            state: 'active',
            source: 'live_run',
            runMode: 'live',
            attachedToTicket: true,
          }),
          expect.objectContaining({
            benefitIdentity: 'vip_drink',
            kind: 'included',
            source: 'configuration',
            runId: null,
            attachedToTicket: true,
          }),
        ],
      },
    });
    expect(db.select).toHaveBeenCalledWith(expect.objectContaining({
      id: ticketBenefitEntitlements.id,
      benefitIdentity: ticketBenefitEntitlements.benefitIdentity,
    }));
    expect(entitlementLookup.from).toHaveBeenCalledWith(ticketBenefitEntitlements);
    expect(sqlPredicateHasParamValue(
      entitlementLookup.where.mock.calls[0]?.[0],
      'ticket-item-1',
    )).toBe(true);
    expectNoSensitiveLookupLeak(verifyResult);
  });

  it('keeps valid QR verification outcome when benefit entitlement lookup fails', async () => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();
    const failingEntitlementLookup = {
      from: vi.fn(() => {
        throw new Error('benefit entitlement read failed');
      }),
    };
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ maskedJti: 'qr-jti...7890' }),
    );
    db.select.mockReturnValueOnce(failingEntitlementLookup);

    const verifyResult = await service.verify({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
    });

    expect(verifyResult).toMatchObject({
      outcome: 'processable',
      processable: true,
      ticket: expect.objectContaining({
        ticketStatus: 'ACTIVE',
        benefitEntitlements: [],
      }),
      rejectionReason: null,
    });
    expect(adminAuditService.write).not.toHaveBeenCalled();
    expectNoSensitiveLookupLeak(verifyResult);
  });

  it('does not consume a ticket item that becomes cancellation_pending after QR verification', async () => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();
    const priorScanLookup = createSelectResult([]);
    const updateTicket = createUpdateResult([
      {
        ticketId: 'ticket-1',
        usedAt: new Date('2026-07-04T09:01:00.000Z'),
      },
    ]);
    const updateTicketItem = createUpdateResult([]);
    const insertScanEvent = createInsertResult([{ id: 'scan-event-pending' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ ticketId: 'ticket-1', ticketItemId: 'ticket-item-1' }),
    );
    db.select.mockReturnValueOnce(priorScanLookup);
    db.update
      .mockReturnValueOnce(updateTicket)
      .mockReturnValueOnce(updateTicketItem);
    db.insert.mockReturnValueOnce(insertScanEvent);

    const result = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(result.outcome).toBe('refunded_cancelled');
    expect(result.rejectionReason).toBe('취소 또는 환불된 티켓입니다');
    expect(updateTicketItem.set.mock.results[0]?.value.where).toHaveBeenCalledWith(
      expect.anything(),
    );
    expect(sqlPredicateHasParamValue(
      updateTicketItem.set.mock.results[0]?.value.where.mock.calls[0]?.[0],
      'active',
    )).toBe(true);
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket-1',
        ticketItemId: 'ticket-item-1',
        result: 'refunded_cancelled',
      }),
    );
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.consume',
        resourceId: 'ticket-item-1',
        status: 'denied',
      }),
      expect.anything(),
    );
  });

  it.each(['ticket', 'token'] as const)(
    'verifies scanner QR URLs using %s query parameter',
    async (queryParam) => {
      const { service, qrTicketService } = createDependencies();
      qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
        scannerContract({ maskedJti: 'qr-jti...7890' }),
      );

      const verifyResult = await service.verify({
        qrUrl: `https://heygrabit.com/field/check-in?${queryParam}=${encodeURIComponent(RAW_QR_TOKEN)}`,
        showtimeId: '00000000-0000-4000-8000-000000000001',
      });

      expect(qrTicketService.verifyTicketForScannerContract).toHaveBeenCalledWith(RAW_QR_TOKEN);
      expect(verifyResult).toMatchObject({
        outcome: 'processable',
        processable: true,
      });
      expectNoSensitiveLookupLeak(verifyResult);
    },
  );

  it('treats a migrated entered ticket item as already used without updating ticket rows', async () => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();
    const insertScanEvent = createInsertResult([{ id: 'scan-event-used' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ ticketStatus: 'USED' }),
    );
    db.insert.mockReturnValueOnce(insertScanEvent);

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

    expect(verifyResult satisfies FieldCheckInVerifyResponse).toMatchObject({
      outcome: 'already_used',
      processable: false,
      ticket: expect.objectContaining({
        ticketStatus: 'USED',
      }),
      rejectionReason: '이미 사용된 티켓입니다',
    });
    expect(consumeResult satisfies FieldCheckInConsumeResponse).toMatchObject({
      outcome: 'already_used',
      ticket: expect.objectContaining({
        ticketStatus: 'USED',
      }),
      scanEventId: 'scan-event-used',
      rejectionReason: '이미 사용된 티켓입니다',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketItemId: 'ticket-item-1',
        result: 'already_used',
      }),
    );
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.consume',
        resourceType: 'ticket',
        resourceId: 'ticket-item-1',
        status: 'denied',
      }),
      expect.anything(),
    );
  });

  it('duplicate or already_used consume returns prior scan context with redacted staff/device values', async () => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();
    const priorScanLookup = createSelectResult([
      {
        outcome: 'entered',
        scannedAt: new Date('2026-07-04T08:58:00.000Z'),
        scannerUserId: 'scanner-user-prior-sensitive',
        deviceAttemptId: 'device-attempt-prior-sensitive',
        rawToken: RAW_QR_TOKEN,
        rawJti: FULL_RAW_JTI,
      },
    ]);
    const insertScanEvent = createInsertResult([{ id: 'scan-event-duplicate' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ maskedJti: 'qr-jti...7890' }),
    );
    db.select.mockReturnValueOnce(priorScanLookup);
    db.insert.mockReturnValueOnce(insertScanEvent);

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
    expect(sqlPredicateHasParamValue(priorScanLookup.where.mock.calls[0]?.[0], 'ticket-item-1'))
      .toBe(true);
    expect(db.update).not.toHaveBeenCalled();
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketItemId: 'ticket-item-1',
        result: 'duplicate',
      }),
    );
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.consume',
        resourceId: 'ticket-item-1',
        status: 'denied',
      }),
      expect.anything(),
    );
    expect(JSON.stringify(result.priorScan)).not.toContain('raw');
    expectNoSensitiveLookupLeak(result);
  });

  it('does not treat another seat item prior success as duplicate for the current ticket item', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const priorScanLookup = createSelectResult([]);
    const updateTicket = createUpdateResult([
      {
        ticketId: 'ticket-a2',
        usedAt: new Date('2026-07-04T09:01:00.000Z'),
      },
    ]);
    const updateTicketItem = createUpdateResult([{ ticketItemId: 'ticket-item-a2' }]);
    const insertScanEvent = createInsertResult([{ id: 'scan-event-a2' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({
        ticketId: 'ticket-a2',
        ticketItemId: 'ticket-item-a2',
        seatIdentity: {
          seatId: 'A-2',
          seatKey: '1F:A-2',
          floorKey: '1F',
          floorLabel: '1층',
          row: 'A',
          number: '2',
          tierName: 'VIP',
        },
        seatLabels: ['VIP A열 2번'],
      }),
    );
    db.select.mockReturnValueOnce(priorScanLookup);
    db.update
      .mockReturnValueOnce(updateTicket)
      .mockReturnValueOnce(updateTicketItem);
    db.insert.mockReturnValueOnce(insertScanEvent);

    const result = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(result.outcome).toBe('entered');
    expect(sqlPredicateHasParamValue(priorScanLookup.where.mock.calls[0]?.[0], 'ticket-item-a2'))
      .toBe(true);
    expect(db.update).toHaveBeenCalledWith(ticketItems);
    expect(sqlPredicateHasParamValue(
      updateTicketItem.set.mock.results[0]?.value.where.mock.calls[0]?.[0],
      'ticket-item-a2',
    )).toBe(true);
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket-a2',
        ticketItemId: 'ticket-item-a2',
        result: 'success',
      }),
    );
  });

  it('records already_used attempts against the scanned ticket item after a failed update', async () => {
    const { service, qrTicketService, db, adminAuditService } = createDependencies();
    const initialPriorScanLookup = createSelectResult([]);
    const updateTicket = createUpdateResult([]);
    const laterPriorScanLookup = createSelectResult([
      {
        outcome: 'entered',
        scannedAt: new Date('2026-07-04T08:58:00.000Z'),
        scannerUserId: 'scanner-user-prior-sensitive',
        deviceAttemptId: 'device-attempt-prior-sensitive',
      },
    ]);
    const insertScanEvent = createInsertResult([{ id: 'scan-event-already-used' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ ticketId: 'ticket-1' }),
    );
    db.select
      .mockReturnValueOnce(initialPriorScanLookup)
      .mockReturnValueOnce(laterPriorScanLookup);
    db.update.mockReturnValueOnce(updateTicket);
    db.insert.mockReturnValueOnce(insertScanEvent);

    const result = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(result.outcome).toBe('already_used');
    expect(sqlPredicateHasParamValue(initialPriorScanLookup.where.mock.calls[0]?.[0], 'ticket-item-1'))
      .toBe(true);
    expect(sqlPredicateHasParamValue(laterPriorScanLookup.where.mock.calls[0]?.[0], 'ticket-item-1'))
      .toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalledWith(ticketItems);
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket-1',
        ticketItemId: 'ticket-item-1',
        result: 'already_used',
      }),
    );
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.consume',
        resourceId: 'ticket-item-1',
        status: 'denied',
      }),
      expect.anything(),
    );
  });

  it('precheck consume rejection records a scan event without updating ticket items', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const insertScanEvent = createInsertResult([{ id: 'scan-event-wrong-showtime' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ ticketId: 'ticket-1' }),
    );
    db.insert.mockReturnValueOnce(insertScanEvent);

    const result = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000099',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(result.outcome).toBe('wrong_showtime');
    expect(db.update).not.toHaveBeenCalled();
    expect(insertScanEvent.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketItemId: 'ticket-item-1',
        result: 'wrong_showtime',
      }),
    );
  });

  it('tampered consume rejection does not update ticket items', async () => {
    const { service, qrTicketService, db } = createDependencies();
    qrTicketService.verifyTicketForScannerContract.mockRejectedValue(
      new Error('signature mismatch'),
    );

    const result = await service.consume({
      token: RAW_QR_TOKEN,
      showtimeId: '00000000-0000-4000-8000-000000000001',
      deviceAttemptId: SCANNER_CONTEXT.deviceAttemptId,
      confirmed: true,
    }, SCANNER_CONTEXT);

    expect(result.outcome).toBe('tampered');
    expect(db.update).not.toHaveBeenCalled();
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
