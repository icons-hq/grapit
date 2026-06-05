import { describe, expect, it } from 'vitest';

import * as bookingContracts from './booking.schema';
import {
  adminBookingDetailSchema,
  adminBookingFunnelStatusSchema,
  adminBookingListQuerySchema,
  adminBookingListItemSchema,
  bookingStatsSchema,
  cancelTicketItemSchema,
  confirmPaymentSchema,
  prepareReservationResponseSchema,
  prepareReservationSchema,
  providerChargeQuoteSchema,
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

function makeTicketItem(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-000000000101',
    reservationId: '11111111-1111-4111-8111-111111111111',
    paymentId: '11111111-1111-4111-8111-222222222222',
    showtimeId: '11111111-1111-4111-8111-333333333333',
    seatId: 'A-1',
    floorKey: '1F',
    floorLabel: '1층',
    seatKey: '1F:A-1',
    tierName: 'VIP',
    price: 50000,
    serviceFee: 2000,
    row: 'A',
    number: '1',
    status: 'ACTIVE',
    admissionState: 'NOT_ENTERED',
    enteredAt: null,
    qrCredential: {
      id: '11111111-1111-4111-8111-000000000201',
      token: 'qr-token-seat-a1',
      jti: 'qr-jti-seat-a1',
      status: 'ACTIVE',
      issuedAt: '2026-05-08T11:46:00.000Z',
      rotatedAt: null,
      revokedAt: null,
    },
    cancellation: null,
    ...overrides,
  };
}

