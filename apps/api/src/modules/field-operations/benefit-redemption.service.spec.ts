import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BenefitRedemptionResponse } from '@grabit/shared';

import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import {
  ticketBenefitEntitlements,
  ticketBenefitRedemptionRecords,
} from '../../database/schema/index.js';
import type { QrTicketScannerContract } from '../ticket/qr-ticket.service.js';
import { BenefitRedemptionController } from './benefit-redemption.controller.js';
import { BenefitRedemptionService } from './benefit-redemption.service.js';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_SHOWTIME_ID = '00000000-0000-4000-8000-000000000099';
const TICKET_ITEM_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_TICKET_ITEM_ID = '00000000-0000-4000-8000-000000000003';
const ENTITLEMENT_ID = '00000000-0000-4000-8000-0000000000b1';
const REDEMPTION_ID = '00000000-0000-4000-8000-0000000000c1';
const SCANNER_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const DEVICE_ATTEMPT_ID = 'benefit-attempt-1';
const RAW_QR_TOKEN = 'ey.raw.qr-ticket-token-with-sensitive-benefit-jti';
const FULL_RAW_JTI = 'qr-jti-benefit-full-raw-1234567890';
const NOW = new Date('2026-07-04T09:10:00.000Z');

function createSelectResult<T>(rows: T[]) {
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

function createUpdateResult<T>(rows: T[] = []) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function createInsertResult<T>(rows: T[] = [{ id: REDEMPTION_ID } as T]) {
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

function displayCopy(name = '6:1') {
  return {
    ko: { name, description: `${name} 이벤트 참여 혜택` },
    en: { name, description: `${name} event benefit` },
    'zh-CN': { name, description: `${name} 活动福利` },
    th: { name, description: `สิทธิประโยชน์กิจกรรม ${name}` },
  };
}

function entitlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTITLEMENT_ID,
    showtimeId: SHOWTIME_ID,
    ticketItemId: TICKET_ITEM_ID,
    benefitIdentity: 'benefit_6_to_1',
    benefitKind: 'limited',
    displayCopySnapshot: displayCopy(),
    source: 'live_run',
    runId: '00000000-0000-4000-8000-0000000000d1',
    state: 'active',
    inactiveReason: null,
    redeemedAt: null,
    redeemedByUserId: null,
    createdAt: new Date('2026-07-04T08:00:00.000Z'),
    updatedAt: new Date('2026-07-04T08:00:00.000Z'),
    ...overrides,
  };
}

