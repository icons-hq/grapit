import { describe, expect, it } from 'vitest';

import {
  benefitConfigurationSchema,
  benefitEntitlementExportRowSchema,
  benefitRedemptionRequestSchema,
  benefitRedemptionResponseSchema,
  benefitRunRecordSchema,
  benefitRunRequestSchema,
} from './benefit.schema';
import { ticketItemSchema } from './ticket-item.schema';

const showtimeId = '11111111-1111-4111-8111-111111111111';
const ticketItemId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const benefitIdentity = 'benefit_6_to_1';
const benefitDisplayCopy = {
  ko: { name: '6:1', description: '6:1 이벤트 참여 혜택' },
  en: { name: '6:1', description: '6:1 event benefit' },
  'zh-CN': { name: '6:1', description: '6:1 活动福利' },
  th: { name: '6:1', description: 'สิทธิประโยชน์กิจกรรม 6:1' },
};

const validIso = '2026-07-04T09:00:00.000Z';
const configurationId = '44444444-4444-4444-8444-444444444444';
const entitlementId = '55555555-5555-4555-8555-555555555555';

function includedBenefit(overrides: Record<string, unknown> = {}) {
  return {
    identity: benefitIdentity,
    kind: 'included',
    displayCopy: benefitDisplayCopy,
    eligibleTierNames: ['VIP'],
    ...overrides,
  };
}

function limitedBenefit(overrides: Record<string, unknown> = {}) {
  return {
    identity: 'benefit_polaroid',
    kind: 'limited',
    displayCopy: {
      ko: { name: '폴라로이드', description: '폴라로이드 추첨 혜택' },
      en: { name: 'Polaroid', description: 'Polaroid lottery benefit' },
      'zh-CN': { name: '拍立得', description: '拍立得抽选福利' },
      th: { name: 'โพลารอยด์', description: 'สิทธิประโยชน์จับฉลากโพลารอยด์' },
    },
    eligibleTierNames: ['VIP'],
    quantity: 30,
    selectionPriority: 1,
    mutuallyExclusiveWith: [benefitIdentity],
    ...overrides,
  };
}

function benefitEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    id: entitlementId,
    ticketItemId,
    showtimeId,
    runId,
    benefitIdentity,
    kind: 'included',
    displayCopy: benefitDisplayCopy,
    state: 'active',
    runMode: 'live',
    attachedToTicket: true,
    assignedAt: validIso,
    redeemedAt: null,
    ...overrides,
  };
}

function ticketItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ticketItemId,
    reservationId: '66666666-6666-4666-8666-666666666666',
    paymentId: '77777777-7777-4777-8777-777777777777',
    showtimeId,
    seatId: 'A-1',
    seatKey: '1F:A-1',
    floorKey: '1F',
    floorLabel: '1층',
    row: 'A',
    number: '1',
    tierName: 'VIP',
    price: 100000,
    serviceFee: 2000,
    status: 'ACTIVE',
    admissionState: 'NOT_ENTERED',
    enteredAt: null,
    qrCredential: null,
    cancellation: null,
    ...overrides,
  };
}

