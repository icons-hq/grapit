import { describe, expect, it } from 'vitest';

import {
  prepareReservationSchema,
  type ConsentItemKey,
  REQUIRED_CONSENT_ITEM_KEYS,
} from '@grabit/shared';
import * as bookingContracts from '@grabit/shared';
import {
  payments,
  reservations,
  seatInventories,
  seatMaps,
  seatStatusEnum,
} from './index.js';

function makeBookingConsentItems(
  overrides: Partial<Record<ConsentItemKey, boolean>> = {},
) {
  return REQUIRED_CONSENT_ITEM_KEYS.map((key) => ({
    key,
    version: '2026-05-08',
    language: 'ko',
    accepted: overrides[key] ?? true,
    sourceFlow: 'booking' as const,
  }));
}

function makeSeat(overrides: Record<string, unknown> = {}) {
  return {
    seatId: 'A-1',
    floorKey: '1F',
    floorLabel: '1층',
    seatKey: '1F:A-1',
    tierName: 'VIP',
    tierColor: '#ff3366',
    price: 150000,
    row: 'A',
    number: '1',
    ...overrides,
  };
}

function makeQueueAdmission(overrides: Record<string, unknown> = {}) {
  return {
    queueSessionId: 'queue-session-1',
    admissionToken: 'admission-token-1',
    refreshFamilyId: 'family-1',
    deviceSlotKey: 'device-slot-1',
    admittedAt: '2026-05-08T11:45:00.000Z',
    activeUntilAt: '2026-05-08T11:55:00.000Z',
    reentryGraceUntilAt: '2026-05-08T11:58:00.000Z',
    ...overrides,
  };
}

function expectColumnName(column: { name: string } | undefined, name: string) {
  expect(column?.name).toBe(name);
}

describe('Phase 24 booking core shared contracts', () => {
  it('rejects legacy seatId-only selections because floor-aware identity is required', () => {
    expect(() =>
      prepareReservationSchema.parse({
        orderId: 'GRP-LEGACY',
        showtimeId: '11111111-1111-4111-8111-111111111111',
        seats: [
          {
            seatId: 'A-1',
            tierName: 'VIP',
            price: 150000,
            row: 'A',
            number: '1',
          },
        ],
        amount: 150000,
        consentItems: makeBookingConsentItems(),
        queueAdmission: makeQueueAdmission(),
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      }),
    ).toThrow(/floorKey|floorLabel|seatKey/);
  });

  it('re-exports queue, refund, and qr booking-core schemas from the shared barrel', () => {
    expect(bookingContracts).toHaveProperty('queueAdmissionSchema');
    expect(bookingContracts).toHaveProperty('bookingPolicySchema');
    expect(bookingContracts).toHaveProperty('paymentMethodSchema');
    expect(bookingContracts).toHaveProperty('refundTimelineSchema');
    expect(bookingContracts).toHaveProperty('cancelledSeatHoldSchema');
    expect(bookingContracts).toHaveProperty('qrTicketSchema');
    expect(bookingContracts).toHaveProperty('reservationDetailSchema');
    expect(bookingContracts).toHaveProperty('paymentInfoSchema');
  });

  it('preserves queue admission, payment deadline, refund timeline, and qr ticket fields across parsed contracts', () => {
    const parsedPrepare = prepareReservationSchema.parse({
      orderId: 'GRP-PHASE24',
      showtimeId: '11111111-1111-4111-8111-111111111111',
      seats: [makeSeat()],
      amount: 150000,
      consentItems: makeBookingConsentItems(),
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        overseasPaymentConsent: {
          required: true,
          agreed: true,
          agreementVersion: '2026-05-08',
        },
      },
    });

    expect(parsedPrepare.queueAdmission.queueSessionId).toBe('queue-session-1');
    expect(parsedPrepare.seats[0]).toMatchObject({
      floorKey: '1F',
      floorLabel: '1층',
      seatKey: '1F:A-1',
    });
    expect(parsedPrepare.paymentDeadlineAt).toBe('2026-05-08T11:52:00.000Z');

    const parsedDetail = bookingContracts.reservationDetailSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      reservationNumber: 'GRP-24001',
      status: 'CONFIRMED',
      performanceTitle: 'Girl Rules Fanmeet',
      posterUrl: null,
      showDateTime: '2026-07-18T10:00:00.000Z',
      venue: 'Donghae Arts Center',
      seats: [makeSeat()],
      totalAmount: 150000,
      createdAt: '2026-05-08T11:45:00.000Z',
      paymentMethod: 'ALIPAY_PLUS',
      paidAt: '2026-05-08T11:46:00.000Z',
      cancelDeadline: '2026-07-15T14:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
      paymentKey: 'payment-key-1',
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      refundTimeline: {
        currentState: 'PROCESSING_AT_PG',
        requestedAt: '2026-05-08T12:00:00.000Z',
        sentToPgAt: '2026-05-08T12:01:00.000Z',
        processedAtPgAt: '2026-05-08T12:03:00.000Z',
        completedAt: null,
        failedAt: null,
        expectedDepositAt: '2026-05-11T03:00:00.000Z',
        customerServiceCtaVisible: true,
      },
      cancelledSeatHold: {
        status: 'HELD',
        releaseJobId: 'release-job-1',
        releaseAt: '2026-05-08T12:08:00.000Z',
        releaseWindowMinutes: {
          min: 1,
          max: 10,
        },
        manualOverrideAllowed: true,
      },
      qrTicket: {
        token: 'qr-token-1',
        jti: 'qr-jti-1',
        status: 'ACTIVE',
        issuedAt: '2026-05-08T11:46:00.000Z',
        emailScheduledAt: '2026-07-17T10:00:00.000Z',
      },
    });

    expect(parsedDetail.refundTimeline.currentState).toBe('PROCESSING_AT_PG');
    expect(parsedDetail.cancelledSeatHold.releaseWindowMinutes.max).toBe(10);
    expect(parsedDetail.qrTicket.jti).toBe('qr-jti-1');
  });
});