function scannerContract(
  overrides: Partial<QrTicketScannerContract> = {},
): QrTicketScannerContract {
  return {
    tokenVersion: '2026-07',
    ticketStatus: 'ACTIVE',
    ticketItemId: TICKET_ITEM_ID,
    reservationId: '00000000-0000-4000-8000-000000000004',
    paymentId: '00000000-0000-4000-8000-000000000005',
    showtimeId: SHOWTIME_ID,
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

function redemptionRequest(overrides: Record<string, unknown> = {}) {
  return {
    token: RAW_QR_TOKEN,
    showtimeId: SHOWTIME_ID,
    benefitEntitlementId: ENTITLEMENT_ID,
    deviceAttemptId: DEVICE_ATTEMPT_ID,
    confirmed: true,
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
    update: vi.fn(),
    transaction: vi.fn(),
  };
  const service = new BenefitRedemptionService(
    db as never,
    qrTicketService as never,
  );

  return { service, qrTicketService, db };
}

function expectNoRawQrLeak(result: unknown) {
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(RAW_QR_TOKEN);
  expect(serialized).not.toContain(FULL_RAW_JTI);
  expect(serialized).not.toContain('rawToken');
  expect(serialized).not.toContain('rawJti');
}

describe('BenefitRedemptionService RED contract', () => {
  it('redeems exactly one active benefit entitlement online and stores only redacted QR reference', async () => {
    vi.setSystemTime(NOW);
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([entitlementRow()]);
    const priorLookup = createSelectResult([]);
    const updateEntitlement = createUpdateResult([
      entitlementRow({
        state: 'redeemed',
        redeemedAt: NOW,
        redeemedByUserId: SCANNER_USER_ID,
        updatedAt: NOW,
      }),
    ]);
    const insertRedemption = createInsertResult([{ id: REDEMPTION_ID }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(scannerContract());
    db.select
      .mockReturnValueOnce(entitlementLookup)
      .mockReturnValueOnce(priorLookup);
    db.update.mockReturnValueOnce(updateEntitlement);
    db.insert.mockReturnValueOnce(insertRedemption);

    const result = await service.redeem(redemptionRequest(), {
      scannerUserId: SCANNER_USER_ID,
      ipAddress: '203.0.113.44',
      userAgent: 'Field Scanner Mobile Browser',
    });

    expect(result satisfies BenefitRedemptionResponse).toMatchObject({
      outcome: 'redeemed',
      redemptionEventId: REDEMPTION_ID,
      redeemedAt: NOW.toISOString(),
      benefitEntitlement: expect.objectContaining({
        id: ENTITLEMENT_ID,
        ticketItemId: TICKET_ITEM_ID,
        showtimeId: SHOWTIME_ID,
        state: 'redeemed',
      }),
    });
    expect(qrTicketService.verifyTicketForScannerContract).toHaveBeenCalledWith(RAW_QR_TOKEN);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(ticketBenefitEntitlements);
    expect(updateEntitlement.set).toHaveBeenCalledWith({
      state: 'redeemed',
      redeemedAt: NOW,
      redeemedByUserId: SCANNER_USER_ID,
      updatedAt: NOW,
    });
    expect(sqlPredicateHasParamValue(
      updateEntitlement.set.mock.results[0]?.value.where.mock.calls[0]?.[0],
      ENTITLEMENT_ID,
    )).toBe(true);
    expect(db.insert).toHaveBeenCalledWith(ticketBenefitRedemptionRecords);
    expect(insertRedemption.values).toHaveBeenCalledWith(
      expect.objectContaining({
        showtimeId: SHOWTIME_ID,
        ticketItemId: TICKET_ITEM_ID,
        benefitEntitlementId: ENTITLEMENT_ID,
        scannerUserId: SCANNER_USER_ID,
        deviceAttemptId: DEVICE_ATTEMPT_ID,
        redactedTokenRef: expect.stringMatching(/^qr:[a-f0-9]{16}$/),
        result: 'redeemed',
      }),
    );
    expect(JSON.stringify(insertRedemption.values.mock.calls)).not.toContain(RAW_QR_TOKEN);
    expectNoRawQrLeak(result);
  });

  it('rejects duplicate benefit redemption with prior redemption context without marking venue duplicate scan', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const priorRedemptionAt = new Date('2026-07-04T09:00:00.000Z');
    const entitlementLookup = createSelectResult([
      entitlementRow({ state: 'redeemed', redeemedAt: priorRedemptionAt }),
    ]);
    const priorLookup = createSelectResult([
      {
        id: REDEMPTION_ID,
        createdAt: priorRedemptionAt,
        scannerUserId: '00000000-0000-4000-8000-00000000beef',
        deviceAttemptId: 'benefit-attempt-prior-sensitive',
      },
    ]);
    const insertDuplicate = createInsertResult([{ id: '00000000-0000-4000-8000-0000000000c2' }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(scannerContract());
    db.select
      .mockReturnValueOnce(entitlementLookup)
      .mockReturnValueOnce(priorLookup);
    db.insert.mockReturnValueOnce(insertDuplicate);

    const result = await service.redeem(redemptionRequest({
      deviceAttemptId: 'benefit-attempt-duplicate',
    }), {
      scannerUserId: SCANNER_USER_ID,
    });

    expect(result).toMatchObject({
      outcome: 'duplicate',
      benefitEntitlement: expect.objectContaining({
        id: ENTITLEMENT_ID,
        state: 'redeemed',
      }),
      priorRedemption: {
        redeemedAt: priorRedemptionAt.toISOString(),
        scannerUserId: expect.stringMatching(/^00000000-0000/),
        deviceAttemptId: expect.stringMatching(/^benefit-attempt/),
        redemptionEventId: REDEMPTION_ID,
      },
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(insertDuplicate.values).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'duplicate',
        deviceAttemptId: 'benefit-attempt-duplicate',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('field.scan');
    expectNoRawQrLeak(result);
  });

  it('rejects wrong showtime without updating the entitlement', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([entitlementRow()]);
    const insertWrongShowtime = createInsertResult([{ id: REDEMPTION_ID }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(
      scannerContract({ showtimeId: OTHER_SHOWTIME_ID }),
    );
    db.select.mockReturnValueOnce(entitlementLookup);
    db.insert.mockReturnValueOnce(insertWrongShowtime);

    const result = await service.redeem(redemptionRequest(), {
      scannerUserId: SCANNER_USER_ID,
    });

    expect(result).toMatchObject({
      outcome: 'wrong_showtime',
      rejectionReason: '요청한 회차와 일치하지 않는 티켓입니다',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(insertWrongShowtime.values).toHaveBeenCalledWith(
      expect.objectContaining({
        showtimeId: SHOWTIME_ID,
        ticketItemId: TICKET_ITEM_ID,
        result: 'wrong_showtime',
      }),
    );
    expectNoRawQrLeak(result);
  });

  it('rejects inactive or cancelled entitlement without redeeming it', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([
      entitlementRow({ state: 'inactive', inactiveReason: 'ticket_cancelled' }),
    ]);
    const insertInactive = createInsertResult([{ id: REDEMPTION_ID }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(scannerContract());
    db.select.mockReturnValueOnce(entitlementLookup);
    db.insert.mockReturnValueOnce(insertInactive);

    const result = await service.redeem(redemptionRequest(), {
      scannerUserId: SCANNER_USER_ID,
    });

    expect(result).toMatchObject({
      outcome: 'inactive',
      benefitEntitlement: expect.objectContaining({
        id: ENTITLEMENT_ID,
        state: 'inactive',
      }),
      rejectionReason: '사용할 수 없는 혜택입니다',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(insertInactive.values).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'inactive' }),
    );
  });

  it('rejects tampered QR token and never persists the raw token', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([entitlementRow()]);
    const insertTampered = createInsertResult([{ id: REDEMPTION_ID }]);
    qrTicketService.verifyTicketForScannerContract.mockRejectedValue(
      new Error('signature mismatch'),
    );
    db.select.mockReturnValueOnce(entitlementLookup);
    db.insert.mockReturnValueOnce(insertTampered);

    const result = await service.redeem(redemptionRequest(), {
      scannerUserId: SCANNER_USER_ID,
    });

    expect(result).toMatchObject({
      outcome: 'tampered',
      rejectionReason: '검증할 수 없는 QR 티켓입니다',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(insertTampered.values).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'tampered',
        redactedTokenRef: expect.stringMatching(/^qr:[a-f0-9]{16}$/),
      }),
    );
    expect(JSON.stringify(insertTampered.values.mock.calls)).not.toContain(RAW_QR_TOKEN);
    expectNoRawQrLeak(result);
  });

  it('rejects entitlement that does not belong to the QR ticket item as not eligible', async () => {
    const { service, qrTicketService, db } = createDependencies();
    const entitlementLookup = createSelectResult([
      entitlementRow({ ticketItemId: OTHER_TICKET_ITEM_ID }),
    ]);
    const insertNotEligible = createInsertResult([{ id: REDEMPTION_ID }]);
    qrTicketService.verifyTicketForScannerContract.mockResolvedValue(scannerContract());
    db.select.mockReturnValueOnce(entitlementLookup);
    db.insert.mockReturnValueOnce(insertNotEligible);

    const result = await service.redeem(redemptionRequest(), {
      scannerUserId: SCANNER_USER_ID,
    });

    expect(result).toMatchObject({
      outcome: 'not_eligible',
      rejectionReason: '해당 티켓에 배정된 혜택이 아닙니다',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(insertNotEligible.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketItemId: OTHER_TICKET_ITEM_ID,
        result: 'not_eligible',
      }),
    );
  });
});

describe('BenefitRedemptionController route contract', () => {
  it('exposes only the online redeem endpoint with existing scanner consume capability', () => {
    const prototype = BenefitRedemptionController.prototype;
    const controllerSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'benefit-redemption.controller.ts'),
      'utf8',
    );

    expect(Reflect.getMetadata(PATH_METADATA, BenefitRedemptionController))
      .toBe('field/benefits');
    expect(Reflect.getMetadata(ROLES_KEY, BenefitRedemptionController)).toEqual(['admin']);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.redeem)).toBe('redeem');
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.redeem)).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(ADMIN_CAPABILITIES_KEY, prototype.redeem),
    ).toEqual(['field.scan.consume']);
    expect(controllerSource).toContain('new ZodValidationPipe(benefitRedemptionRequestSchema)');
    expect(controllerSource).not.toMatch(/offline/i);
  });
});
