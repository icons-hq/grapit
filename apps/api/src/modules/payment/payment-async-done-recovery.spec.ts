import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LOCK_EXPIRED_MESSAGE, LOCK_OTHER_OWNER_MESSAGE } from '../booking/booking.service.js';
import { payments, reservationPaymentFailureDiagnostics, reservations } from '../../database/schema/index.js';
import { PaymentService, type AsyncDoneCompensationRecord } from './payment.service.js';

vi.mock('../../database/ticket-limit.js', () => ({
  getTicketLimitSnapshot: vi.fn().mockResolvedValue({ performanceId: 'performance-1', maxTicketsPerUser: 4, activeTicketCount: 0 }),
  lockTicketLimitScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../database/included-benefit-entitlements.js', () => ({
  syncIncludedBenefitEntitlementsForTicketItems: vi.fn().mockResolvedValue(undefined),
}));

function selectChain<T>(rows: T[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  // `where` is awaited directly by most reads and chained by the sweep query.
  chain.where.mockImplementation(() => Object.assign(Promise.resolve(rows), chain));
  return chain;
}

function mutationChain<T>(returningRows: T[] = []) {
  const chain = {
    set: vi.fn(),
    values: vi.fn(),
    where: vi.fn(),
    onConflictDoNothing: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.values.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.returning.mockResolvedValue(returningRows);
  return chain;
}

function findJsonParam(value: unknown, key: string): Record<string, unknown> | undefined {
  const seen = new Set<unknown>();
  let found: Record<string, unknown> | undefined;
  const visit = (candidate: unknown): void => {
    if (found || candidate === null || candidate === undefined) return;
    if (typeof candidate === 'string') {
      if (!candidate.startsWith('{')) return;
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && key in parsed) found = parsed;
      } catch {
        // Not JSON.
      }
      return;
    }
    if (typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    (Array.isArray(candidate) ? candidate : Object.values(candidate as Record<string, unknown>)).forEach(visit);
  };
  visit(value);
  return found;
}

function compensationRecord(
  overrides: Partial<AsyncDoneCompensationRecord> & { reservationId: string },
): AsyncDoneCompensationRecord {
  const { reservationId, ...rest } = overrides;
  const cancelRequestId = `cancel_${reservationId}`;
  return {
    version: 1,
    kind: 'seat_conflict',
    paymentKey: 'pay_compensated',
    reason: '판매 불가능 좌석으로 인한 자동 취소',
    payment: {
      method: 'FOREIGN_EASY_PAY',
      provider: 'ALIPAY_PLUS',
      currency: 'KRW',
      amount: 102000,
      providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 6936,
      secretKeyScope: 'foreign-easy-pay',
    },
    cancelRequest: {
      paymentKey: 'pay_compensated',
      reason: '판매 불가능 좌석으로 인한 자동 취소',
      options: {
        idempotencyKey: 'toss-webhook:evt-1:seat-failure-cancel',
        secretKeyScope: 'foreign-easy-pay',
        cancelRequestId,
      },
    },
    cancelRequestIds: [cancelRequestId],
    attempts: 1,
    state: 'pending',
    requestedAt: '2026-10-01T00:00:00.000Z',
    lastAttemptAt: '2026-10-01T00:00:00.000Z',
    ...rest,
  };
}

describe('PaymentService async DONE safety and recovery', () => {
  let service: PaymentService;
  let db: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let bookingService: {
    acquirePaymentConfirmLock: ReturnType<typeof vi.fn>;
    refreshPaymentConfirmLock: ReturnType<typeof vi.fn>;
    releasePaymentConfirmLock: ReturnType<typeof vi.fn>;
    acquireRecoverySeatLocks: ReturnType<typeof vi.fn>;
    releaseRecoverySeatLocks: ReturnType<typeof vi.fn>;
    extendOwnedSeatLocks: ReturnType<typeof vi.fn>;
    getMyLocks: ReturnType<typeof vi.fn>;
  };
  let tossClient: {
    cancelPayment: ReturnType<typeof vi.fn>;
    queryPayment: ReturnType<typeof vi.fn>;
  };
  let qrTicketService: { ensureIssuedTicketsForReservation: ReturnType<typeof vi.fn> };
  let gateway: { broadcastSeatUpdate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = {
      select: vi.fn().mockImplementation(() => selectChain([])),
      insert: vi.fn().mockImplementation(() => mutationChain()),
      update: vi.fn().mockImplementation(() => mutationChain()),
      transaction: vi.fn(),
    };
    bookingService = {
      acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
      refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
      releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
      acquireRecoverySeatLocks: vi.fn().mockResolvedValue({ acquired: true }),
      releaseRecoverySeatLocks: vi.fn().mockResolvedValue(undefined),
      extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
      getMyLocks: vi.fn().mockResolvedValue({ seatIds: [], expiresAt: null }),
    };
    tossClient = {
      cancelPayment: vi.fn().mockResolvedValue({}),
      queryPayment: vi.fn(),
    };
    qrTicketService = { ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([]) };
    gateway = { broadcastSeatUpdate: vi.fn() };
    service = new PaymentService(
      db as never,
      gateway as never,
      qrTicketService as never,
      tossClient as never,
      undefined,
      undefined,
      bookingService as never,
    );
  });

  function pendingDoneFixture(input: { reservationId: string; userId: string; showtimeId: string; seats: string[] }) {
    db.select
      .mockImplementationOnce(() => selectChain([{
        id: input.reservationId,
        userId: input.userId,
        showtimeId: input.showtimeId,
        status: 'PENDING_PAYMENT',
        totalAmount: input.seats.length * 52000,
      }]))
      .mockImplementationOnce(() => selectChain([]))
      .mockImplementationOnce(() => selectChain(input.seats.map((seatId) => ({
        seatId, tierName: 'VIP', price: 50000, row: 'A', number: seatId.slice(-1),
      }))));
  }

  function lateDonePayload(orderId: string, paymentKey = 'pay_late_done') {
    return {
      eventId: `evt-${randomUUID()}`,
      eventType: 'PAYMENT_STATUS_CHANGED' as const,
      data: {
        paymentKey,
        orderId,
        status: 'DONE',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS' as const,
        currency: 'KRW',
        totalAmount: 52000,
        approvedAt: '2026-10-01T00:20:00.000Z',
      },
    };
  }

  function mockCommittingTransaction() {
    const tx = {
      update: vi.fn().mockImplementation(() => mutationChain([{ id: randomUUID() }])),
      insert: vi.fn().mockImplementation(() => mutationChain([{ id: randomUUID(), tierName: 'VIP' }])),
    };
    db.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => callback(tx));
    return tx;
  }

  describe('late DONE for a PENDING_PAYMENT reservation (#71)', () => {
    it('refunds instead of taking a seat another buyer re-locked after the checkout lock expired', async () => {
      const reservationId = randomUUID();
      pendingDoneFixture({ reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', seats: ['1F:A-1'] });
      bookingService.extendOwnedSeatLocks.mockRejectedValueOnce(new ConflictException(LOCK_EXPIRED_MESSAGE));
      bookingService.acquireRecoverySeatLocks.mockResolvedValueOnce({ acquired: false });
      tossClient.cancelPayment.mockResolvedValueOnce({
        status: 'CANCELED',
        cancels: [{ cancelAmount: 52000, cancelReason: '판매 불가능 좌석으로 인한 자동 취소', canceledAt: '2026-10-01T00:20:01.000Z', cancelStatus: 'DONE' }],
      });

      await expect(service.upsertAsyncPaymentProgress(lateDonePayload('GRP-LATE-1'), 'DONE', 'payment_status_changed:done'))
        .resolves.toBe('DONE_COMPENSATED_SEAT_CONFLICT');

      expect(bookingService.extendOwnedSeatLocks).toHaveBeenCalledWith('buyer-a', 'showtime-1', ['1F:A-1'], 60);
      expect(bookingService.getMyLocks).toHaveBeenCalledWith('buyer-a', 'showtime-1');
      expect(db.transaction).not.toHaveBeenCalled();
      expect(tossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_late_done',
        '판매 불가능 좌석으로 인한 자동 취소',
        expect.objectContaining({ secretKeyScope: 'foreign-easy-pay', cancelRequestId: `cancel_${reservationId}` }),
      );
      expect(gateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(qrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('commits under a reservation-scoped recovery lock when the expired seat is still free', async () => {
      const reservationId = randomUUID();
      pendingDoneFixture({ reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', seats: ['1F:A-1'] });
      bookingService.extendOwnedSeatLocks.mockRejectedValueOnce(new ConflictException(LOCK_EXPIRED_MESSAGE));
      mockCommittingTransaction();
      db.insert.mockImplementationOnce(() => mutationChain([{ id: randomUUID() }]));

      await expect(service.upsertAsyncPaymentProgress(lateDonePayload('GRP-LATE-2'), 'DONE', 'payment_status_changed:done'))
        .resolves.toBe('DONE_APPLIED');

      expect(bookingService.acquireRecoverySeatLocks).toHaveBeenCalledWith(
        'showtime-1', ['1F:A-1'], `payment-recovery:${reservationId}`,
      );
      expect(bookingService.releaseRecoverySeatLocks).toHaveBeenCalledWith(
        'showtime-1', ['1F:A-1'], `payment-recovery:${reservationId}`,
      );
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
    });

    it('keeps the buyer’s own live checkout lock through the commit without a recovery lock', async () => {
      const reservationId = randomUUID();
      pendingDoneFixture({ reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', seats: ['1F:A-1'] });
      mockCommittingTransaction();

      await expect(service.upsertAsyncPaymentProgress(lateDonePayload('GRP-LATE-3'), 'DONE', 'payment_status_changed:done'))
        .resolves.toBe('DONE_APPLIED');

      expect(bookingService.extendOwnedSeatLocks).toHaveBeenCalledWith('buyer-a', 'showtime-1', ['1F:A-1'], 60);
      expect(bookingService.acquireRecoverySeatLocks).not.toHaveBeenCalled();
      expect(bookingService.releaseRecoverySeatLocks).not.toHaveBeenCalled();
    });

    it('combines the buyer’s remaining lock with a recovery lock when only some seats expired', async () => {
      const reservationId = randomUUID();
      db.select
        .mockImplementationOnce(() => selectChain([{
          id: reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', status: 'PENDING_PAYMENT', totalAmount: 104000,
        }]))
        .mockImplementationOnce(() => selectChain([]))
        .mockImplementationOnce(() => selectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' },
          { seatId: '1F:A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
        ]));
      bookingService.extendOwnedSeatLocks
        .mockRejectedValueOnce(new ConflictException(LOCK_EXPIRED_MESSAGE))
        .mockResolvedValueOnce(undefined);
      bookingService.acquireRecoverySeatLocks
        .mockResolvedValueOnce({ acquired: false })
        .mockResolvedValueOnce({ acquired: true });
      bookingService.getMyLocks.mockResolvedValueOnce({ seatIds: ['1F:A-1'], expiresAt: Date.now() + 1000 });
      mockCommittingTransaction();

      const payload = lateDonePayload('GRP-LATE-4');
      await expect(service.upsertAsyncPaymentProgress(
        { ...payload, data: { ...payload.data, totalAmount: 104000 } },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBe('DONE_APPLIED');

      expect(bookingService.extendOwnedSeatLocks).toHaveBeenLastCalledWith('buyer-a', 'showtime-1', ['1F:A-1'], 60);
      expect(bookingService.acquireRecoverySeatLocks).toHaveBeenLastCalledWith(
        'showtime-1', ['1F:A-2'], `payment-recovery:${reservationId}`,
      );
      expect(bookingService.releaseRecoverySeatLocks).toHaveBeenCalledWith(
        'showtime-1', ['1F:A-2'], `payment-recovery:${reservationId}`,
      );
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
    });

    it('refunds when another buyer holds the seat even if the original owner token is not the buyer', async () => {
      const reservationId = randomUUID();
      pendingDoneFixture({ reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', seats: ['1F:A-1'] });
      bookingService.extendOwnedSeatLocks.mockRejectedValueOnce(new ConflictException(LOCK_OTHER_OWNER_MESSAGE));
      bookingService.acquireRecoverySeatLocks.mockResolvedValueOnce({ acquired: false });

      await expect(service.upsertAsyncPaymentProgress(lateDonePayload('GRP-LATE-5'), 'DONE', 'payment_status_changed:done'))
        .resolves.toBe('DONE_CANCEL_PENDING');

      expect(db.transaction).not.toHaveBeenCalled();
      expect(tossClient.cancelPayment).toHaveBeenCalledOnce();
    });

    function failedDoneFixture(input: { reservationId: string; userId: string; showtimeId: string; seats: string[] }) {
      db.select
        .mockImplementationOnce(() => selectChain([{
          id: input.reservationId,
          userId: input.userId,
          showtimeId: input.showtimeId,
          status: 'FAILED',
          totalAmount: input.seats.length * 52000,
        }]))
        .mockImplementationOnce(() => selectChain([]))
        .mockImplementationOnce(() => selectChain(input.seats.map((seatId) => ({
          seatId, tierName: 'VIP', price: 50000, row: 'A', number: seatId.slice(-1),
        }))));
    }

    it('refunds a late DONE for a FAILED reservation when the buyer re-locked the seat for a newer checkout', async () => {
      const reservationId = randomUUID();
      failedDoneFixture({ reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', seats: ['1F:A-1'] });
      // The buyer's live lock now belongs to checkout R2, so recovery cannot take it.
      bookingService.acquireRecoverySeatLocks.mockResolvedValueOnce({ acquired: false });
      tossClient.cancelPayment.mockResolvedValueOnce({
        status: 'CANCELED',
        cancels: [{ cancelAmount: 52000, cancelReason: '판매 불가능 좌석으로 인한 자동 취소', canceledAt: '2026-10-01T00:20:01.000Z', cancelStatus: 'DONE' }],
      });

      await expect(service.upsertAsyncPaymentProgress(lateDonePayload('GRP-LATE-FAILED-1'), 'DONE', 'payment_status_changed:done'))
        .resolves.toBe('DONE_COMPENSATED_SEAT_CONFLICT');

      expect(bookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(bookingService.getMyLocks).not.toHaveBeenCalled();
      expect(bookingService.acquireRecoverySeatLocks).toHaveBeenCalledWith(
        'showtime-1', ['1F:A-1'], `payment-recovery:${reservationId}`,
      );
      expect(db.transaction).not.toHaveBeenCalled();
      expect(tossClient.cancelPayment).toHaveBeenCalledOnce();
    });

    it('recovers a FAILED reservation only under the recovery lock when its seats are free', async () => {
      const reservationId = randomUUID();
      failedDoneFixture({ reservationId, userId: 'buyer-a', showtimeId: 'showtime-1', seats: ['1F:A-1'] });
      mockCommittingTransaction();
      db.insert.mockImplementationOnce(() => mutationChain([{ id: randomUUID() }]));

      await expect(service.upsertAsyncPaymentProgress(lateDonePayload('GRP-LATE-FAILED-2'), 'DONE', 'payment_status_changed:done'))
        .resolves.toBe('DONE_APPLIED');

      expect(bookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(bookingService.acquireRecoverySeatLocks).toHaveBeenCalledWith(
        'showtime-1', ['1F:A-1'], `payment-recovery:${reservationId}`,
      );
      expect(bookingService.releaseRecoverySeatLocks).toHaveBeenCalledWith(
        'showtime-1', ['1F:A-1'], `payment-recovery:${reservationId}`,
      );
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
    });
  });

  describe('confirmed cancel webhooks after seat-level cancellations (#77)', () => {
    const finalizer = { finalizeFullPaymentCancellation: vi.fn() };

    beforeEach(() => {
      finalizer.finalizeFullPaymentCancellation.mockReset().mockResolvedValue({ releaseJobId: 'job', releaseEnqueued: true });
      Object.assign(service, { paymentCancellationFinalizer: finalizer });
    });

    function confirmedCancelFixture(input: { reservationId: string; paymentId: string; currency: 'KRW'; providerChargeCurrency: string | null }) {
      db.select
        .mockImplementationOnce(() => selectChain([{
          id: input.reservationId, reservationNumber: 'GRP-1', showtimeId: 'showtime-1', status: 'CONFIRMED',
        }]))
        .mockImplementationOnce(() => selectChain([{
          id: input.paymentId,
          reservationId: input.reservationId,
          paymentKey: 'pay_two_seats',
          tossOrderId: 'GRP-TWO-SEATS',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: input.currency,
          amount: 104000,
          status: 'PARTIAL_CANCELED',
          providerMetadata: null,
          providerChargeCurrency: input.providerChargeCurrency,
          providerChargeAmountMinor: input.providerChargeCurrency ? 7072 : null,
        }]))
        .mockImplementationOnce(() => selectChain([]))
        .mockImplementationOnce(() => selectChain([{ id: 'showtime-1', performanceId: 'performance-1' }]))
        .mockImplementationOnce(() => selectChain([{ cancelledSeatHoldMinMinutes: 1, cancelledSeatHoldMaxMinutes: 10 }]))
        .mockImplementationOnce(() => selectChain([{ seatId: '1F:A-1' }, { seatId: '1F:A-2' }]));
    }

    it('finalizes only the pending seat command when PAYMENT_STATUS_CHANGED reports the payment fully cancelled', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const commandB = randomUUID();
      confirmedCancelFixture({ reservationId, paymentId, currency: 'KRW', providerChargeCurrency: 'USD' });
      const command = {
        version: 1 as const,
        id: commandB,
        requestedAt: '2026-10-01T01:00:00.000Z',
        reason: `좌석 취소 [${commandB}]`,
        options: {
          idempotencyKey: `ticket-item-cancel:item-b:${commandB}`,
          secretKeyScope: 'foreign-easy-pay' as const,
          cancelAmount: 35.36,
          currency: 'USD',
          cancelRequestId: `cancel_${commandB}`,
        },
        currency: 'USD' as const,
        amountMinor: 3536,
        originalAmountMinor: 7072,
        balanceBeforeMinor: 3536,
      };
      db.select
        // prepared seat commands still cancellation_pending (seat B only)
        .mockImplementationOnce(() => selectChain([{
          ticketItemId: 'item-b', seatId: 'A-2', floorKey: '1F', seatKey: '1F:A-2',
          cancellationFee: 0, serviceFeeRefund: 2000, refundableAmount: 52000,
          cancellationCommand: command, cancelReason: '좌석 취소',
        }]))
        // generated-id lookup for seat A's earlier cancel finds no pending item
        .mockImplementationOnce(() => selectChain([]))
        // remaining uncancelled seats after B is finalized
        .mockImplementationOnce(() => selectChain([
          { seatId: 'A-1', floorKey: '1F', seatKey: '1F:A-1', status: 'cancelled' },
          { seatId: 'A-2', floorKey: '1F', seatKey: '1F:A-2', status: 'cancelled' },
        ]));

      const result = await service.finalizeConfirmedCancelWebhook(
        {
          eventId: 'evt-payment-canceled-last-seat',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: { paymentKey: 'pay_two_seats', orderId: 'GRP-TWO-SEATS', status: 'CANCELED' },
        },
        {
          paymentKey: 'pay_two_seats',
          orderId: 'GRP-TWO-SEATS',
          totalAmount: 70.72,
          status: 'CANCELED',
          cancels: [
            { cancelAmount: 35.36, cancelReason: '좌석 취소 [a]', canceledAt: '2026-10-01T00:30:00.000Z', cancelStatus: 'DONE', cancelRequestId: `cancel_${randomUUID()}` },
            { cancelAmount: 35.36, cancelReason: command.reason, canceledAt: '2026-10-01T01:00:05.000Z', cancelStatus: 'DONE', cancelRequestId: `cancel_${commandB}` },
          ],
        },
      );

      expect(result).toBe('finalized');
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledOnce();
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(expect.objectContaining({
        source: 'cancel_webhook',
        ticketItemCancellation: expect.objectContaining({ ticketItemId: 'item-b', refundableAmount: 52000 }),
        context: expect.objectContaining({ seats: [{ seatId: 'A-2', floorKey: '1F', seatKey: '1F:A-2' }] }),
      }));
    });

    it('limits a quote-less console full cancel to seats that are not already cancelled', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      confirmedCancelFixture({ reservationId, paymentId, currency: 'KRW', providerChargeCurrency: null });
      db.select
        .mockImplementationOnce(() => selectChain([])) // prepared commands
        .mockImplementationOnce(() => selectChain([{ ticketItemId: 'item-a' }])) // seat A cancel already reconciled
        .mockImplementationOnce(() => selectChain([])) // console cancel: no reconciled local item
        .mockImplementationOnce(() => selectChain([])) // console cancel: no pending local item
        .mockImplementationOnce(() => selectChain([
          { seatId: 'A-1', floorKey: '1F', seatKey: '1F:A-1', status: 'cancelled' },
          { seatId: 'A-2', floorKey: '1F', seatKey: '1F:A-2', status: 'active' },
        ]));

      const result = await service.finalizeConfirmedCancelWebhook(
        {
          eventId: 'evt-console-cancel',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: { paymentKey: 'pay_two_seats', orderId: 'GRP-TWO-SEATS', status: 'CANCELED' },
        },
        {
          paymentKey: 'pay_two_seats',
          orderId: 'GRP-TWO-SEATS',
          totalAmount: 104000,
          status: 'CANCELED',
          cancels: [
            { cancelAmount: 46000, cancelReason: '좌석 취소', canceledAt: '2026-09-20T00:00:00.000Z', cancelStatus: 'DONE' },
            { cancelAmount: 58000, cancelReason: '콘솔 취소', canceledAt: '2026-10-01T00:00:00.000Z', cancelStatus: 'DONE' },
          ],
        },
      );

      expect(result).toBe('finalized');
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledOnce();
      const call = finalizer.finalizeFullPaymentCancellation.mock.calls[0]?.[0] as {
        ticketItemCancellation?: unknown;
        context: { seats: unknown[] };
      };
      expect(call.ticketItemCancellation).toBeUndefined();
      // Seat A keeps its fee, refund and cancelledAt; its reopened seat is not touched.
      expect(call.context.seats).toEqual([{ seatId: 'A-2', floorKey: '1F', seatKey: '1F:A-2' }]);
    });

    it('treats a seat cancel webhook for an already cancelled Ticket Item as already finalized', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const commandId = randomUUID();
      confirmedCancelFixture({ reservationId, paymentId, currency: 'KRW', providerChargeCurrency: 'USD' });
      db.select.mockImplementationOnce(() => selectChain([{
        ticketItemId: 'item-a', seatId: 'A-1', floorKey: '1F', seatKey: '1F:A-1', status: 'cancelled',
        cancellationFee: 0, serviceFeeRefund: 2000, refundableAmount: 52000, cancellationCommand: null,
      }]));

      const result = await service.finalizeConfirmedCancelWebhook(
        {
          eventId: 'evt-cancel-done-replay',
          eventType: 'CANCEL_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_two_seats', orderId: 'GRP-TWO-SEATS', status: 'PARTIAL_CANCELED',
            cancelStatus: 'DONE', cancelRequestId: `cancel_${commandId}`,
          },
        },
        {
          paymentKey: 'pay_two_seats',
          orderId: 'GRP-TWO-SEATS',
          totalAmount: 70.72,
          status: 'PARTIAL_CANCELED',
          cancels: [{ cancelAmount: 35.36, cancelReason: 'x', canceledAt: '2026-10-01T00:00:00.000Z', cancelStatus: 'DONE', cancelRequestId: `cancel_${commandId}` }],
        },
      );

      expect(result).toBe('already_finalized');
      expect(finalizer.finalizeFullPaymentCancellation).not.toHaveBeenCalled();
    });
  });

  describe('compensation cancel ABORTED and recovery sweep (#76)', () => {
    function paymentRow(overrides: Record<string, unknown>) {
      return {
        id: 'payment-1',
        reservationId: 'reservation-1',
        paymentKey: 'pay_compensated',
        tossOrderId: 'GRP-COMP-1',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'KRW',
        amount: 102000,
        status: 'DONE',
        asyncStatus: 'cancel_pending',
        paidAt: new Date('2026-10-01T00:00:00.000Z'),
        cancelReason: '판매 불가능 좌석으로 인한 자동 취소',
        providerMetadata: null,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 6936,
        ...overrides,
      };
    }

    it('records a provider ABORTED compensation cancel as recoverable and keeps the payment unissuable', async () => {
      const record = compensationRecord({ reservationId: 'reservation-1' });
      const paymentUpdate = mutationChain();
      const diagnosticInsert = mutationChain();
      db.select
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]))
        .mockImplementationOnce(() => selectChain([paymentRow({ providerMetadata: { asyncDoneCompensation: record } })]));
      db.update.mockImplementationOnce(() => paymentUpdate);
      db.insert.mockImplementationOnce(() => diagnosticInsert);

      await expect(service.recordCompensationCancelAborted({
        eventId: 'evt-cancel-aborted',
        eventType: 'CANCEL_STATUS_CHANGED',
        data: {
          paymentKey: 'pay_compensated',
          orderId: 'GRP-COMP-1',
          cancelStatus: 'ABORTED',
          cancelRequestId: 'cancel_reservation-1',
        },
      })).resolves.toBe('own');

      const patch = findJsonParam(paymentUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensation') as {
        asyncDoneCompensation: AsyncDoneCompensationRecord;
        asyncDoneCompensationOpen: boolean;
      };
      expect(patch.asyncDoneCompensation.state).toBe('aborted');
      expect(patch.asyncDoneCompensationOpen).toBe(true);
      // Status and async status stay DONE/cancel_pending so confirm and DONE replays cannot issue it.
      expect(paymentUpdate.set.mock.calls[0]?.[0]).not.toHaveProperty('status');
      expect(paymentUpdate.set.mock.calls[0]?.[0]).not.toHaveProperty('asyncStatus');
      expect(db.insert).toHaveBeenCalledWith(reservationPaymentFailureDiagnostics);
      expect(diagnosticInsert.values).toHaveBeenCalledWith(expect.objectContaining({
        reservationId: 'reservation-1',
        diagnosticCode: 'ASYNC_DONE_COMPENSATION_CANCEL_ABORTED',
      }));
    });

    it('ignores an ABORTED cancel that is not one of the compensation requests', async () => {
      db.select
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]))
        .mockImplementationOnce(() => selectChain([paymentRow({
          providerMetadata: { asyncDoneCompensation: compensationRecord({ reservationId: 'reservation-1' }) },
        })]));

      await expect(service.recordCompensationCancelAborted({
        eventId: 'evt-other-cancel-aborted',
        eventType: 'CANCEL_STATUS_CHANGED',
        data: {
          paymentKey: 'pay_compensated',
          orderId: 'GRP-COMP-1',
          cancelStatus: 'ABORTED',
          cancelRequestId: 'cancel_unrelated',
        },
      })).resolves.toBeNull();
      expect(db.update).not.toHaveBeenCalled();
    });

    function sweepCandidates(rows: Array<{ id: string; tossOrderId: string }>) {
      db.select.mockImplementationOnce(() => selectChain(rows));
    }

    it('re-requests an aborted compensation cancel with a fresh idempotency key and cancelRequestId', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      const record = compensationRecord({
        reservationId: 'reservation-1',
        state: 'aborted',
        lastCheckedAt: '2026-10-01T00:50:00.000Z',
      });
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({ providerMetadata: { asyncDoneCompensation: record } })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockResolvedValueOnce({
        paymentKey: 'pay_compensated',
        orderId: 'GRP-COMP-1',
        totalAmount: 69.36,
        status: 'DONE',
        cancels: [{ cancelAmount: 69.36, cancelReason: record.reason, canceledAt: '2026-10-01T00:10:00.000Z', cancelStatus: 'ABORTED', cancelRequestId: 'cancel_reservation-1' }],
      });
      tossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pay_compensated',
        orderId: 'GRP-COMP-1',
        totalAmount: 69.36,
        status: 'DONE',
        cancels: [{ cancelAmount: 69.36, cancelReason: record.reason, canceledAt: '2026-10-01T01:00:01.000Z', cancelStatus: 'IN_PROGRESS', cancelRequestId: 'cancel_reservation-1-r2' }],
      });
      const recordUpdate = mutationChain();
      const flagUpdate = mutationChain();
      db.update
        .mockImplementationOnce(() => recordUpdate)
        .mockImplementationOnce(() => flagUpdate);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({
        checked: 1,
        retried: 1,
        cancelled: 0,
      });

      expect(tossClient.queryPayment).toHaveBeenCalledWith('pay_compensated', { secretKeyScope: 'foreign-easy-pay' });
      expect(tossClient.cancelPayment).toHaveBeenCalledWith('pay_compensated', record.reason, {
        idempotencyKey: 'toss-webhook:evt-1:seat-failure-cancel:retry-2',
        secretKeyScope: 'foreign-easy-pay',
        cancelRequestId: 'cancel_reservation-1-r2',
      });
      const patch = findJsonParam(recordUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensation') as {
        asyncDoneCompensation: AsyncDoneCompensationRecord;
      };
      expect(patch.asyncDoneCompensation).toMatchObject({
        state: 'pending',
        attempts: 2,
        cancelRequestIds: ['cancel_reservation-1', 'cancel_reservation-1-r2'],
      });
      expect(findJsonParam(flagUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensationOpen'))
        .toEqual({ asyncDoneCompensationOpen: true });
      // The sweep and every order share the confirm lease keyspace.
      expect(bookingService.acquirePaymentConfirmLock).toHaveBeenCalledWith('async-done-compensation-sweep', expect.any(String));
      expect(bookingService.acquirePaymentConfirmLock).toHaveBeenCalledWith('GRP-COMP-1', expect.any(String));
    });

    it('starts no further order once the worker asks the sweep to stop (bounded shutdown)', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      sweepCandidates([
        { id: 'payment-1', tossOrderId: 'GRP-COMP-1' },
        { id: 'payment-2', tossOrderId: 'GRP-COMP-2' },
      ]);

      await expect(service.recoverAsyncDoneCompensations(now, undefined, { shouldStop: () => true }))
        .resolves.toMatchObject({ checked: 0 });
      expect(bookingService.acquirePaymentConfirmLock).not.toHaveBeenCalledWith('GRP-COMP-1', expect.any(String));
      expect(tossClient.queryPayment).not.toHaveBeenCalled();
    });

    it('finalizes a legacy cancel_pending row locally once the provider shows the cancel completed', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({ providerMetadata: null })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockResolvedValueOnce({
        paymentKey: 'pay_compensated',
        orderId: 'GRP-COMP-1',
        totalAmount: 69.36,
        status: 'CANCELED',
        cancels: [{ cancelAmount: 69.36, cancelReason: '판매 불가능 좌석으로 인한 자동 취소', canceledAt: '2026-10-01T00:40:00.000Z', cancelStatus: 'DONE', cancelRequestId: 'cancel_reservation-1' }],
      });
      const paymentFinalize = mutationChain([{ id: 'payment-1' }]);
      const reservationFail = mutationChain();
      db.update
        .mockImplementationOnce(() => paymentFinalize)
        .mockImplementationOnce(() => reservationFail);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ cancelled: 1 });

      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledWith(payments);
      expect(paymentFinalize.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'CANCELED',
        asyncStatus: 'compensation_cancelled',
        cancelledAt: new Date('2026-10-01T00:40:00.000Z'),
      }));
      expect(db.update).toHaveBeenCalledWith(reservations);
      expect(reservationFail.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    });

    it('waits for an IN_PROGRESS provider cancel instead of sending another one', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({
          providerMetadata: { asyncDoneCompensation: compensationRecord({ reservationId: 'reservation-1' }) },
        })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockResolvedValueOnce({
        paymentKey: 'pay_compensated',
        orderId: 'GRP-COMP-1',
        totalAmount: 69.36,
        status: 'DONE',
        cancels: [{ cancelAmount: 69.36, cancelReason: 'x', canceledAt: '2026-10-01T00:10:00.000Z', cancelStatus: 'IN_PROGRESS', cancelRequestId: 'cancel_reservation-1' }],
      });

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ waiting: 1, retried: 0 });
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
    });

    it('does not re-check an IN_PROGRESS compensation before the pending grace elapses', async () => {
      const now = new Date('2026-10-01T00:05:00.000Z');
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({
          providerMetadata: { asyncDoneCompensation: compensationRecord({ reservationId: 'reservation-1' }) },
        })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));

      await service.recoverAsyncDoneCompensations(now);
      expect(tossClient.queryPayment).not.toHaveBeenCalled();
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
    });

    it('surfaces exhausted compensation retries for operator reconciliation', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      const record = compensationRecord({ reservationId: 'reservation-1', state: 'aborted', attempts: 5 });
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({ providerMetadata: { asyncDoneCompensation: record } })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockResolvedValueOnce({
        paymentKey: 'pay_compensated',
        orderId: 'GRP-COMP-1',
        totalAmount: 69.36,
        status: 'DONE',
        cancels: [],
      });
      const diagnosticInsert = mutationChain();
      db.insert.mockImplementationOnce(() => diagnosticInsert);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ attention: 1 });

      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
      expect(diagnosticInsert.values).toHaveBeenCalledWith(expect.objectContaining({
        diagnosticCode: 'ASYNC_DONE_COMPENSATION_ATTENTION',
      }));
    });

    it('records a failing provider query and keeps polling before the attention threshold', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      const record = compensationRecord({
        reservationId: 'reservation-1',
        state: 'error',
        lastCheckedAt: '2026-10-01T00:58:00.000Z',
      });
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({ providerMetadata: { asyncDoneCompensation: record } })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockRejectedValueOnce(new Error('UNAUTHORIZED_KEY'));
      const recordUpdate = mutationChain();
      db.update.mockImplementationOnce(() => recordUpdate);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ waiting: 1, attention: 0 });

      const patch = findJsonParam(recordUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensation') as {
        asyncDoneCompensation: AsyncDoneCompensationRecord;
      };
      expect(patch.asyncDoneCompensation).toMatchObject({
        state: 'error',
        queryFailures: 1,
        queryFailingSince: now.toISOString(),
        lastError: 'UNAUTHORIZED_KEY',
      });
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('surfaces a compensation whose provider query keeps failing for operator reconciliation', async () => {
      const now = new Date('2026-10-01T03:00:00.000Z');
      const errorLog = vi.spyOn((service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger, 'error')
        .mockImplementation(() => undefined);
      const record = compensationRecord({
        reservationId: 'reservation-1',
        state: 'pending',
        lastCheckedAt: '2026-10-01T02:45:00.000Z',
        queryFailures: 2,
        queryFailingSince: '2026-10-01T01:30:00.000Z',
      });
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({
          providerMetadata: { asyncDoneCompensation: record, asyncDoneCompensationOpen: true },
        })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockRejectedValueOnce(new Error('NOT_FOUND_PAYMENT'));
      const recordUpdate = mutationChain();
      const flagUpdate = mutationChain();
      db.update
        .mockImplementationOnce(() => recordUpdate)
        .mockImplementationOnce(() => flagUpdate);
      const diagnosticInsert = mutationChain();
      db.insert.mockImplementationOnce(() => diagnosticInsert);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ attention: 1, waiting: 0 });

      const patch = findJsonParam(recordUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensation') as {
        asyncDoneCompensation: AsyncDoneCompensationRecord;
      };
      expect(patch.asyncDoneCompensation).toMatchObject({ state: 'attention', queryFailures: 3 });
      expect(patch.asyncDoneCompensation.lastError).toContain('NOT_FOUND_PAYMENT');
      expect(diagnosticInsert.values).toHaveBeenCalledWith(expect.objectContaining({
        diagnosticCode: 'ASYNC_DONE_COMPENSATION_ATTENTION',
      }));
      expect(findJsonParam(flagUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensationOpen'))
        .toEqual({ asyncDoneCompensationOpen: false });
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('needs operator reconciliation'));
      expect(tossClient.cancelPayment).not.toHaveBeenCalled();
    });

    it('surfaces a duplicate-charge compensation whose provider query keeps failing', async () => {
      const now = new Date('2026-10-01T03:00:00.000Z');
      const errorLog = vi.spyOn((service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger, 'error')
        .mockImplementation(() => undefined);
      const duplicate = compensationRecord({
        reservationId: 'reservation-1',
        kind: 'duplicate_payment_key',
        paymentKey: 'pay_duplicate',
        state: 'error',
        lastCheckedAt: '2026-10-01T02:58:00.000Z',
        queryFailures: 40,
        queryFailingSince: '2026-10-01T01:00:00.000Z',
      });
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({
          status: 'DONE',
          asyncStatus: 'payment_status_changed:done',
          providerMetadata: { duplicatePaymentCompensations: [duplicate], asyncDoneCompensationOpen: true },
        })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'CONFIRMED' }]));
      tossClient.queryPayment.mockRejectedValueOnce(new Error('FORBIDDEN_REQUEST'));
      const metadataUpdate = mutationChain();
      db.update.mockImplementationOnce(() => metadataUpdate);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ attention: 1 });

      const patch = findJsonParam(metadataUpdate.set.mock.calls[0]?.[0], 'duplicatePaymentCompensations') as {
        duplicatePaymentCompensations: AsyncDoneCompensationRecord[];
        asyncDoneCompensationOpen: boolean;
      };
      expect(patch.duplicatePaymentCompensations[0]).toMatchObject({ state: 'attention', queryFailures: 41 });
      expect(patch.asyncDoneCompensationOpen).toBe(false);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('paymentKey=pay_duplicate'));
    });

    it('clears the query failure count after the provider answers again', async () => {
      const now = new Date('2026-10-01T01:00:00.000Z');
      const record = compensationRecord({
        reservationId: 'reservation-1',
        state: 'pending',
        lastCheckedAt: '2026-10-01T00:45:00.000Z',
        queryFailures: 2,
        queryFailingSince: '2026-10-01T00:30:00.000Z',
      });
      sweepCandidates([{ id: 'payment-1', tossOrderId: 'GRP-COMP-1' }]);
      db.select
        .mockImplementationOnce(() => selectChain([paymentRow({ providerMetadata: { asyncDoneCompensation: record } })]))
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', status: 'PENDING_PAYMENT' }]));
      tossClient.queryPayment.mockResolvedValueOnce({
        paymentKey: 'pay_compensated',
        orderId: 'GRP-COMP-1',
        totalAmount: 69.36,
        status: 'DONE',
        cancels: [{ cancelAmount: 69.36, cancelReason: 'x', canceledAt: '2026-10-01T00:10:00.000Z', cancelStatus: 'IN_PROGRESS', cancelRequestId: 'cancel_reservation-1' }],
      });
      const recordUpdate = mutationChain();
      db.update.mockImplementationOnce(() => recordUpdate);

      await expect(service.recoverAsyncDoneCompensations(now)).resolves.toMatchObject({ waiting: 1 });

      const patch = findJsonParam(recordUpdate.set.mock.calls[0]?.[0], 'asyncDoneCompensation') as {
        asyncDoneCompensation: AsyncDoneCompensationRecord;
      };
      expect(patch.asyncDoneCompensation.state).toBe('pending');
      expect(patch.asyncDoneCompensation).not.toHaveProperty('queryFailures');
      expect(patch.asyncDoneCompensation).not.toHaveProperty('queryFailingSince');
    });

    it('skips the sweep when another instance holds the sweep lease', async () => {
      bookingService.acquirePaymentConfirmLock.mockResolvedValueOnce(false);

      await expect(service.recoverAsyncDoneCompensations()).resolves.toMatchObject({ checked: 0, skipped: 1 });
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('async-return for an already settled order (#87)', () => {
    it('skips the provider query and order lease when the same payment is already issued', async () => {
      db.select
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', userId: 'buyer-a', status: 'CONFIRMED' }]))
        .mockImplementationOnce(() => selectChain([{ id: 'payment-1', paymentKey: 'pay_done', status: 'DONE' }]));

      await service.reconcileAsyncPaymentReturn({
        orderId: 'GRP-DONE', paymentKey: 'pay_done', provider: 'ALIPAY_PLUS', userId: 'buyer-a',
      });

      expect(tossClient.queryPayment).not.toHaveBeenCalled();
      expect(bookingService.acquirePaymentConfirmLock).not.toHaveBeenCalled();
      expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId: 'reservation-1', paymentId: 'payment-1',
      });
    });

    it('still reconciles through the provider when the confirmed order has a different paymentKey', async () => {
      db.select
        .mockImplementationOnce(() => selectChain([{ id: 'reservation-1', userId: 'buyer-a', status: 'CONFIRMED' }]))
        .mockImplementationOnce(() => selectChain([{ id: 'payment-1', paymentKey: 'pay_other', status: 'DONE' }]));
      tossClient.queryPayment.mockRejectedValueOnce(new Error('provider unavailable'));

      await expect(service.reconcileAsyncPaymentReturn({
        orderId: 'GRP-DONE', paymentKey: 'pay_new', provider: 'ALIPAY_PLUS', userId: 'buyer-a',
      })).rejects.toThrow('provider unavailable');
      expect(tossClient.queryPayment).toHaveBeenCalledWith('pay_new', { secretKeyScope: 'foreign-easy-pay' });
    });
  });

  describe('PayPal DONE webhook charge verification (#1)', () => {
    function paypalFixture() {
      db.select
        .mockImplementationOnce(() => selectChain([{
          id: 'reservation-1',
          userId: 'buyer-a',
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: new Date('2026-10-01T00:00:00.000Z'),
        }]))
        .mockImplementationOnce(() => selectChain([{
          id: 'payment-1', reservationId: 'reservation-1', paymentKey: 'pay_paypal', tossOrderId: 'GRP-PAYPAL',
          provider: 'PAYPAL', amount: 150000, status: 'DONE',
        }]))
        .mockImplementationOnce(() => selectChain([{ seatId: '1F:A-1', tierName: 'VIP', price: 148000, row: 'A', number: '1' }]));
    }

    function paypalDone(currency: string) {
      return service.upsertAsyncPaymentProgress(
        {
          eventId: `evt-paypal-${currency}`,
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_paypal', orderId: 'GRP-PAYPAL', status: 'DONE', method: '해외간편결제',
            provider: 'PAYPAL', currency, totalAmount: 108,
          },
        },
        'DONE',
        'payment_status_changed:done',
      );
    }

    it('flags a PayPal DONE whose provider charge is KRW for a USD-quoted reservation', async () => {
      paypalFixture();

      await expect(paypalDone('KRW')).resolves.toBe('PAYPAL_DONE_AMOUNT_MISMATCH');

      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('acknowledges a PayPal DONE whose USD charge matches the stored quote', async () => {
      paypalFixture();

      await expect(paypalDone('USD')).resolves.toBeUndefined();

      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });
});
