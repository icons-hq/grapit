import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  isTossCancelCompleted,
  RefundService,
} from './refund.service.js';

function createRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    status: 'requested',
    provider: 'toss_payments',
    providerRefundKey: null,
    resultCode: 'REQUESTED',
    resultMessage: 'Refund requested by user',
    failureReason: null,
    providerMetadata: {},
    retryCount: 0,
    customerServiceCtaVisible: false,
    requestedAt: new Date('2026-05-08T03:00:00.000Z'),
    sentToPgAt: null,
    processingAtPgAt: null,
    completedAt: null,
    failedAt: null,
    expectedDepositAt: new Date('2026-05-11T03:00:00.000Z'),
    createdAt: new Date('2026-05-08T03:00:00.000Z'),
    updatedAt: new Date('2026-05-08T03:00:00.000Z'),
    ...overrides,
  };
}

function createContext() {
  return {
    reservation: {
      id: 'reservation-1',
      reservationNumber: 'GRP-20260508-ABCDE',
      status: 'CONFIRMED',
      showtimeId: 'showtime-1',
      totalAmount: 132000,
      cancelDeadline: new Date('2099-05-14T10:00:00.000Z'),
      createdAt: new Date('2026-07-01T03:00:00.000Z'),
    },
    payment: {
      id: 'payment-1',
      paymentKey: 'pay-key-1',
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
      amount: 132000,
      providerMetadata: null,
      providerChargeCurrency: null,
      providerChargeAmountMinor: null,
    },
    showtime: {
      id: 'showtime-1',
      performanceId: 'performance-1',
      dateTime: new Date('2099-05-15T10:00:00.000Z'),
    },
    bookingPolicy: {
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
    },
    seats: [{ seatId: '1F:A-10' }],
    ticketItems: [
      {
        id: 'ticket-item-1',
        seatId: '1F:A-10',
        seatKey: '1F:A-10',
        price: 130000,
        serviceFee: 2000,
        status: 'active',
        admissionState: 'not_entered',
      },
    ],
  };
}

function createSeatLevelContext() {
  const context = createContext();

  return {
    ...context,
    payment: {
      ...context.payment,
      amount: 204000,
    },
    reservation: {
      ...context.reservation,
      totalAmount: 204000,
      createdAt: new Date('2026-07-01T03:00:00.000Z'),
    },
    showtime: {
      ...context.showtime,
      dateTime: new Date('2026-07-18T10:00:00.000Z'),
    },
    seats: [{ seatId: '1F:A-10' }, { seatId: '1F:A-11' }],
    ticketItems: [
      {
        id: 'ticket-item-1',
        seatId: '1F:A-10',
        seatKey: '1F:A-10',
        price: 100000,
        serviceFee: 2000,
        status: 'active',
        admissionState: 'not_entered',
      },
      {
        id: 'ticket-item-2',
        seatId: '1F:A-11',
        seatKey: '1F:A-11',
        price: 100000,
        serviceFee: 2000,
        status: 'active',
        admissionState: 'not_entered',
      },
    ],
  };
}

