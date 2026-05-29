import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PaymentMethod } from '@grabit/shared';
import { ticketItems } from '../../database/schema/index.js';
import { PaymentService } from './payment.service.js';

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  };
}

function createSelectChain<T>(rows: T[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  return chain;
}

function createMutationChain<T>(returningRows: T[] = []) {
  const chain = {
    set: vi.fn(),
    values: vi.fn(),
    where: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.values.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  chain.returning.mockResolvedValue(returningRows);
  return chain;
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

describe('PaymentService', () => {
  let service: PaymentService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockBookingGateway: {
    broadcastSeatUpdate: ReturnType<typeof vi.fn>;
  };
  let mockQrTicketService: {
    ensureIssuedTicketsForReservation: ReturnType<typeof vi.fn>;
  };
  let mockTossClient: {
    cancelPayment: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDb = createMockDb();
    mockBookingGateway = {
      broadcastSeatUpdate: vi.fn(),
    };
    mockQrTicketService = {
      ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([]),
    };
    mockTossClient = {
      cancelPayment: vi.fn().mockResolvedValue({}),
    };
    service = new PaymentService(
      mockDb as any,
      mockBookingGateway as any,
      mockQrTicketService as any,
    );
    (service as unknown as { tossClient: typeof mockTossClient }).tossClient = mockTossClient;
  });

  describe('amount validation', () => {
    it('should reject when server-calculated amount differs from client amount', async () => {
      const reservationId = randomUUID();

      // Mock: payment lookup returns existing payment with amount 150000
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: randomUUID(),
            reservationId,
            paymentKey: 'pk_test_123',
            tossOrderId: 'GRP-20260403-ABCDE',
            method: '카드',
            amount: 150000,
            status: 'DONE',
            paidAt: new Date(),
            createdAt: new Date(),
          }]),
        }),
      });

      const result = await service.getPaymentByReservationId(reservationId);
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(150000);
    });
  });

  describe('failure', () => {
    it('should return null for non-existent reservation payment', async () => {
      const reservationId = randomUUID();

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getPaymentByReservationId(reservationId);
      expect(result).toBeNull();
    });
  });

  describe('prepareTossPaymentBranch', () => {
    function createPaymentMethod(
      overrides: Partial<PaymentMethod> = {},
    ): PaymentMethod {
      return {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        ...overrides,
      };
    }

    it('keeps domestic card on the synchronous confirm branch', () => {
      const branch = service.prepareTossPaymentBranch({
        orderId: 'GRP-DOMESTIC-CARD',
        paymentMethod: createPaymentMethod(),
        successUrl: 'https://grabit.test/booking/perf-1/complete',
        failUrl: 'https://grabit.test/booking/perf-1/confirm?error=true',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-DOMESTIC-CARD',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        asyncStatus: 'sync',
      });
      expect(branch.useInternationalCardOnly).toBe(false);
      expect(branch.pendingUrl).toBeUndefined();
    });

    it('routes overseas card through CARD with useInternationalCardOnly=true', () => {
      const branch = service.prepareTossPaymentBranch({
        orderId: 'GRP-FOREIGN-CARD',
        paymentMethod: createPaymentMethod({
          currency: 'USD',
          overseasPaymentConsent: {
            required: true,
            agreed: true,
            agreementVersion: '2026-05-08',
          },
        }),
        successUrl: 'https://grabit.test/booking/perf-1/complete',
        failUrl: 'https://grabit.test/booking/perf-1/confirm?error=true',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-FOREIGN-CARD',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        asyncStatus: 'sync',
        useInternationalCardOnly: true,
      });
      expect(branch.pendingUrl).toBeUndefined();
    });

    it('routes foreign easy-pay through pendingUrl + async webhook tracking', () => {
      const branch = service.prepareTossPaymentBranch({
        orderId: 'GRP-ALIPAY',
        paymentMethod: createPaymentMethod({
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          pendingUrlRequired: true,
          overseasPaymentConsent: {
            required: true,
            agreed: true,
            agreementVersion: '2026-05-08',
          },
        }),
        successUrl: 'https://grabit.test/booking/perf-1/complete',
        failUrl: 'https://grabit.test/booking/perf-1/confirm?error=true',
        pendingUrl: 'https://grabit.test/booking/perf-1/pending?orderId=GRP-ALIPAY',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-ALIPAY',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        asyncStatus: 'pending_webhook',
        pendingUrl:
          'https://grabit.test/booking/perf-1/pending?orderId=GRP-ALIPAY',
      });
      expect(branch.useInternationalCardOnly).toBe(false);
    });

    it('routes PayPal through pendingUrl + async webhook tracking', () => {
      const branch = service.prepareTossPaymentBranch({
        orderId: 'GRP-PAYPAL',
        paymentMethod: createPaymentMethod({
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL',
          currency: 'USD',
          pendingUrlRequired: true,
          overseasPaymentConsent: {
            required: true,
            agreed: true,
            agreementVersion: '2026-05-08',
          },
        }),
        successUrl: 'https://grabit.test/booking/perf-1/complete',
        failUrl: 'https://grabit.test/booking/perf-1/confirm?error=true',
        pendingUrl: 'https://grabit.test/booking/perf-1/pending?orderId=GRP-PAYPAL',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-PAYPAL',
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'USD',
        asyncStatus: 'pending_webhook',
        pendingUrl:
          'https://grabit.test/booking/perf-1/pending?orderId=GRP-PAYPAL',
      });
      expect(branch.useInternationalCardOnly).toBe(false);
    });

    it('rejects foreign easy-pay when pendingUrl is missing', () => {
      expect(() =>
        service.prepareTossPaymentBranch({
          orderId: 'GRP-NO-PENDING',
          paymentMethod: createPaymentMethod({
            method: 'FOREIGN_EASY_PAY',
            provider: 'TRUEMONEY',
            currency: 'THB',
            pendingUrlRequired: true,
          }),
          successUrl: 'https://grabit.test/booking/perf-1/complete',
          failUrl: 'https://grabit.test/booking/perf-1/confirm?error=true',
        }),
      ).toThrow(new BadRequestException('FOREIGN_EASY_PAY 결제는 pendingUrl이 필요합니다'));
    });
  });

  describe('upsertAsyncPaymentProgress', () => {
    it('finalizes async DONE webhook by confirming reservation, selling seats, and issuing QR ticket', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const insertPayment = createMutationChain([{ id: paymentId }]);
      const insertTicketItems = createMutationChain();
      const updateFirstSeat = createMutationChain([]);
      const insertFirstSeat = createMutationChain([{ id: randomUUID() }]);
      const updateSecondSeat = createMutationChain([{ id: randomUUID() }]);

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 154000,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: '2F:B-2', tierName: 'R', price: 50000, row: 'B', number: '2' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updateFirstSeat)
        .mockReturnValueOnce(updateSecondSeat);
      tx.insert
        .mockReturnValueOnce(insertPayment)
        .mockReturnValueOnce(insertTicketItems)
        .mockReturnValueOnce(insertFirstSeat);

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-done',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_async_done',
            orderId: 'GRP-ASYNC-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY',
            currency: 'USD',
            totalAmount: 154000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      );

      expect(updateReservation.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CONFIRMED' }),
      );
      expect(insertPayment.values).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId,
          paymentKey: 'pay_async_done',
          tossOrderId: 'GRP-ASYNC-DONE',
          amount: 154000,
          status: 'DONE',
          asyncStatus: 'payment_status_changed:done',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
        }),
      );
      expect(updateFirstSeat.where.mock.calls.some((args) =>
        args.some((arg) => sqlPredicateHasParamValue(arg, 'available')),
      )).toBe(true);
      expect(updateSecondSeat.where.mock.calls.some((args) =>
        args.some((arg) => sqlPredicateHasParamValue(arg, 'available')),
      )).toBe(true);
      expect(tx.insert).toHaveBeenCalledWith(ticketItems);
      expect(insertTicketItems.values).toHaveBeenCalledWith([
        expect.objectContaining({
          reservationId,
          paymentId,
          showtimeId,
          seatId: 'A-1',
          seatKey: '1F:A-1',
          floorKey: '1F',
          floorLabel: '1층',
          tierName: 'VIP',
          row: 'A',
          number: '1',
          price: 100000,
          serviceFee: 2000,
          status: 'active',
          admissionState: 'not_entered',
        }),
        expect.objectContaining({
          reservationId,
          paymentId,
          showtimeId,
          seatId: 'B-2',
          seatKey: '2F:B-2',
          floorKey: '2F',
          floorLabel: '2F',
          tierName: 'R',
          row: 'B',
          number: '2',
          price: 50000,
          serviceFee: 2000,
          status: 'active',
          admissionState: 'not_entered',
        }),
      ]);
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
        showtimeId,
        '1F:A-1',
        'sold',
        userId,
      );
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
        showtimeId,
        '2F:B-2',
        'sold',
        userId,
      );
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId,
      });
    });

    it('rejects amount-mismatched DONE webhook without finalizing reservation state', async () => {
      const reservationId = randomUUID();
      const insertRejectedPayment = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 73000, row: 'A', number: '1' },
          { seatId: '1F:A-2', tierName: 'VIP', price: 73000, row: 'A', number: '2' },
        ]));
      mockDb.insert.mockReturnValueOnce(insertRejectedPayment);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-underpaid',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_underpaid',
            orderId: 'GRP-UNDERPAID',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 149000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('금액이 일치하지 않습니다');

      expect(insertRejectedPayment.values).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId,
          paymentKey: 'pay_underpaid',
          amount: 149000,
          status: 'ABORTED',
          asyncStatus: 'payment_amount_mismatch',
        }),
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('rejects seat-only legacy DONE webhook amount before finalizing reservation state', async () => {
      const reservationId = randomUUID();
      const insertRejectedPayment = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'PENDING_PAYMENT',
          totalAmount: 200000,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: '1F:A-2', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
        ]));
      mockDb.insert.mockReturnValueOnce(insertRejectedPayment);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-seat-only',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_seat_only',
            orderId: 'GRP-SEAT-ONLY',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 200000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('금액이 일치하지 않습니다');

      expect(insertRejectedPayment.values).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId,
          paymentKey: 'pay_seat_only',
          amount: 200000,
          status: 'ABORTED',
          asyncStatus: 'payment_amount_mismatch',
        }),
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('cancels captured async DONE payment when disabled seats block finalization', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const insertPayment = createMutationChain([{ id: randomUUID() }]);
      const insertTicketItems = createMutationChain();
      const updateFirstSeat = createMutationChain([]);
      const insertFirstSeat = createMutationChain([]);
      const insertCanceledPayment = createMutationChain();
      const failReservation = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updateFirstSeat);
      tx.insert
        .mockReturnValueOnce(insertPayment)
        .mockReturnValueOnce(insertTicketItems)
        .mockReturnValueOnce(insertFirstSeat);
      mockDb.insert.mockReturnValueOnce(insertCanceledPayment);
      mockDb.update.mockReturnValueOnce(failReservation);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-done-disabled-seat',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_async_done',
            orderId: 'GRP-ASYNC-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 102000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('판매 불가능한 좌석입니다');

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_async_done',
        expect.stringContaining('판매 불가능'),
        {
          idempotencyKey: 'toss-webhook:evt-payment-done-disabled-seat:seat-failure-cancel',
        },
      );
      expect(insertCanceledPayment.values).toHaveBeenCalledWith(expect.objectContaining({
        reservationId,
        paymentKey: 'pay_async_done',
        tossOrderId: 'GRP-ASYNC-DONE',
        status: 'CANCELED',
        cancelReason: expect.stringContaining('판매 불가능'),
      }));
      expect(failReservation.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'FAILED',
      }));
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('retries QR issuance for already confirmed async DONE webhook replays', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId: randomUUID(),
          status: 'CONFIRMED',
          totalAmount: 154000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_async_done',
          tossOrderId: 'GRP-ASYNC-DONE',
          amount: 154000,
          status: 'DONE',
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: '2F:B-2', tierName: 'R', price: 50000, row: 'B', number: '2' },
        ]));

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-done-retry',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_async_done',
            orderId: 'GRP-ASYNC-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 154000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      );

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId,
      });
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('rejects confirmed replay when reservation, payment, and webhook amounts omit service fees', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const updateRejectedPayment = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'CONFIRMED',
          totalAmount: 200000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_async_done',
          tossOrderId: 'GRP-ASYNC-DONE',
          amount: 200000,
          status: 'DONE',
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: '1F:A-2', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
        ]));
      mockDb.update.mockReturnValueOnce(updateRejectedPayment);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-confirmed-seat-only',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_async_done',
            orderId: 'GRP-ASYNC-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 200000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('금액이 일치하지 않습니다');

      expect(updateRejectedPayment.set).toHaveBeenCalledWith(expect.objectContaining({
        amount: 200000,
        status: 'ABORTED',
        asyncStatus: 'payment_amount_mismatch',
      }));
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('rejects confirmed DONE webhook replays with mismatched payment identity', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'CONFIRMED',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_original_done',
          tossOrderId: 'GRP-ASYNC-DONE',
          amount: 150000,
          status: 'DONE',
        }]));

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-done-mismatch',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_different_done',
            orderId: 'GRP-ASYNC-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 150000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('결제 정보가 예매와 일치하지 않습니다');

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('rejects amount-mismatched DONE replays before mutating an existing payment identity', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'CONFIRMED',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_original_done',
          tossOrderId: 'GRP-ASYNC-DONE',
          amount: 150000,
          status: 'DONE',
        }]));

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-payment-done-amount-identity-mismatch',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_different_done',
            orderId: 'GRP-ASYNC-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 149000,
            approvedAt: '2026-05-08T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('결제 정보가 예매와 일치하지 않습니다');

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });
  });
});
