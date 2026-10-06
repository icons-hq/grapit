import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  buildRefundCancelRetrySchedule,
  getRefundErrorCode,
  isDefiniteRefundCancelRejection,
  isTransientRefundCancelFailure,
  REFUND_CANCEL_POST_WINDOW_MS,
  REFUND_RETRY_WINDOW_EXPIRED_CODE,
  resolveBookingConfirmedAt,
  RefundService,
} from './refund.service.js';

const QUOTE = {
  originalPaymentAmount: 204000,
  ticketSubtotal: 200000,
  ticketServiceFeeTotal: 4000,
  cancellationFeeTotal: 0,
  serviceFeeRefundTotal: 0,
  refundableAmount: 200000,
  policyCodes: ['WITHIN_7_DAYS_AFTER_BOOKING'],
  items: [
    { ticketItemId: 'ticket-item-1', ticketPrice: 100000, serviceFee: 2000, cancellationFee: 0,
      serviceFeeRefund: 0, refundableAmount: 100000, policyCode: 'WITHIN_7_DAYS_AFTER_BOOKING' },
    { ticketItemId: 'ticket-item-2', ticketPrice: 100000, serviceFee: 2000, cancellationFee: 0,
      serviceFeeRefund: 0, refundableAmount: 100000, policyCode: 'WITHIN_7_DAYS_AFTER_BOOKING' },
  ],
};

const FROZEN_COMMAND = {
  paymentKey: 'pay-key-1',
  reason: '단순 변심 [refund-1]',
  options: { idempotencyKey: 'refund-cancel:refund-1', secretKeyScope: 'default', cancelAmount: 200000 },
};

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
    providerMetadata: {
      cancelReason: '단순 변심',
      cancelRequest: FROZEN_COMMAND,
      providerRefund: { currency: 'KRW', amountMinor: 200000, amountDecimal: '200000',
        originalAmountMinor: 204000, balanceBeforeMinor: 204000 },
      cancellationQuote: QUOTE,
      credentialStates: [],
    },
    retryCount: 0,
    customerServiceCtaVisible: false,
    requestedAt: new Date('2026-07-05T03:00:00.000Z'),
    sentToPgAt: null,
    processingAtPgAt: null,
    completedAt: null,
    failedAt: null,
    expectedDepositAt: null,
    createdAt: new Date('2026-07-05T03:00:00.000Z'),
    updatedAt: new Date('2026-07-05T03:00:00.000Z'),
    ...overrides,
  };
}

function createContext(overrides: { itemStatus?: string; price?: number; cancelDeadline?: Date; showtimeAt?: Date } = {}) {
  const price = overrides.price ?? 100000;
  const amount = (price + 2000) * 2;
  return {
    reservation: {
      id: 'reservation-1',
      reservationNumber: 'GRP-20260701-ABCDE',
      status: 'CONFIRMED',
      showtimeId: 'showtime-1',
      totalAmount: amount,
      cancelDeadline: overrides.cancelDeadline ?? new Date('2026-07-17T14:59:59.999Z'),
      createdAt: new Date('2026-07-01T03:00:00.000Z'),
    },
    payment: {
      id: 'payment-1',
      paymentKey: 'pay-key-1',
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
      amount,
      providerMetadata: null,
      providerChargeCurrency: null,
      providerChargeAmountMinor: null,
      paidAt: new Date('2026-07-01T03:01:00.000Z'),
    },
    showtime: {
      id: 'showtime-1',
      performanceId: 'performance-1',
      dateTime: overrides.showtimeAt ?? new Date('2026-07-18T10:00:00.000Z'),
    },
    bookingPolicy: null,
    seats: [
      { id: 'seat-1', reservationId: 'reservation-1', seatId: '1F:A-10', tierName: 'VIP', price, row: 'A', number: '10' },
      { id: 'seat-2', reservationId: 'reservation-1', seatId: '1F:A-11', tierName: 'VIP', price, row: 'A', number: '11' },
    ],
    ticketItems: ['1F:A-10', '1F:A-11'].map((seatKey, index) => ({
      id: `ticket-item-${index + 1}`,
      seatId: seatKey,
      seatKey,
      price,
      serviceFee: 2000,
      status: overrides.itemStatus ?? 'active',
      admissionState: 'not_entered',
      refundableAmount: 0,
      cancellationCommand: null,
    })),
  };
}

