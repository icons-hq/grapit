import { describe, expect, it } from 'vitest';

import {
  prepareReservationResponseSchema,
  prepareReservationSchema,
  reservationDetailSchema,
} from './booking.schema';
import {
  REQUIRED_CONSENT_ITEM_KEYS,
  type ConsentItemKey,
} from './consent.schema';

function makeBookingConsentItems(
  overrides: Partial<Record<ConsentItemKey, boolean>> = {},
) {
  return REQUIRED_CONSENT_ITEM_KEYS.map((key) => ({
    key,
    version: '2026-04-28',
    language: 'ko',
    accepted: overrides[key] ?? true,
    sourceFlow: 'booking' as const,
  }));
}

function makeSeat() {
  return {
    seatId: 'A-1',
    floorKey: '1F',
    floorLabel: '1층',
    seatKey: '1F:A-1',
    tierName: 'VIP',
    price: 50000,
    row: 'A',
    number: '1',
  };
}

function makeQueueAdmission() {
  return {
    queueSessionId: 'queue-session-1',
    admissionToken: 'admission-token-1',
    refreshFamilyId: 'family-1',
    deviceSlotKey: 'device-slot-1',
    admittedAt: '2026-05-08T11:45:00.000Z',
    activeUntilAt: '2026-05-08T11:55:00.000Z',
    reentryGraceUntilAt: '2026-05-08T11:58:00.000Z',
  };
}

function makePaymentMethod() {
  return {
    method: 'FOREIGN_EASY_PAY' as const,
    provider: 'ALIPAY_PLUS' as const,
    currency: 'USD',
    overseasPaymentConsent: {
      required: true,
      agreed: true,
      agreementVersion: '2026-05-08',
    },
  };
}

describe('prepareReservationSchema booking consent contract', () => {
  it('requires itemized booking consent rows before reservation prepare', () => {
    expect(() =>
      prepareReservationSchema.parse({
        orderId: 'GRP-NO-CONSENT',
        showtimeId: '11111111-1111-4111-8111-111111111111',
        seats: [makeSeat()],
        amount: 50000,
        queueAdmission: makeQueueAdmission(),
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
        bookingPolicy: {
          maxTicketsPerOrder: 1,
          cancellationChangePolicy: 'CANCEL_ONLY',
          sameGradeChangeEnabled: false,
        },
        paymentMethod: makePaymentMethod(),
      }),
    ).toThrow(/예매 동의 항목/);
  });

  it('accepts booking consent rows tagged with sourceFlow=booking', () => {
    const parsed = prepareReservationSchema.parse({
      orderId: 'GRP-CONSENT',
      showtimeId: '11111111-1111-4111-8111-111111111111',
      seats: [makeSeat()],
      amount: 50000,
      consentItems: makeBookingConsentItems(),
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      paymentMethod: makePaymentMethod(),
    });

    expect(parsed.consentItems.map((item) => item.sourceFlow)).toEqual(
      REQUIRED_CONSENT_ITEM_KEYS.map(() => 'booking'),
    );
    expect(parsed.seats[0]).toMatchObject({
      floorKey: '1F',
      floorLabel: '1층',
      seatKey: '1F:A-1',
    });
    expect(parsed.queueAdmission.queueSessionId).toBe('queue-session-1');
    expect(parsed.paymentDeadlineAt).toBe('2026-05-08T11:52:00.000Z');
  });

  it('keeps booking-core response/detail contracts for payment, refund, and qr surfaces', () => {
    const response = prepareReservationResponseSchema.parse({
      reservationId: '11111111-1111-4111-8111-111111111111',
      orderId: 'GRP-CONSENT',
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      paymentMethod: makePaymentMethod(),
    });

    const detail = reservationDetailSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      reservationNumber: 'GRP-24001',
      status: 'CONFIRMED',
      performanceTitle: 'Girl Rules Fanmeet',
      posterUrl: null,
      showDateTime: '2026-07-18T10:00:00.000Z',
      venue: 'Donghae Arts Center',
      seats: [makeSeat()],
      totalAmount: 50000,
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

    expect(response.queueAdmission.queueSessionId).toBe('queue-session-1');
    expect(detail.refundTimeline.currentState).toBe('PROCESSING_AT_PG');
    expect(detail.cancelledSeatHold?.releaseWindowMinutes.max).toBe(10);
    expect(detail.qrTicket.jti).toBe('qr-jti-1');
  });
});