function makeTicketEmailDelivery(overrides: Record<string, unknown> = {}) {
  return {
    email: 'buyer@example.com',
    isEmailVerified: true,
    isPlaceholderEmail: false,
    canSend: true,
    status: 'ready',
    scheduledAt: '2026-07-17T10:00:00.000Z',
    lastSentAt: null,
    ...overrides,
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
  it('accepts backend-owned PayPal provider charge quotes', () => {
    const parsed = providerChargeQuoteSchema.parse({
      currency: 'USD',
      amountMinor: 10800,
      amountDecimal: '108.00',
      rate: '0.00072',
      quotedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(parsed).toMatchObject({
      currency: 'USD',
      amountMinor: 10800,
    });
  });

  it('rejects zero provider charge decimal strings', () => {
    expect(() =>
      providerChargeQuoteSchema.parse({
        currency: 'USD',
        amountMinor: 1,
        amountDecimal: '0.00',
        rate: '0.00072',
        quotedAt: '2026-05-29T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts PayPal confirm payload with provider charge amount', () => {
    const parsed = confirmPaymentSchema.parse({
      paymentKey: 'pay_paypal',
      orderId: 'GRP-PAYPAL',
      provider: 'PAYPAL',
      providerChargeAmount: '108.00',
    });

    expect(parsed).toMatchObject({ provider: 'PAYPAL' });
  });

  it('rejects overseas-card confirm payload with only a KRW amount marker', () => {
    expect(() => confirmPaymentSchema.parse({
      paymentKey: 'pay_overseas_card',
      orderId: 'GRP-OVERSEAS-CARD',
      provider: 'OVERSEAS_CARD',
      amount: 150000,
    })).toThrow();
  });

  it('accepts overseas-card confirm payload with a USD provider charge amount', () => {
    const parsed = confirmPaymentSchema.parse({
      paymentKey: 'pay_overseas_card_usd',
      orderId: 'GRP-OVERSEAS-CARD-USD',
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: '108.00',
    });

    expect(parsed).toMatchObject({
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: '108.00',
    });
  });

  it('rejects ambiguous confirm payloads', () => {
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_card',
        orderId: 'GRP-CARD',
        amount: 150000,
        providerChargeAmount: '108.00',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_paypal',
        orderId: 'GRP-PAYPAL',
        provider: 'PAYPAL',
        amount: 150000,
        providerChargeAmount: '108.00',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_paypal',
        orderId: 'GRP-PAYPAL',
        provider: 'PAYPAL',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_card',
        orderId: 'GRP-CARD',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_paypal',
        orderId: 'GRP-PAYPAL',
        provider: 'PAYPAL',
        providerChargeAmount: '0.00',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_overseas_card',
        orderId: 'GRP-OVERSEAS-CARD',
        provider: 'OVERSEAS_CARD',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_overseas_card',
        orderId: 'GRP-OVERSEAS-CARD',
        provider: 'OVERSEAS_CARD',
        amount: 150000,
        providerChargeAmount: '108.00',
      }),
    ).toThrow();
  });

  it('keeps domestic confirm amount as a positive integer', () => {
    expect(
      confirmPaymentSchema.parse({
        paymentKey: 'pay_card',
        orderId: 'GRP-CARD',
        amount: 150000,
      }),
    ).toMatchObject({ amount: 150000 });

    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_card',
        orderId: 'GRP-CARD',
        amount: '150000',
      }),
    ).toThrow();
    expect(() =>
      confirmPaymentSchema.parse({
        paymentKey: 'pay_card',
        orderId: 'GRP-CARD',
        amount: 150000.5,
      }),
    ).toThrow();
  });

  it('validates buyer ticket-item cancellation reason like reservation cancellation', () => {
    const parsed = cancelTicketItemSchema.parse({ reason: '단순 변심' });

    expect(parsed.reason).toBe('단순 변심');
    expect(() => cancelTicketItemSchema.parse({ reason: '' })).toThrow(/취소 사유/);
    expect(() => cancelTicketItemSchema.parse({ reason: 'x'.repeat(201) })).toThrow(/200자/);
  });

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
      paymentInfo: {
        paymentKey: 'payment-key-1',
        method: 'ALIPAY_PLUS',
        amount: 50000,
        status: 'DONE',
        paidAt: '2026-05-08T11:46:00.000Z',
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      },
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
        entryStatus: 'ENTERED',
        enteredAt: '2026-05-08T11:50:00.000Z',
        issuedAt: '2026-05-08T11:46:00.000Z',
        emailScheduledAt: '2026-07-17T10:00:00.000Z',
      },
      ticketEmailDelivery: makeTicketEmailDelivery(),
      ticketItems: [
        makeTicketItem(),
        makeTicketItem({
          id: '11111111-1111-4111-8111-000000000102',
          seatId: 'A-2',
          seatKey: '1F:A-2',
          number: '2',
          admissionState: 'ENTERED',
          enteredAt: '2026-05-08T11:50:00.000Z',
          qrCredential: {
            id: '11111111-1111-4111-8111-000000000202',
            token: 'qr-token-seat-a2',
            jti: 'qr-jti-seat-a2',
            status: 'ACTIVE',
            issuedAt: '2026-05-08T11:46:00.000Z',
            rotatedAt: null,
            revokedAt: null,
          },
        }),
      ],
    });

    expect(response.queueAdmission.queueSessionId).toBe('queue-session-1');
    expect(detail.refundTimeline.currentState).toBe('PROCESSING_AT_PG');
    expect(detail.cancelledSeatHold?.releaseWindowMinutes.max).toBe(10);
    expect(detail.qrTicket.jti).toBe('qr-jti-1');
    expect(detail.qrTicket.entryStatus).toBe('ENTERED');
    expect(detail.ticketEmailDelivery.canSend).toBe(true);
    expect(detail.ticketItems).toHaveLength(2);
    expect(detail.ticketItems.map((item) => item.qrCredential?.jti)).toEqual([
      'qr-jti-seat-a1',
      'qr-jti-seat-a2',
    ]);
    expect(detail.ticketItems[1]?.admissionState).toBe('ENTERED');
  });

  it('accepts pending ticket-item details with a blocking inactive QR shell', () => {
    const parsed = reservationDetailSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      reservationNumber: 'GRP-24002',
      status: 'CONFIRMED',
      performanceTitle: 'Girl Rules Fanmeet',
      posterUrl: null,
      showDateTime: '2026-07-18T10:00:00.000Z',
      venue: 'Donghae Arts Center',
      seats: [makeSeat()],
      totalAmount: 50000,
      createdAt: '2026-05-08T11:45:00.000Z',
      paymentMethod: 'CARD',
      paidAt: '2026-05-08T11:46:00.000Z',
      cancelDeadline: '2026-07-15T14:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
      paymentKey: 'payment-key-1',
      paymentInfo: {
        paymentKey: 'payment-key-1',
        method: 'CARD',
        amount: 50000,
        status: 'DONE',
        paidAt: '2026-05-08T11:46:00.000Z',
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      },
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
        customerServiceCtaVisible: true,
      },
      cancelledSeatHold: null,
      qrTicket: {
        token: '',
        jti: '',
        status: 'REVOKED',
        entryStatus: 'NOT_ENTERED',
        enteredAt: null,
        issuedAt: '2026-05-08T11:46:00.000Z',
        emailScheduledAt: null,
        emailedAt: null,
      },
      ticketEmailDelivery: makeTicketEmailDelivery({
        canSend: false,
        status: 'verification_required',
        scheduledAt: null,
      }),
      ticketItems: [
        makeTicketItem({
          status: 'CANCELLATION_PENDING',
          qrCredential: null,
          cancellation: {
            cancelledAt: '2026-05-08T12:00:00.000Z',
            cancelReason: '단순 변심',
            cancellationFee: 5000,
            serviceFeeRefund: 0,
            refundableAmount: 45000,
            refundStatus: 'PROCESSING_AT_PG',
            reopenState: 'HELD_CANCELLED',
            reopenAt: null,
          },
        }),
      ],
    });

    expect(parsed.qrTicket.status).toBe('REVOKED');
    expect(parsed.qrTicket.token).toBe('');
    expect(parsed.ticketItems[0]?.status).toBe('CANCELLATION_PENDING');

    expect(() =>
      reservationDetailSchema.parse({
        ...parsed,
        qrTicket: {
          ...parsed.qrTicket,
          status: 'ACTIVE',
        },
      }),
    ).toThrow(/QR token/);
  });

  it('accepts pending payment reservation details without completed payment fields', () => {
    const parsed = reservationDetailSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      reservationNumber: 'GRP-24004',
      status: 'PENDING_PAYMENT',
      performanceId: '11111111-1111-4111-8111-000000000301',
      showtimeId: '11111111-1111-4111-8111-000000000302',
      tossOrderId: 'GRP-20260604-7O7YM',
      performanceTitle: 'Girl Rules Fanmeet',
      posterUrl: null,
      showDateTime: '2026-07-18T10:00:00.000Z',
      venue: 'Donghae Arts Center',
      seats: [makeSeat()],
      totalAmount: 50000,
      createdAt: '2026-05-08T11:45:00.000Z',
      paymentMethod: null,
      paidAt: null,
      cancelDeadline: '2026-07-15T14:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
      paymentKey: null,
      paymentInfo: null,
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      refundTimeline: {
        currentState: 'COMPLETED',
        requestedAt: '2026-05-08T11:45:00.000Z',
        customerServiceCtaVisible: false,
      },
      cancelledSeatHold: null,
      qrTicket: {
        token: '',
        jti: '',
        status: 'REVOKED',
        entryStatus: 'NOT_ENTERED',
        enteredAt: null,
        issuedAt: '2026-05-08T11:45:00.000Z',
        emailScheduledAt: null,
        emailedAt: null,
      },
      ticketEmailDelivery: makeTicketEmailDelivery({
        canSend: false,
        status: 'verification_required',
        scheduledAt: null,
      }),
      ticketItems: [],
    });

    expect(parsed.status).toBe('PENDING_PAYMENT');
    expect(parsed.paidAt).toBeNull();
    expect(parsed.paymentKey).toBeNull();
    expect(parsed.paymentInfo).toBeNull();
    expect(parsed.tossOrderId).toBe('GRP-20260604-7O7YM');
  });

  it('accepts reservation detail paymentInfo while keeping legacy payment fields', () => {
    const parsed = reservationDetailSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      reservationNumber: 'GRP-24005',
      status: 'CONFIRMED',
      performanceTitle: 'Girl Rules Fanmeet',
      posterUrl: null,
      showDateTime: '2026-07-18T10:00:00.000Z',
      venue: 'Donghae Arts Center',
      seats: [makeSeat()],
      totalAmount: 50000,
      createdAt: '2026-05-08T11:45:00.000Z',
      paymentMethod: 'CARD',
      paidAt: '2026-05-08T11:46:00.000Z',
      cancelDeadline: '2026-07-15T14:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
      paymentKey: 'payment-key-1',
      paymentInfo: {
        paymentKey: 'payment-key-1',
        method: 'CARD',
        amount: 50000,
        status: 'DONE',
        paidAt: '2026-05-08T11:46:00.000Z',
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
        paymentMethod: {
          method: 'CARD',
          provider: 'CARD',
          currency: 'KRW',
        },
      },
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      refundTimeline: {
        currentState: 'COMPLETED',
        requestedAt: '2026-05-08T12:00:00.000Z',
        completedAt: '2026-05-08T12:01:00.000Z',
        customerServiceCtaVisible: false,
      },
      cancelledSeatHold: null,
      qrTicket: {
        token: 'qr-token-1',
        jti: 'qr-jti-1',
        status: 'ACTIVE',
        entryStatus: 'NOT_ENTERED',
        enteredAt: null,
        issuedAt: '2026-05-08T11:46:00.000Z',
        emailScheduledAt: null,
        emailedAt: null,
      },
      ticketEmailDelivery: makeTicketEmailDelivery(),
      ticketItems: [],
    });

    expect(parsed.paymentMethod).toBe('CARD');
    expect(parsed.paymentKey).toBe('payment-key-1');
    expect(parsed.paymentInfo?.status).toBe('DONE');
    expect(parsed.paymentInfo?.paymentMethod?.provider).toBe('CARD');
  });

  it('validates admin booking funnel stats and operational list/detail fields', () => {
    expect(adminBookingFunnelStatusSchema.options).toEqual([
      'SOLD',
      'PAYMENT_PENDING',
      'PAYMENT_PROCESSING',
      'PAYMENT_FAILED',
      'CANCEL_PROCESSING',
      'CANCELLED',
      'PARTIAL_CANCELLED',
    ]);

    const stats = bookingStatsSchema.parse({
      totalBookings: 7,
      totalRevenue: 150000,
      cancelRate: 14,
      soldCount: 2,
      pendingPaymentCount: 1,
      paymentProcessingCount: 1,
      failedCount: 1,
      cancelProcessingCount: 1,
      cancelledCount: 1,
      partialCancelledCount: 1,
      completedRevenue: 150000,
    });

    expect(stats.totalRevenue).toBe(stats.completedRevenue);
    expect(() =>
      bookingStatsSchema.parse({
        ...stats,
        totalRevenue: 149000,
      }),
    ).toThrow(/completedRevenue/);

    const listItem = adminBookingListItemSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      reservationNumber: 'GRP-24006',
      tossOrderId: 'GRP-ORDER-24006',
      userName: '김예매',
      userEmail: 'buyer@example.com',
      userCountry: 'KR',
      performanceTitle: 'Girl Rules Fanmeet',
      showDateTime: '2026-07-18T10:00:00.000Z',
      seats: [makeSeat()],
      totalAmount: 50000,
      status: 'CONFIRMED',
      funnelStatus: 'SOLD',
      paymentStatus: 'DONE',
      paymentMethod: 'CARD',
      ticketStatusCounts: {
        ACTIVE: 1,
        CANCELLATION_PENDING: 0,
        CANCELLED: 0,
        EXPIRED: 0,
      },
      createdAt: '2026-05-08T11:45:00.000Z',
    });

    expect(listItem).not.toHaveProperty('userPhone');
    expect(listItem.tossOrderId).toBe('GRP-ORDER-24006');

    const detail = adminBookingDetailSchema.parse({
      ...listItem,
      userPhone: '+821012345678',
      paymentAttemptedAt: '2026-05-08T11:45:30.000Z',
      paymentCompletedAt: '2026-05-08T11:46:00.000Z',
      paymentInfo: {
        paymentKey: 'payment-key-1',
        method: 'CARD',
        amount: 50000,
        status: 'DONE',
        paidAt: '2026-05-08T11:46:00.000Z',
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      },
      ticketItems: [],
    });

    expect(detail.funnelStatus).toBe('SOLD');
    expect(detail.userPhone).toBe('+821012345678');
    expect(detail.tossOrderId).toBe('GRP-ORDER-24006');
    expect(detail.paymentAttemptedAt).toBe('2026-05-08T11:45:30.000Z');
    expect(detail.paymentCompletedAt).toBe('2026-05-08T11:46:00.000Z');
    expect(detail.ticketStatusCounts.ACTIVE).toBe(1);
  });

  it('validates admin booking list query params before service filtering', () => {
    const parsed = adminBookingListQuerySchema.parse({
      status: 'CONFIRMED',
      reservationStatus: 'PENDING_PAYMENT',
      performanceId: '11111111-1111-4111-8111-000000000301',
      showtimeId: '11111111-1111-4111-8111-000000000302',
      funnelStatus: 'PAYMENT_PENDING',
      paymentStatus: 'READY',
      paymentMethod: 'FOREIGN_EASY_PAY',
      audienceRegion: 'overseas',
      seatTier: 'VIP',
      floorKey: '1F',
      seatQuery: 'A-10',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      search: 'buyer@example.com',
      page: '2',
    });

    expect(parsed).toMatchObject({
      status: 'CONFIRMED',
      reservationStatus: 'PENDING_PAYMENT',
      performanceId: '11111111-1111-4111-8111-000000000301',
      showtimeId: '11111111-1111-4111-8111-000000000302',
      funnelStatus: 'PAYMENT_PENDING',
      paymentStatus: 'READY',
      paymentMethod: 'FOREIGN_EASY_PAY',
      audienceRegion: 'overseas',
      seatTier: 'VIP',
      floorKey: '1F',
      seatQuery: 'A-10',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      search: 'buyer@example.com',
      page: 2,
    });
    expect(adminBookingListQuerySchema.parse({}).page).toBe(1);

    expect(() => adminBookingListQuerySchema.parse({ status: 'UNKNOWN' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ funnelStatus: 'UNKNOWN' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ paymentStatus: 'UNKNOWN' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ paymentMethod: 'UNKNOWN' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ audienceRegion: 'global' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ performanceId: 'performance-1' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ showtimeId: 'showtime-1' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ seatTier: '' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ floorKey: '' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ seatQuery: '' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ dateFrom: '2026-7-1' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ dateFrom: '2026-02-30' })).toThrow();
    expect(() =>
      adminBookingListQuerySchema.parse({
        dateFrom: '2026-07-31',
        dateTo: '2026-07-01',
      }),
    ).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ page: '0' })).toThrow();
    expect(() => adminBookingListQuerySchema.parse({ page: '1.5' })).toThrow();
  });

  it('validates admin booking response tier statistics', () => {
    const responseSchema = (bookingContracts as typeof bookingContracts & {
      adminBookingListResponseSchema?: {
        parse: (value: unknown) => unknown;
      };
    }).adminBookingListResponseSchema;

    expect(responseSchema).toBeDefined();

    const response = responseSchema?.parse({
      bookings: [],
      total: 0,
      stats: {
        totalBookings: 0,
        totalRevenue: 0,
        cancelRate: 0,
        soldCount: 0,
        pendingPaymentCount: 0,
        paymentProcessingCount: 0,
        failedCount: 0,
        cancelProcessingCount: 0,
        cancelledCount: 0,
        partialCancelledCount: 0,
        completedRevenue: 0,
      },
      tierStats: [
        {
          tierName: 'VIP',
          price: 79000,
          soldSeats: 10,
          activeRevenue: 790000,
          averageTicketAmount: 79000,
          cancelProcessingSeats: 1,
          cancelledSeats: 2,
          enteredSeats: 4,
          totalSeats: 100,
          remainingSeats: 90,
          sellThroughRate: 10,
        },
      ],
    }) as { tierStats?: Array<{ tierName: string; sellThroughRate: number }> };

    expect(response?.tierStats?.[0]).toMatchObject({
      tierName: 'VIP',
      sellThroughRate: 10,
    });
  });

  it('requires ticket email delivery state on reservation detail responses', () => {
    const parsed = reservationDetailSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      reservationNumber: 'GRP-24003',
      status: 'CONFIRMED',
      performanceTitle: 'Girl Rules Fanmeet',
      posterUrl: null,
      showDateTime: '2026-07-18T10:00:00.000Z',
      venue: 'Donghae Arts Center',
      seats: [makeSeat()],
      totalAmount: 50000,
      createdAt: '2026-05-08T11:45:00.000Z',
      paymentMethod: 'CARD',
      paidAt: '2026-05-08T11:46:00.000Z',
      cancelDeadline: '2026-07-15T14:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
      paymentKey: 'payment-key-1',
      paymentInfo: {
        paymentKey: 'payment-key-1',
        method: 'CARD',
        amount: 50000,
        status: 'DONE',
        paidAt: '2026-05-08T11:46:00.000Z',
        paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      },
      queueAdmission: makeQueueAdmission(),
      paymentDeadlineAt: '2026-05-08T11:52:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      refundTimeline: {
        currentState: 'COMPLETED',
        requestedAt: '2026-05-08T12:00:00.000Z',
        completedAt: '2026-05-08T12:01:00.000Z',
        customerServiceCtaVisible: false,
      },
      cancelledSeatHold: null,
      qrTicket: {
        token: 'qr-token-1',
        jti: 'qr-jti-1',
        status: 'ACTIVE',
        entryStatus: 'NOT_ENTERED',
        enteredAt: null,
        issuedAt: '2026-05-08T11:46:00.000Z',
        emailScheduledAt: '2026-07-17T10:00:00.000Z',
        emailedAt: '2026-07-17T10:01:00.000Z',
      },
      ticketEmailDelivery: makeTicketEmailDelivery({
        lastSentAt: '2026-07-17T10:01:00.000Z',
        status: 'sent',
      }),
      ticketItems: [],
    });

    expect(parsed.ticketEmailDelivery).toEqual({
      email: 'buyer@example.com',
      isEmailVerified: true,
      isPlaceholderEmail: false,
      canSend: true,
      status: 'sent',
      scheduledAt: '2026-07-17T10:00:00.000Z',
      lastSentAt: '2026-07-17T10:01:00.000Z',
    });
  });
});