function createService(provider: Record<string, unknown>, finalizer = { finalizeFullPaymentCancellation: vi.fn() }) {
  const pgBoss = { isAvailable: true, send: vi.fn().mockResolvedValue('refund-retry-job') };
  const service = new RefundService({} as never, provider as never, finalizer as never, pgBoss as never);
  return { service, pgBoss, finalizer };
}

describe('RefundService provider failure classification (audit #22)', () => {
  it.each([
    'FAILED_INTERNAL_SYSTEM_PROCESSING',
    'FAILED_REFUND_PROCESS',
    'FAILED_METHOD_HANDLING_CANCEL',
    'FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING',
    'COMMON_ERROR',
    'UNKNOWN_ERROR',
    'FORBIDDEN_CONSECUTIVE_REQUEST',
    'ALREADY_REFUNDING_PAYMENT',
    'A_CODE_ADDED_LATER',
  ])('keeps Toss %s retryable', (code) => {
    expect(isTransientRefundCancelFailure(new TossPaymentError(code, 'provider error'))).toBe(true);
    expect(isDefiniteRefundCancelRejection(new TossPaymentError(code, 'provider error'))).toBe(false);
  });

  it('keeps a non-JSON gateway page retryable and labels it', () => {
    const error = new SyntaxError('Unexpected token \'<\', "<html>" is not valid JSON');
    expect(isTransientRefundCancelFailure(error)).toBe(true);
    expect(getRefundErrorCode(error)).toBe('INVALID_PROVIDER_RESPONSE');
  });

  it.each(['NOT_CANCELABLE_PAYMENT', 'INVALID_REQUEST', 'EXCEED_MAX_REFUND_DUE', 'REFUND_REJECTED'])(
    'treats %s as a definite rejection',
    (code) => {
      expect(isDefiniteRefundCancelRejection(new TossPaymentError(code, 'rejected'))).toBe(true);
      expect(isTransientRefundCancelFailure(new TossPaymentError(code, 'rejected'))).toBe(false);
    },
  );

  it('raises attention after repeated unresolved attempts but never while the provider is processing the cancel', () => {
    const now = new Date('2026-07-05T03:00:00.000Z');
    expect(buildRefundCancelRetrySchedule('job', 5, now)).toMatchObject({
      metadata: { manualReviewRequired: true }, customerServiceCtaVisible: true });
    const awaiting = buildRefundCancelRetrySchedule('job', 5, now, { awaitingProvider: true });
    expect(awaiting).toMatchObject({ metadata: { manualReviewRequired: false }, customerServiceCtaVisible: false });
    expect(buildRefundCancelRetrySchedule(null, 5, now, { awaitingProvider: true }).customerServiceCtaVisible).toBe(true);
  });

  it('never treats local preflight decisions as retryable', () => {
    expect(isTransientRefundCancelFailure(new TossPaymentError('BALANCE_RECONCILIATION_REQUIRED', 'x'))).toBe(false);
    expect(isTransientRefundCancelFailure(new TossPaymentError('NOT_PARTIAL_CANCELABLE', 'x'))).toBe(false);
    expect(isTransientRefundCancelFailure(new TossPaymentError(REFUND_RETRY_WINDOW_EXPIRED_CODE, 'x'))).toBe(false);
    expect(REFUND_RETRY_WINDOW_EXPIRED_CODE).toBe('REFUND_RETRY_WINDOW_EXPIRED');
  });
});