describe('ticket benefit shared contracts', () => {
  it('accepts active configuration with one included benefit and one limited benefit', () => {
    const parsed = benefitConfigurationSchema.parse({
      id: configurationId,
      showtimeId,
      active: true,
      version: 1,
      benefits: [includedBenefit(), limitedBenefit()],
      createdAt: validIso,
      updatedAt: validIso,
      activatedAt: validIso,
    });

    expect(parsed.active).toBe(true);
    expect(parsed.benefits.map((benefit) => benefit.kind)).toEqual([
      'included',
      'limited',
    ]);
    expect(parsed.benefits[0]).not.toHaveProperty('quantity');
    expect(parsed.benefits[1]).toMatchObject({
      quantity: 30,
      selectionPriority: 1,
      mutuallyExclusiveWith: [benefitIdentity],
    });

    expect(() =>
      benefitConfigurationSchema.parse({
        id: configurationId,
        showtimeId,
        active: true,
        version: 1,
        benefits: [includedBenefit({ quantity: 1 })],
        createdAt: validIso,
        updatedAt: validIso,
        activatedAt: validIso,
      }),
    ).toThrow();

    expect(() =>
      benefitConfigurationSchema.parse({
        id: configurationId,
        showtimeId,
        active: true,
        version: 1,
        benefits: [limitedBenefit({ selectionPriority: 0 })],
        createdAt: validIso,
        updatedAt: validIso,
        activatedAt: validIso,
      }),
    ).toThrow();
  });

  it('parses unsaved test-run configuration snapshots without making them active configuration', () => {
    const parsed = benefitRunRequestSchema.parse({
      mode: 'test',
      showtimeId,
      operatorProvidedSeedRef: 'operator-seed-20260704',
      configurationSnapshot: {
        active: false,
        benefits: [includedBenefit(), limitedBenefit()],
        capturedAt: validIso,
      },
    });

    expect(parsed.mode).toBe('test');
    expect(parsed.configurationSnapshot?.active).toBe(false);
    expect(() =>
      benefitConfigurationSchema.parse(parsed.configurationSnapshot),
    ).toThrow();
  });

  it('requires live run records to attach to tickets with only a redacted seed reference', () => {
    const parsed = benefitRunRecordSchema.parse({
      id: runId,
      showtimeId,
      configurationId,
      mode: 'live',
      attachedToTicket: true,
      redactedSeedRef: 'seed_***_4d2a',
      entitlementCount: 2,
      createdByUserId: 'admin-1',
      startedAt: validIso,
      completedAt: validIso,
    });

    expect(parsed.mode).toBe('live');
    expect(parsed.attachedToTicket).toBe(true);
    expect(parsed.redactedSeedRef).toBe('seed_***_4d2a');

    expect(() =>
      benefitRunRecordSchema.parse({
        ...parsed,
        attachedToTicket: false,
      }),
    ).toThrow();

    expect(() =>
      benefitRunRecordSchema.parse({
        ...parsed,
        redactedSeedRef: undefined,
      }),
    ).toThrow();

    expect(() =>
      benefitRunRequestSchema.parse({
        mode: 'live',
        showtimeId,
        configurationId,
        operatorProvidedSeedRef: 'raw-operator-seed',
      }),
    ).toThrow();
  });

  it('requires test run records to stay detached and allows an operator seed reference', () => {
    const parsed = benefitRunRecordSchema.parse({
      id: runId,
      showtimeId,
      configurationId,
      mode: 'test',
      attachedToTicket: false,
      redactedSeedRef: 'seed_***_test',
      operatorProvidedSeedRef: 'operator-seed-20260704',
      entitlementCount: 0,
      createdByUserId: 'admin-1',
      startedAt: validIso,
      completedAt: null,
    });

    expect(parsed.mode).toBe('test');
    expect(parsed.attachedToTicket).toBe(false);
    expect(parsed.operatorProvidedSeedRef).toBe('operator-seed-20260704');

    expect(() =>
      benefitRunRecordSchema.parse({
        ...parsed,
        attachedToTicket: true,
      }),
    ).toThrow();
  });

  it('includes run mode and attachment state in entitlement export rows', () => {
    const parsed = benefitEntitlementExportRowSchema.parse({
      benefitEntitlementId: entitlementId,
      ticketItemId,
      showtimeId,
      runId,
      runMode: 'test',
      attachedToTicket: false,
      benefitIdentity,
      benefitKind: 'included',
      benefitNameKo: '6:1',
      state: 'active',
      assignedAt: validIso,
      redeemedAt: null,
    });

    expect(parsed.runMode).toBe('test');
    expect(parsed.attachedToTicket).toBe(false);
  });

  it('requires confirmed redemption requests with QR token, showtime, entitlement, and device attempt identifiers', () => {
    const request = {
      token: 'opaque-qr-token',
      showtimeId,
      benefitEntitlementId: entitlementId,
      deviceAttemptId: 'device-attempt-1',
      confirmed: true,
    };

    expect(benefitRedemptionRequestSchema.parse(request)).toEqual(request);

    for (const field of [
      'token',
      'showtimeId',
      'benefitEntitlementId',
      'deviceAttemptId',
    ] as const) {
      const missingField = { ...request };
      delete missingField[field];
      expect(() => benefitRedemptionRequestSchema.parse(missingField)).toThrow();
    }

    expect(() =>
      benefitRedemptionRequestSchema.parse({
        ...request,
        confirmed: false,
      }),
    ).toThrow();
  });

  it('requires duplicate redemption responses to include prior redemption context', () => {
    const parsed = benefitRedemptionResponseSchema.parse({
      outcome: 'duplicate',
      benefitEntitlement: benefitEntitlement({
        state: 'redeemed',
        redeemedAt: validIso,
      }),
      redeemedAt: validIso,
      redemptionEventId: 'benefit-redemption-1',
      priorRedemption: {
        redeemedAt: '2026-07-04T08:50:00.000Z',
        scannerUserId: 'scanner-1',
        deviceAttemptId: 'device-attempt-0',
        redemptionEventId: 'benefit-redemption-0',
      },
    });

    expect(parsed.outcome).toBe('duplicate');
    expect(parsed.priorRedemption?.deviceAttemptId).toBe('device-attempt-0');

    expect(() =>
      benefitRedemptionResponseSchema.parse({
        outcome: 'duplicate',
        benefitEntitlement: benefitEntitlement({ state: 'redeemed' }),
        redeemedAt: validIso,
      }),
    ).toThrow();
  });

  it('allows ticket items to carry benefit entitlements', () => {
    const parsed = ticketItemSchema.parse({
      ...ticketItem(),
      benefitEntitlements: [benefitEntitlement()],
    });

    expect(parsed.benefitEntitlements).toHaveLength(1);
    expect(parsed.benefitEntitlements[0]?.benefitIdentity).toBe(benefitIdentity);
  });
});