describe('Phase 24 booking core database schema contracts', () => {
  it('requires floor-aware seat maps, held-cancelled inventory, reservation payment deadline, and booking policy storage', async () => {
    expectColumnName(
      (seatMaps as Record<string, { name: string }>).floorKey,
      'floor_key',
    );
    expectColumnName(
      (seatMaps as Record<string, { name: string }>).floorLabel,
      'floor_label',
    );
    expectColumnName(
      (seatMaps as Record<string, { name: string }>).sortOrder,
      'sort_order',
    );

    expectColumnName(
      (seatInventories as Record<string, { name: string }>).floorKey,
      'floor_key',
    );
    expectColumnName(
      (seatInventories as Record<string, { name: string }>).seatKey,
      'seat_key',
    );
    expectColumnName(
      (seatInventories as Record<string, { name: string }>).reopenHoldUntil,
      'reopen_hold_until',
    );
    expect(seatStatusEnum.enumValues).toContain('held_cancelled');

    expectColumnName(
      (reservations as Record<string, { name: string }>).paymentDeadlineAt,
      'payment_deadline_at',
    );
    expectColumnName(
      (reservations as Record<string, { name: string }>).queueSessionId,
      'queue_session_id',
    );
    expectColumnName(
      (payments as Record<string, { name: string }>).provider,
      'provider',
    );
    expectColumnName(
      (payments as Record<string, { name: string }>).currency,
      'currency',
    );
    expectColumnName(
      (payments as Record<string, { name: string }>).asyncStatus,
      'async_status',
    );
    expectColumnName(
      (payments as Record<string, { name: string }>).disclaimerAcceptedAt,
      'disclaimer_accepted_at',
    );

    const bookingPoliciesModule = await import('./booking-policies.js').catch(
      () => null,
    );
    expect(bookingPoliciesModule?.bookingPolicies).toBeDefined();
    expectColumnName(
      (
        bookingPoliciesModule?.bookingPolicies as Record<
          string,
          { name: string }
        >
      )?.maxTicketsPerUser,
      'max_tickets_per_user',
    );
    expectColumnName(
      (
        bookingPoliciesModule?.bookingPolicies as Record<
          string,
          { name: string }
        >
      )?.allowedPaymentMethods,
      'allowed_payment_methods',
    );
  });
});