describe('RefundService request-path recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-05T03:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['a Toss 5xx code', new TossPaymentError('FAILED_INTERNAL_SYSTEM_PROCESSING', '내부 시스템 처리 작업이 실패했습니다')],
    ['a non-JSON 502 page', new SyntaxError('Unexpected token \'<\', "<html>" is not valid JSON')],
  ])('keeps the refund non-terminal and schedules a retry after %s (audit #22)', async (_label, error) => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn().mockRejectedValue(error),
    };
    const { service, pgBoss } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(createContext() as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(createRefund() as never);
    const sentToPg = createRefund({ status: 'sent_to_pg' });
    const sentSpy = vi.spyOn(service as never, 'markRefundSentToPg').mockResolvedValue(sentToPg as never);
    vi.spyOn(service as never, 'recordRefundCancelRetrySchedule').mockResolvedValue(sentToPg as never);
    const failedSpy = vi.spyOn(service as never, 'markRefundFailed');

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(sentSpy).toHaveBeenCalled();
    expect(failedSpy).not.toHaveBeenCalled();
    expect(pgBoss.send).toHaveBeenCalledWith('refund-cancel-retry', { refundId: 'refund-1', attempt: 1 }, expect.any(Object));
    expect(result.refundTimeline?.currentState).toBe('SENT_TO_PG');
  });

  it('keeps a definite rejection retryable when the follow-up provider query fails instead of failing it', async () => {
    const provider = {
      queryPayment: vi.fn()
        .mockResolvedValueOnce({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] })
        .mockResolvedValueOnce({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] })
        .mockRejectedValue(new Error('fetch failed')),
      cancelPayment: vi.fn().mockRejectedValue(new TossPaymentError('NOT_CANCELABLE_AMOUNT', '취소 할 수 없는 금액 입니다.')),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(createContext() as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(createRefund() as never);
    const sentToPg = createRefund({ status: 'sent_to_pg' });
    const sentSpy = vi.spyOn(service as never, 'markRefundSentToPg').mockResolvedValue(sentToPg as never);
    vi.spyOn(service as never, 'recordRefundCancelRetrySchedule').mockResolvedValue(sentToPg as never);
    const failedSpy = vi.spyOn(service as never, 'markRefundFailed');

    await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(sentSpy).toHaveBeenCalled();
    expect(failedSpy).not.toHaveBeenCalled();
  });

  it('refuses before revoking any right when the provider balance already disagrees with the ledger (audit #80)', async () => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'PARTIAL_CANCELED', currency: 'KRW', totalAmount: 204000,
        balanceAmount: 102000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId').mockResolvedValue(createContext() as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    const insertSpy = vi.spyOn(service as never, 'insertRequestedRefund');

    await expect(service.requestAdminRefund('reservation-1', 'admin-1', '운영 환불'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });

  it('restores revoked rights when the post-commit preflight finds more provider balance than the frozen ledger (audit #80)', async () => {
    const provider = {
      queryPayment: vi.fn()
        .mockResolvedValueOnce({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] })
        .mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(createContext() as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    // The ledger frozen in the refund expects an earlier 102,000 KRW seat refund that the provider never made.
    const requested = createRefund();
    (requested.providerMetadata as Record<string, unknown>).providerRefund = { currency: 'KRW', amountMinor: 100000,
      amountDecimal: '100000', originalAmountMinor: 204000, balanceBeforeMinor: 102000 };
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requested as never);
    const restoreModule = await import('../cancellation/refund-rights-restoration.js');
    const restored = createRefund({ status: 'failed', providerMetadata: { ...requested.providerMetadata, rightsRestoredAt: '2026-07-05T03:00:00.000Z' } });
    const restoreSpy = vi.spyOn(restoreModule, 'restoreRejectedRefundRights').mockResolvedValue(restored as never);
    const failedSpy = vi.spyOn(service as never, 'markRefundFailed');

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(provider.cancelPayment).not.toHaveBeenCalled();
    expect(failedSpy).not.toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalledWith({}, requested, expect.objectContaining({ code: 'BALANCE_RECONCILIATION_REQUIRED' }));
    expect(result.refundTimeline?.currentState).toBe('FAILED');
  });
});