describe('RefundService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T05:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('treats only CANCELED Toss responses as completed refund cancels', () => {
    expect(isTossCancelCompleted({ status: 'CANCELED' } as never)).toBe(true);
    expect(isTossCancelCompleted({ status: 'DONE' } as never)).toBe(false);
    expect(isTossCancelCompleted({ status: 'PARTIAL_CANCELED' } as never)).toBe(false);
    expect(isTossCancelCompleted({
      status: 'CANCELED',
      cancels: [{
        cancelAmount: 132000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'IN_PROGRESS',
        cancelRequestId: 'cancel_refund-1',
      }],
    } as never, 'cancel_refund-1')).toBe(false);
    expect(isTossCancelCompleted({
      status: 'DONE',
      cancels: [{
        cancelAmount: 132000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      }],
    } as never, 'cancel_refund-1')).toBe(false);
    expect(isTossCancelCompleted({
      status: 'CANCELED',
      cancels: [{
        cancelAmount: 132000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      }],
    } as never, 'cancel_refund-1')).toBe(true);
    expect(isTossCancelCompleted({
      status: 'PARTIAL_CANCELED',
      cancels: [{
        cancelAmount: 70000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
      }],
    } as never, undefined, { allowPartialStatus: true })).toBe(false);
    expect(isTossCancelCompleted({
      status: 'PARTIAL_CANCELED',
      cancels: [{
        cancelAmount: 69000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
      }],
    } as never, undefined, {
      allowPartialStatus: true,
      expectedCancelAmount: 70000,
      allowUnidentifiedPartialCancel: true,
    })).toBe(false);
    expect(isTossCancelCompleted({
      status: 'PARTIAL_CANCELED',
      cancels: [{
        cancelAmount: 70000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
      }],
    } as never, undefined, {
      allowPartialStatus: true,
      expectedCancelAmount: 70000,
      allowUnidentifiedPartialCancel: true,
    })).toBe(true);
  });

  it('matches provider-currency partial cancels without requiring per-cancel currency', () => {
    expect(isTossCancelCompleted({
      status: 'PARTIAL_CANCELED',
      cancels: [{
        cancelAmount: 99.05,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
      }],
    } as never, undefined, {
      allowPartialStatus: true,
      expectedCancelAmount: 99.05,
      expectedCurrency: 'USD',
      allowUnidentifiedPartialCancel: true,
    })).toBe(true);
  });

  it('returns existing refund state for duplicate requests without calling Toss again', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn(),
    };

    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const existingRefund = createRefund({
      status: 'processing_at_pg',
      sentToPgAt: new Date('2026-05-08T03:05:00.000Z'),
      processingAtPgAt: new Date('2026-05-08T03:05:00.000Z'),
      resultCode: 'IN_PROGRESS',
      providerMetadata: {
        refundCancelRetry: {
          status: 'scheduled',
          jobId: 'job-refund-retry-existing',
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(existingRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(pgBoss.send).not.toHaveBeenCalled();
    expect(result.idempotent).toBe(true);
    expect(result.retryEnqueued).toBe(true);
    expect(result.refundTimeline?.currentState).toBe('PROCESSING_AT_PG');
  });

  it('reattempts retry enqueue for duplicate non-terminal refunds without a stored retry job', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn(),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const existingRefund = createRefund({
      status: 'sent_to_pg',
      sentToPgAt: new Date('2026-05-08T03:05:00.000Z'),
      resultCode: 'INTERNAL_SERVER_ERROR',
      providerMetadata: { cancelReason: '단순 변심' },
    });
    const scheduledRefund = createRefund({
      ...existingRefund,
      providerMetadata: {
        cancelReason: '단순 변심',
        refundCancelRetry: {
          status: 'scheduled',
          jobId: 'job-refund-retry-reattempt',
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(existingRefund as never);
    const retrySpy = vi
      .spyOn(service as never, 'scheduleRefundCancelRetry')
      .mockResolvedValue('job-refund-retry-reattempt' as never);
    const recordScheduleSpy = vi
      .spyOn(service as never, 'recordRefundCancelRetrySchedule')
      .mockResolvedValue(scheduledRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(retrySpy).toHaveBeenCalledWith(existingRefund.id, existingRefund.retryCount);
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      existingRefund,
      'job-refund-retry-reattempt',
    );
    expect(result.idempotent).toBe(true);
    expect(result.retryEnqueued).toBe(true);
  });

  it('rejects new user refund requests after the cancellation deadline before calling Toss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T10:00:00.001Z'));

    try {
      const tossPaymentsClient = {
        cancelPayment: vi.fn(),
      };
      const service = new RefundService(
        {} as never,
        tossPaymentsClient as never,
        { finalizeFullPaymentCancellation: vi.fn() } as never,
        { isAvailable: true, send: vi.fn() } as never,
      );
      const context = createContext();
      context.reservation.cancelDeadline = new Date('2026-05-14T10:00:00.000Z');
      const insertRequestedRefundSpy = vi.spyOn(service as never, 'insertRequestedRefund');

      vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
      vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

      await expect(
        service.requestRefund('reservation-1', 'user-1', '단순 변심'),
      ).rejects.toThrow('취소 마감시간이 지났습니다');
      expect(insertRequestedRefundSpy).not.toHaveBeenCalled();
      expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('previews full-reservation cancellation with per-ticket D-2 fees', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T00:10:00.000+09:00'));

    try {
      const service = new RefundService(
        {} as never,
        { cancelPayment: vi.fn() } as never,
        { finalizeFullPaymentCancellation: vi.fn() } as never,
        { isAvailable: false, send: vi.fn() } as never,
      );
      const context = createSeatLevelContext();

      vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
      vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

      const result = await service.getRefundPreview('reservation-1', 'user-1');

      expect(result.refundableAmount).toBe(140000);
      expect(result.cancellationQuote).toMatchObject({
        originalPaymentAmount: 204000,
        ticketSubtotal: 200000,
        ticketServiceFeeTotal: 4000,
        cancellationFeeTotal: 60000,
        serviceFeeRefundTotal: 0,
        refundableAmount: 140000,
        policyCodes: ['SHOW_DAY_2_TO_1'],
      });
      expect(result.cancellationQuote?.items).toEqual([
        expect.objectContaining({
          ticketItemId: 'ticket-item-1',
          ticketPrice: 100000,
          serviceFee: 2000,
          cancellationFee: 30000,
          serviceFeeRefund: 0,
          refundableAmount: 70000,
          policyCode: 'SHOW_DAY_2_TO_1',
        }),
        expect.objectContaining({
          ticketItemId: 'ticket-item-2',
          ticketPrice: 100000,
          serviceFee: 2000,
          cancellationFee: 30000,
          serviceFeeRefund: 0,
          refundableAmount: 70000,
          policyCode: 'SHOW_DAY_2_TO_1',
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

	  it('backfills missing ticket items before quote calculation for confirmed reservations', async () => {
    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const legacyContext = {
      ...context,
      ticketItems: [],
    };
    const backfillSpy = vi.fn().mockResolvedValue(context);

    Object.assign(service, {
      ensureTicketItemsAvailableForQuote: backfillSpy,
    });
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(legacyContext as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    await service.getRefundPreview('reservation-1', 'user-1');

	    expect(backfillSpy).toHaveBeenCalledWith(legacyContext);
	  });

  it('backfills only uncovered reservation seats before quote calculation', async () => {
    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const partialContext = {
      ...context,
      ticketItems: [context.ticketItems[0]!],
    };
    const backfillSpy = vi
      .spyOn(service as never, 'backfillMissingTicketItems')
      .mockResolvedValue(undefined as never);
    vi.spyOn(service as never, 'loadTicketItemsForReservation')
      .mockResolvedValue(context.ticketItems as never);

    const result = await (service as never as {
      ensureTicketItemsAvailableForQuote(input: typeof partialContext): Promise<typeof context>;
    }).ensureTicketItemsAvailableForQuote(partialContext);

    expect(backfillSpy).toHaveBeenCalledWith(partialContext, [context.seats[1]]);
    expect(result.ticketItems).toHaveLength(2);
  });

  it('does not backfill seats that already have cancelled ticket item history', async () => {
    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const mixedContext = {
      ...context,
      ticketItems: [
        context.ticketItems[0]!,
        {
          ...context.ticketItems[1]!,
          status: 'cancelled',
        },
      ],
    };
    const backfillSpy = vi
      .spyOn(service as never, 'backfillMissingTicketItems')
      .mockResolvedValue(undefined as never);
    vi.spyOn(service as never, 'loadTicketItemsForReservation')
      .mockResolvedValue(mixedContext.ticketItems as never);

    await expect((service as never as {
      ensureTicketItemsAvailableForQuote(input: typeof mixedContext): Promise<typeof mixedContext>;
    }).ensureTicketItemsAvailableForQuote(mixedContext)).resolves.toEqual(mixedContext);

    expect(backfillSpy).not.toHaveBeenCalled();
  });

  it('quotes only active ticket items when a reservation has cancelled ticket item history', async () => {
    vi.setSystemTime(new Date('2026-07-16T00:10:00.000+09:00'));

    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const mixedContext = {
      ...context,
      ticketItems: [
        context.ticketItems[0]!,
        {
          ...context.ticketItems[1]!,
          status: 'cancelled',
        },
      ],
    };

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(mixedContext as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'ensureTicketItemsAvailableForQuote')
      .mockResolvedValue(mixedContext as never);

    const result = await service.getRefundPreview('reservation-1', 'user-1');

    expect(result.cancellationQuote).toMatchObject({
      ticketSubtotal: 100000,
      ticketServiceFeeTotal: 2000,
      cancellationFeeTotal: 30000,
      serviceFeeRefundTotal: 0,
      refundableAmount: 70000,
    });
    expect(result.cancellationQuote?.items).toEqual([
      expect.objectContaining({ ticketItemId: 'ticket-item-1' }),
    ]);
  });

  it('fails before provider cancel when active ticket item coverage is still incomplete', async () => {
    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const partialContext = {
      ...context,
      ticketItems: [context.ticketItems[0]!],
    };
    vi.spyOn(service as never, 'backfillMissingTicketItems')
      .mockResolvedValue(undefined as never);
    vi.spyOn(service as never, 'loadTicketItemsForReservation')
      .mockResolvedValue(partialContext.ticketItems as never);

    await expect(
      (service as never as {
        ensureTicketItemsAvailableForQuote(input: typeof partialContext): Promise<typeof context>;
      }).ensureTicketItemsAvailableForQuote(partialContext),
    ).rejects.toThrow('취소 수수료 계산에 필요한 티켓 정보가 모든 좌석을 포함하지 않습니다');
  });

  it('marks legacy backfilled ticket items as entered when legacy entry evidence exists', async () => {
    const insertChain: {
      values: ReturnType<typeof vi.fn>;
      onConflictDoNothing: ReturnType<typeof vi.fn>;
    } = {
      values: vi.fn(),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
    insertChain.values.mockReturnValue(insertChain);
    const service = new RefundService(
      { insert: vi.fn(() => insertChain) } as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    vi.spyOn(service as never, 'hasLegacyEntryEvidence')
      .mockResolvedValue(true as never);

    await (service as never as {
      backfillMissingTicketItems(input: typeof context, seats: typeof context.seats): Promise<void>;
    }).backfillMissingTicketItems(context, [context.seats[1]!]);

    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        seatId: 'A-11',
        seatKey: '1F:A-11',
        admissionState: 'entered',
        enteredAt: expect.any(Date),
      }),
    ]);
  });

  it('returns null cancellationQuote for existing legacy refunds without recalculating a quote', () => {
    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const existingRefund = createRefund({ providerMetadata: {} });

    const result = (service as never as {
      buildPreview(input: typeof context, refund: ReturnType<typeof createRefund>): {
        canRequestRefund: boolean;
        cancellationQuote: unknown;
      };
    }).buildPreview(context, existingRefund);

    expect(result.canRequestRefund).toBe(false);
    expect(result.cancellationQuote).toBeNull();
  });

  it('sends fee-bearing full-reservation cancellations as provider partial cancels', async () => {
    vi.setSystemTime(new Date('2026-07-16T00:10:00.000+09:00'));

    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        totalAmount: 204000,
        status: 'PARTIAL_CANCELED',
        cancels: [
          {
            cancelAmount: 140000,
            cancelReason: '일정 변경',
            canceledAt: '2026-07-16T00:11:00+09:00',
            cancelStatus: 'DONE',
          },
        ],
      }),
    };
    const finalizer = {
      finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
        releaseJobId: 'release-job-1',
        releaseEnqueued: true,
      }),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const requestedRefund = createRefund();
    const completedRefund = createRefund({
      status: 'completed',
      resultCode: 'PARTIAL_CANCELED',
      resultMessage: 'PG cancel completed',
      providerMetadata: {
        cancellationQuote: {
          originalPaymentAmount: 204000,
          ticketSubtotal: 200000,
          ticketServiceFeeTotal: 4000,
          cancellationFeeTotal: 60000,
          serviceFeeRefundTotal: 0,
          refundableAmount: 140000,
          policyCodes: ['SHOW_DAY_2_TO_1'],
          items: [
            {
              ticketItemId: 'ticket-item-1',
              ticketPrice: 100000,
              serviceFee: 2000,
              cancellationFee: 30000,
              serviceFeeRefund: 0,
              refundableAmount: 70000,
              policyCode: 'SHOW_DAY_2_TO_1',
            },
            {
              ticketItemId: 'ticket-item-2',
              ticketPrice: 100000,
              serviceFee: 2000,
              cancellationFee: 30000,
              serviceFeeRefund: 0,
              refundableAmount: 70000,
              policyCode: 'SHOW_DAY_2_TO_1',
            },
          ],
        },
      },
      completedAt: new Date('2026-07-15T15:11:00.000Z'),
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(completedRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '일정 변경');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '일정 변경', {
      cancelAmount: 140000,
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        fullReservationCancellationQuote: expect.objectContaining({
          cancellationFeeTotal: 60000,
          refundableAmount: 140000,
        }),
      }),
    );
    expect(result.refundableAmount).toBe(140000);
  });

  it('blocks entered tickets unless an admin force-cancel override is used', async () => {
    const service = new RefundService(
      {} as never,
      { cancelPayment: vi.fn() } as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    context.ticketItems = context.ticketItems.map((item) => ({
      ...item,
      admissionState: 'entered',
    }));

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    await expect(
      service.requestRefund('reservation-1', 'user-1', '테스트 입장 후 취소'),
    ).rejects.toThrow('입장 처리된 티켓은 관리자 강제 취소로만 취소할 수 있습니다');
  });

  it('lets admins force-cancel entered tickets with a full-refund override', async () => {
    vi.setSystemTime(new Date('2026-07-16T00:10:00.000+09:00'));

    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        totalAmount: 204000,
        status: 'CANCELED',
        cancels: [
          {
            cancelAmount: 204000,
            cancelReason: '테스트 입장 강제 취소',
            canceledAt: '2026-07-16T00:11:00+09:00',
            cancelStatus: 'DONE',
          },
        ],
      }),
    };
    const finalizer = {
      finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
        releaseJobId: 'release-job-1',
        releaseEnqueued: true,
      }),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    context.ticketItems = context.ticketItems.map((item) => ({
      ...item,
      admissionState: 'entered',
    }));
    const requestedRefund = createRefund();
    const completedRefund = createRefund({
      status: 'completed',
      providerMetadata: {
        cancellationQuote: {
          originalPaymentAmount: 204000,
          ticketSubtotal: 200000,
          ticketServiceFeeTotal: 4000,
          cancellationFeeTotal: 0,
          serviceFeeRefundTotal: 4000,
          refundableAmount: 204000,
          policyCodes: ['ADMIN_FULL_REFUND_OVERRIDE'],
          items: [
            {
              ticketItemId: 'ticket-item-1',
              ticketPrice: 100000,
              serviceFee: 2000,
              cancellationFee: 0,
              serviceFeeRefund: 2000,
              refundableAmount: 102000,
              policyCode: 'ADMIN_FULL_REFUND_OVERRIDE',
            },
            {
              ticketItemId: 'ticket-item-2',
              ticketPrice: 100000,
              serviceFee: 2000,
              cancellationFee: 0,
              serviceFeeRefund: 2000,
              refundableAmount: 102000,
              policyCode: 'ADMIN_FULL_REFUND_OVERRIDE',
            },
          ],
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(completedRefund as never);

    const result = await service.requestAdminRefund(
      'reservation-1',
      'admin-1',
      '테스트 입장 강제 취소',
      {
        fullRefundOverride: true,
        enteredTicketOverride: true,
      },
    );

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith(
      'pay-key-1',
      '테스트 입장 강제 취소',
      {
        idempotencyKey: 'refund-cancel:refund-1',
        secretKeyScope: 'default',
      },
    );
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: 'admin', operatorUserId: 'admin-1' },
        fullReservationCancellationQuote: expect.objectContaining({
          cancellationFeeTotal: 0,
          serviceFeeRefundTotal: 4000,
          refundableAmount: 204000,
          policyCodes: ['ADMIN_FULL_REFUND_OVERRIDE'],
        }),
      }),
    );
    expect(result.refundableAmount).toBe(204000);
  });

  it('persists sent_to_pg and enqueues refund-cancel-retry on transient Toss cancel failure', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi
        .fn()
        .mockRejectedValue(
          new TossPaymentError('INTERNAL_SERVER_ERROR', 'temporary 5xx from provider'),
        ),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockResolvedValue('job-refund-retry-1'),
    };

    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const requestedRefund = createRefund();
    const retryableRefund = createRefund({
      status: 'sent_to_pg',
      sentToPgAt: new Date('2026-05-08T03:06:00.000Z'),
      resultCode: 'INTERNAL_SERVER_ERROR',
      resultMessage: 'temporary 5xx from provider',
      failureReason: 'temporary 5xx from provider',
    });
    const scheduledRefund = createRefund({
      ...retryableRefund,
      providerMetadata: {
        cancelReason: '단순 변심',
        refundCancelRetry: {
          status: 'scheduled',
          jobId: 'job-refund-retry-1',
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'markRefundSentToPg').mockResolvedValue(retryableRefund as never);
    const retrySpy = vi
      .spyOn(service as never, 'scheduleRefundCancelRetry')
      .mockResolvedValue('job-refund-retry-1' as never);
    const recordScheduleSpy = vi
      .spyOn(service as never, 'recordRefundCancelRetrySchedule')
      .mockResolvedValue(scheduledRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(retrySpy).toHaveBeenCalledWith(requestedRefund.id, requestedRefund.retryCount);
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      retryableRefund,
      'job-refund-retry-1',
    );
    expect(result.idempotent).toBe(false);
    expect(result.retryEnqueued).toBe(true);
    expect(result.refundTimeline?.currentState).toBe('SENT_TO_PG');
  });

  it('keeps a provider-processing refund non-terminal when retry enqueue fails', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        status: 'IN_PROGRESS',
      }),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockRejectedValue(new Error('Queue refund-cancel-retry does not exist')),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const requestedRefund = createRefund();
    const processingRefund = createRefund({
      status: 'processing_at_pg',
      processingAtPgAt: new Date('2026-05-08T03:06:00.000Z'),
      resultCode: 'IN_PROGRESS',
    });
    const scheduleFailedRefund = createRefund({
      ...processingRefund,
      customerServiceCtaVisible: true,
      providerMetadata: {
        cancelReason: '단순 변심',
        paymentStatus: 'IN_PROGRESS',
        refundCancelRetry: {
          status: 'schedule_failed',
          jobId: null,
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'markRefundProcessing').mockResolvedValue(processingRefund as never);
    const recordScheduleSpy = vi
      .spyOn(service as never, 'recordRefundCancelRetrySchedule')
      .mockResolvedValue(scheduleFailedRefund as never);
    const failedSpy = vi.spyOn(service as never, 'markRefundFailed');

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(pgBoss.send).toHaveBeenCalled();
    expect(recordScheduleSpy).toHaveBeenCalledWith(processingRefund, null);
    expect(failedSpy).not.toHaveBeenCalled();
    expect(result.retryEnqueued).toBe(false);
    expect(result.refundTimeline?.currentState).toBe('PROCESSING_AT_PG');
  });

  it('uses policy-built Alipay full-cancel options and finalizes through the shared finalizer', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'CANCELED',
        approvedAt: '2026-05-08T12:00:00+09:00',
        cancels: [
          {
            cancelAmount: 132000,
            cancelReason: '단순 변심',
            canceledAt: '2026-05-08T12:05:00+09:00',
            cancelStatus: 'DONE',
            cancelRequestId: 'cancel_refund-1',
          },
        ],
      }),
    };
    const finalizer = {
      finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
        releaseJobId: 'release-job-1',
        releaseEnqueued: true,
      }),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createContext();
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';
    const requestedRefund = createRefund();
    const completedRefund = createRefund({
      status: 'completed',
      resultCode: 'CANCELED',
      resultMessage: 'PG cancel completed',
      completedAt: new Date('2026-05-08T03:10:00.000Z'),
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(completedRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'foreign-easy-pay',
      cancelRequestId: 'cancel_refund-1',
    });
    expect(tossPaymentsClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty(
      'cancelAmount',
    );
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'refund_request',
        refundId: 'refund-1',
        context: expect.objectContaining({
          reservation: expect.objectContaining({
            id: 'reservation-1',
            showtimeId: 'showtime-1',
          }),
          payment: expect.objectContaining({
            id: 'payment-1',
            paymentKey: 'pay-key-1',
          }),
          seats: [{ seatId: '1F:A-10' }],
        }),
        fullReservationCancellationQuote: expect.objectContaining({
          refundableAmount: 132000,
        }),
        reason: '단순 변심',
        providerResponse: expect.objectContaining({ status: 'CANCELED' }),
        actor: { kind: 'user' },
      }),
    );
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });

  it('rejects unsupported TRUEMONEY fee-bearing full-reservation cancels before creating a refund row', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn(),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'TRUEMONEY';
    context.payment.currency = 'THB';
    context.payment.providerChargeCurrency = null;
    context.payment.providerChargeAmountMinor = null;
    context.reservation.createdAt = new Date('2026-06-20T03:00:00.000Z');
    context.showtime.dateTime = new Date('2026-07-03T10:00:00.000Z');
    const insertRequestedRefundSpy = vi.spyOn(service as never, 'insertRequestedRefund');

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    await expect(service.requestRefund('reservation-1', 'user-1', '단순 변심'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(insertRequestedRefundSpy).not.toHaveBeenCalled();
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('finalizes a full refund cancellation for seat-level reservations', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        totalAmount: 204000,
        status: 'CANCELED',
      }),
    };
    const finalizer = {
      finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
        releaseJobId: 'release-job-1',
        releaseEnqueued: true,
      }),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createSeatLevelContext();
    const requestedRefund = createRefund();
    const completedRefund = createRefund({
      status: 'completed',
      resultCode: 'CANCELED',
      resultMessage: 'PG cancel completed',
      completedAt: new Date('2026-05-08T03:10:00.000Z'),
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(completedRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '일정 변경');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '일정 변경', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(tossPaymentsClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty(
      'cancelAmount',
    );
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'refund_request',
        refundId: 'refund-1',
        context: expect.objectContaining({
          seats: [{ seatId: '1F:A-10' }, { seatId: '1F:A-11' }],
        }),
        reason: '일정 변경',
      }),
    );
    expect(result.refundableAmount).toBe(204000);
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });
});