describe('RefundService cancellation window for admin overrides (audit #23)', () => {
  // calculateCancelDeadline stores show date 00:00 KST - 1ms. Show: 2026-07-18 19:00 KST.
  const SHOW_AT = new Date('2026-07-18T10:00:00.000Z');
  const DEADLINE = new Date('2026-07-17T14:59:59.999Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-18T03:00:00.000Z')); // show day, 12:00 KST
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lets an admin full refund override cancel on the show day', async () => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn().mockResolvedValue({ status: 'CANCELED', totalAmount: 204000, balanceAmount: 0,
        cancels: [{ cancelAmount: 204000, cancelReason: '공연 취소 [refund-1]', cancelStatus: 'DONE', canceledAt: '2026-07-18T03:00:01.000Z' }] }),
    };
    const { service, finalizer } = createService(provider);
    const context = createContext({ cancelDeadline: DEADLINE, showtimeAt: SHOW_AT });
    context.ticketItems = context.ticketItems.map((item) => ({ ...item, admissionState: 'entered' }));
    vi.spyOn(service as never, 'loadReservationContextByReservationId').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    const overrideQuote = { ...QUOTE, refundableAmount: 204000, cancellationFeeTotal: 0, serviceFeeRefundTotal: 4000,
      policyCodes: ['ADMIN_FULL_REFUND_OVERRIDE'] };
    const requested = createRefund({ providerMetadata: {
      cancelReason: '공연 취소',
      cancelRequest: { paymentKey: 'pay-key-1', reason: '공연 취소 [refund-1]', options: { idempotencyKey: 'refund-cancel:refund-1', secretKeyScope: 'default' } },
      providerRefund: { currency: 'KRW', amountMinor: 204000, amountDecimal: '204000', originalAmountMinor: 204000, balanceBeforeMinor: 204000 },
      cancellationQuote: overrideQuote,
    } });
    const insertSpy = vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requested as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(createRefund({ status: 'completed' }) as never);

    const result = await service.requestAdminRefund('reservation-1', 'admin-1', '공연 취소', {
      fullRefundOverride: true,
      enteredTicketOverride: true,
    });

    expect(insertSpy).toHaveBeenCalled();
    expect(provider.cancelPayment).toHaveBeenCalled();
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalled();
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });

  it.each([
    ['default admin cancellation', {}],
    ['an entered-ticket override without a full refund override', { enteredTicketOverride: true }],
  ])('still blocks %s after the cancellation window', async (_label, options) => {
    const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ cancelDeadline: DEADLINE, showtimeAt: SHOW_AT }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    await expect(service.requestAdminRefund('reservation-1', 'admin-1', '운영 환불', options))
      .rejects.toThrow('취소 마감 이후 관리자 환불은 수수료 없는 전액 환불(override)로만 처리할 수 있습니다');
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });

  it('still blocks the buyer after the cancellation window', async () => {
    const { service } = createService({ queryPayment: vi.fn(), cancelPayment: vi.fn() });
    vi.spyOn(service as never, 'loadReservationContext')
      .mockResolvedValue(createContext({ cancelDeadline: DEADLINE, showtimeAt: SHOW_AT }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    await expect(service.requestRefund('reservation-1', 'user-1', '단순 변심'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('explains the override requirement in the admin preview instead of failing', async () => {
    const { service } = createService({ queryPayment: vi.fn(), cancelPayment: vi.fn() });
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ cancelDeadline: DEADLINE, showtimeAt: SHOW_AT }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    const blocked = await service.getAdminRefundPreview('reservation-1', {});
    expect(blocked).toMatchObject({ canRequestRefund: false, cancellationQuote: null });
    expect(blocked.blockedReason).toContain('전액 환불(override)');
  });
});

describe('RefundService admin recovery of stuck refunds (audit #53)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-05T05:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function stuckFailedRefund() {
    return createRefund({ status: 'failed', resultCode: 'RETRY_EXHAUSTED', retryCount: 3,
      failedAt: new Date('2026-07-05T03:05:00.000Z'), customerServiceCtaVisible: true });
  }

  it('resumes the same frozen command when the provider balance is untouched', async () => {
    const untouched = { status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] };
    const provider = {
      queryPayment: vi.fn().mockResolvedValue(untouched),
      cancelPayment: vi.fn().mockResolvedValue({ status: 'PARTIAL_CANCELED', totalAmount: 204000, balanceAmount: 4000,
        cancels: [{ cancelAmount: 200000, cancelReason: FROZEN_COMMAND.reason, cancelStatus: 'DONE', canceledAt: '2026-07-05T05:00:01.000Z' }] }),
    };
    const { service, finalizer } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    const reopenSpy = vi.spyOn(service as never, 'reopenFailedRefund')
      .mockResolvedValue(createRefund({ status: 'sent_to_pg', retryCount: 3 }) as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(createRefund({ status: 'completed' }) as never);

    const result = await service.requestAdminRefund('reservation-1', 'admin-1', '재처리');

    expect(reopenSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'refund-1' }), { kind: 'admin', operatorUserId: 'admin-1' }, 'sent_to_pg');
    expect(provider.cancelPayment).toHaveBeenCalledWith('pay-key-1', FROZEN_COMMAND.reason, FROZEN_COMMAND.options);
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalled();
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });

  it('finalizes without another POST when the provider already completed the frozen command', async () => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'PARTIAL_CANCELED', currency: 'KRW', totalAmount: 204000, balanceAmount: 4000,
        cancels: [{ cancelAmount: 200000, cancelReason: FROZEN_COMMAND.reason, cancelStatus: 'DONE', canceledAt: '2026-07-05T03:04:00.000Z' }] }),
      cancelPayment: vi.fn(),
    };
    const { service, finalizer } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(createRefund({ status: 'completed' }) as never);

    await service.requestAdminRefund('reservation-1', 'admin-1', '재처리');

    expect(provider.cancelPayment).not.toHaveBeenCalled();
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(expect.objectContaining({ source: 'refund_retry' }));
  });

  it('restores rights past the idempotency window and stops instead of sending a re-quoted amount the admin did not review', async () => {
    // 16 days after the request: the fee schedule moved on, so a new quote would differ from the stored one.
    vi.setSystemTime(new Date(new Date('2026-07-05T03:00:00.000Z').getTime() + REFUND_CANCEL_POST_WINDOW_MS + 1000));
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const { service, pgBoss } = createService(provider);
    const context = createContext({ itemStatus: 'cancellation_pending', cancelDeadline: new Date('2026-08-30T14:59:59.999Z'), showtimeAt: new Date('2026-08-31T10:00:00.000Z') });
    vi.spyOn(service as never, 'loadReservationContextByReservationId').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    const restoreModule = await import('../cancellation/refund-rights-restoration.js');
    const restored = stuckFailedRefund();
    (restored.providerMetadata as Record<string, unknown>).rightsRestoredAt = new Date().toISOString();
    const restoreSpy = vi.spyOn(restoreModule, 'restoreRejectedRefundRights').mockResolvedValue(restored as never);
    const insertSpy = vi.spyOn(service as never, 'insertRequestedRefund');
    const reopenSpy = vi.spyOn(service as never, 'reopenFailedRefund');

    const request = service.requestAdminRefund('reservation-1', 'admin-1', '재처리');

    await expect(request).rejects.toBeInstanceOf(ConflictException);
    await expect(request).rejects.toThrow('환불 미리보기를 다시 확인한 뒤 환불을 요청해주세요');
    expect(restoreSpy).toHaveBeenCalledWith({}, expect.objectContaining({ id: 'refund-1' }), expect.objectContaining({ code: 'REFUND_RETRY_WINDOW_EXPIRED' }));
    expect(insertSpy).not.toHaveBeenCalled();
    expect(reopenSpy).not.toHaveBeenCalled();
    expect(provider.cancelPayment).not.toHaveBeenCalled();
    expect(pgBoss.send).not.toHaveBeenCalled();
  });

  it('restores rights after a provider-aborted command and stops for a reviewed re-request', async () => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000,
        isPartialCancelable: true,
        cancels: [{ cancelAmount: 200000, cancelReason: FROZEN_COMMAND.reason, cancelStatus: 'ABORTED', canceledAt: '2026-07-05T03:01:00.000Z' }] }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    const restoreModule = await import('../cancellation/refund-rights-restoration.js');
    const restored = stuckFailedRefund();
    (restored.providerMetadata as Record<string, unknown>).rightsRestoredAt = new Date().toISOString();
    const restoreSpy = vi.spyOn(restoreModule, 'restoreRejectedRefundRights').mockResolvedValue(restored as never);
    const insertSpy = vi.spyOn(service as never, 'insertRequestedRefund');

    await expect(service.requestAdminRefund('reservation-1', 'admin-1', '재처리'))
      .rejects.toThrow('결제사가 이전 취소 요청을 중단해 티켓 권리를 복원했습니다');
    expect(restoreSpy).toHaveBeenCalledWith({}, expect.objectContaining({ id: 'refund-1' }), expect.objectContaining({ code: 'PROVIDER_CANCEL_ABORTED' }));
    expect(insertSpy).not.toHaveBeenCalled();
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });

  it('reports the current state when the refund changed while its rights were being restored', async () => {
    vi.setSystemTime(new Date(new Date('2026-07-05T03:00:00.000Z').getTime() + REFUND_CANCEL_POST_WINDOW_MS + 1000));
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    const restoreModule = await import('../cancellation/refund-rights-restoration.js');
    // A webhook completed the refund concurrently, so nothing was restored.
    vi.spyOn(restoreModule, 'restoreRejectedRefundRights').mockResolvedValue(createRefund({ status: 'completed' }) as never);

    const result = await service.requestAdminRefund('reservation-1', 'admin-1', '재처리');

    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    expect(result.idempotent).toBe(true);
  });

  it('keeps polling a provider-accepted async cancel without raising attention after many attempts', async () => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000,
        isPartialCancelable: true,
        cancels: [{ cancelAmount: 200000, cancelReason: FROZEN_COMMAND.reason, cancelStatus: 'IN_PROGRESS', canceledAt: '2026-07-05T03:01:00.000Z' }] }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    const reopened = createRefund({ status: 'processing_at_pg', retryCount: 4 });
    vi.spyOn(service as never, 'reopenFailedRefund').mockResolvedValue(reopened as never);
    const recordSpy = vi.spyOn(service as never, 'recordRefundCancelRetrySchedule').mockResolvedValue(reopened as never);

    await service.requestAdminRefund('reservation-1', 'admin-1', '재처리');

    expect(provider.cancelPayment).not.toHaveBeenCalled();
    expect(recordSpy).toHaveBeenCalledWith(reopened, 'refund-retry-job', { awaitingProvider: true });
  });

  it('stops for manual reconciliation when an unknown provider cancellation lowered the balance', async () => {
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'PARTIAL_CANCELED', currency: 'KRW', totalAmount: 204000, balanceAmount: 104000,
        cancels: [{ cancelAmount: 100000, cancelReason: 'console', cancelStatus: 'DONE', canceledAt: '2026-07-05T04:00:00.000Z' }] }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);

    await expect(service.requestAdminRefund('reservation-1', 'admin-1', '재처리')).rejects.toBeInstanceOf(ConflictException);
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });

  it('returns 503 without changing anything when the provider cannot be queried', async () => {
    const provider = { queryPayment: vi.fn().mockRejectedValue(new Error('fetch failed')), cancelPayment: vi.fn() };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);
    const reopenSpy = vi.spyOn(service as never, 'reopenFailedRefund');

    await expect(service.requestAdminRefund('reservation-1', 'admin-1', '재처리')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(reopenSpy).not.toHaveBeenCalled();
  });

  it('refuses when the ticket items no longer match the revoked state of the failed attempt', async () => {
    const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId').mockResolvedValue(createContext() as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);

    await expect(service.requestAdminRefund('reservation-1', 'admin-1', '재처리')).rejects.toBeInstanceOf(ConflictException);
    expect(provider.queryPayment).not.toHaveBeenCalled();
  });

  it('offers a failed refund with revoked rights for admin recovery with its stored quote', async () => {
    const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContextByReservationId')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(createRefund({
      status: 'failed', resultCode: 'RETRY_EXHAUSTED', failureReason: '은행 응답 지연', retryCount: 3,
      failedAt: new Date('2026-07-05T03:05:00.000Z'), customerServiceCtaVisible: true,
    }) as never);

    const preview = await service.getAdminRefundPreview('reservation-1', { fullRefundOverride: true });

    // No new refund can start, but requesting the admin refund again reconciles this attempt.
    expect(preview).toMatchObject({
      canRequestRefund: false,
      adminRecoveryAvailable: true,
      blockedReason: null,
      refundableAmount: 200000,
      cancellationQuote: { refundableAmount: 200000 },
      refundTimeline: { currentState: 'FAILED' },
    });
    expect(preview.adminRecoveryReason).toBe('RETRY_EXHAUSTED · 은행 응답 지연');
    // The recovery request queries the PG itself; the preview does not.
    expect(provider.queryPayment).not.toHaveBeenCalled();
  });

  it.each(['requested', 'sent_to_pg', 'processing_at_pg'])(
    'keeps a %s refund blocked in the admin preview instead of offering recovery',
    async (status) => {
      const { service } = createService({ queryPayment: vi.fn(), cancelPayment: vi.fn() });
      vi.spyOn(service as never, 'loadReservationContextByReservationId')
        .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
      vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(createRefund({ status }) as never);

      const preview = await service.getAdminRefundPreview('reservation-1');

      expect(preview.canRequestRefund).toBe(false);
      expect(preview.adminRecoveryAvailable).toBe(false);
      expect(preview.blockedReason).toContain('이미 환불이 결제사에서 진행 중입니다');
    },
  );

  it('explains in the preview why a failed refund cannot be recovered automatically', async () => {
    const { service } = createService({ queryPayment: vi.fn(), cancelPayment: vi.fn() });
    // The items are active again: the attempt no longer matches the revoked state.
    vi.spyOn(service as never, 'loadReservationContextByReservationId').mockResolvedValue(createContext() as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);

    const preview = await service.getAdminRefundPreview('reservation-1');

    expect(preview).toMatchObject({ canRequestRefund: false, adminRecoveryAvailable: false });
    expect(preview.blockedReason).toBe('환불 요청 이후 티켓 상태가 바뀌어 수동 대조가 필요합니다');
  });

  it('keeps the buyer re-request idempotent for a failed refund', async () => {
    const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContext')
      .mockResolvedValue(createContext({ itemStatus: 'cancellation_pending' }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(stuckFailedRefund() as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(result.idempotent).toBe(true);
    expect(provider.queryPayment).not.toHaveBeenCalled();
  });
});

describe('RefundService zero-amount cancellation (audit #82)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-05T03:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('previews a 0 KRW tier cancellation without a provider command or query', async () => {
    const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const { service } = createService(provider);
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(createContext({ price: 0 }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    const preview = await service.getRefundPreview('reservation-1', 'user-1');

    expect(preview.canRequestRefund).toBe(true);
    expect(preview.cancellationQuote?.refundableAmount).toBe(0);
    expect(preview.providerRefund).toMatchObject({ currency: 'KRW', amountMinor: 0 });
    expect(provider.queryPayment).not.toHaveBeenCalled();
  });

  it('cancels a 0 KRW tier reservation locally instead of rejecting it as an unsupported payment method', async () => {
    const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const finalizer = { finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({ releaseJobId: 'job', releaseEnqueued: true }) };
    const { service } = createService(provider, finalizer);
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(createContext({ price: 0 }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    const zeroQuote = { ...QUOTE, ticketSubtotal: 0, refundableAmount: 0, items: QUOTE.items.map((item) => ({ ...item, ticketPrice: 0, refundableAmount: 0 })) };
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(createRefund({ providerMetadata: {
      cancelReason: '단순 변심', localOnlyCancellation: true, cancellationQuote: zeroQuote,
      providerRefund: { currency: 'KRW', amountMinor: 0, amountDecimal: '0', originalAmountMinor: 4000, balanceBeforeMinor: 4000 },
    } }) as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(createRefund({ status: 'completed' }) as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(provider.queryPayment).not.toHaveBeenCalled();
    expect(provider.cancelPayment).not.toHaveBeenCalled();
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(expect.objectContaining({ localOnly: true }));
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });

  it('still cancels a 0 KRW tier locally for an admin while the PG is unreachable (no PG call is involved)', async () => {
    const provider = { queryPayment: vi.fn().mockRejectedValue(new Error('fetch failed')), cancelPayment: vi.fn() };
    const finalizer = { finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({ releaseJobId: 'job', releaseEnqueued: true }) };
    const { service } = createService(provider, finalizer);
    vi.spyOn(service as never, 'loadReservationContextByReservationId').mockResolvedValue(createContext({ price: 0 }) as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    const zeroQuote = { ...QUOTE, ticketSubtotal: 0, refundableAmount: 0, items: QUOTE.items.map((item) => ({ ...item, ticketPrice: 0, refundableAmount: 0 })) };
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(createRefund({ providerMetadata: {
      cancelReason: '초대권 취소', localOnlyCancellation: true, cancellationQuote: zeroQuote,
      providerRefund: { currency: 'KRW', amountMinor: 0, amountDecimal: '0', originalAmountMinor: 4000, balanceBeforeMinor: 4000 },
    } }) as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(createRefund({ status: 'completed' }) as never);

    const preview = await service.getAdminRefundPreview('reservation-1');
    const result = await service.requestAdminRefund('reservation-1', 'admin-1', '초대권 취소');

    expect(preview).toMatchObject({ canRequestRefund: true, blockedReason: null });
    expect(preview.providerCheckUnavailable).toBeUndefined();
    expect(provider.queryPayment).not.toHaveBeenCalled();
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(expect.objectContaining({ localOnly: true }));
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });
});

describe('RefundService booking day for the fee schedule (audit #83)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the payment approval day: selected at 23:57 KST, paid at 00:03 KST, cancelled at 00:10 KST is same-day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T15:10:00.000Z')); // 2026-07-02 00:10 KST
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 204000, balanceAmount: 204000, isPartialCancelable: true }),
      cancelPayment: vi.fn(),
    };
    const { service } = createService(provider);
    const context = createContext();
    context.reservation.createdAt = new Date('2026-07-01T14:57:00.000Z'); // 2026-07-01 23:57 KST
    context.payment.paidAt = new Date('2026-07-01T15:03:00.000Z'); // 2026-07-02 00:03 KST
    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

    const preview = await service.getRefundPreview('reservation-1', 'user-1');

    expect(preview.cancellationQuote?.policyCodes).toEqual(['SAME_DAY_BEFORE_MIDNIGHT']);
    expect(preview.cancellationQuote?.refundableAmount).toBe(204000);
  });

  it('falls back to the reservation creation time only for legacy payments without an approval time', () => {
    const createdAt = new Date('2026-07-01T14:57:00.000Z');
    expect(resolveBookingConfirmedAt({ payment: { paidAt: null }, reservation: { createdAt } })).toBe(createdAt);
    expect(resolveBookingConfirmedAt({ payment: { paidAt: new Date('2026-07-01T15:03:00.000Z') }, reservation: { createdAt } }))
      .toEqual(new Date('2026-07-01T15:03:00.000Z'));
  });
});
