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
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
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
  const seen = new Set<unknown>();

  function visit(candidateValue: unknown): boolean {
    if (candidateValue === value) {
      return true;
    }
    if (candidateValue === null || candidateValue === undefined) {
      return false;
    }
    if (Array.isArray(candidateValue)) {
      return candidateValue.some(visit);
    }
    if (typeof candidateValue !== 'object') {
      return false;
    }
    if (seen.has(candidateValue)) {
      return false;
    }
    seen.add(candidateValue);

    const candidate = candidateValue as {
      constructor?: { name?: string };
      value?: unknown;
    };
    if (candidate.constructor?.name === 'Param') {
      return visit(candidate.value);
    }

    return Object.values(candidateValue as Record<string, unknown>).some(visit);
  }

  return visit(predicate);
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
  let mockBookingService: {
    acquireRecoverySeatLocks: ReturnType<typeof vi.fn>;
    releaseRecoverySeatLocks: ReturnType<typeof vi.fn>;
  };
  let mockTossClient: {
    cancelPayment: ReturnType<typeof vi.fn>;
    queryPayment: ReturnType<typeof vi.fn>;
    getOverseasCardAvailability: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDb = createMockDb();
    mockBookingGateway = {
      broadcastSeatUpdate: vi.fn(),
    };
    mockQrTicketService = {
      ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([]),
    };
    mockBookingService = {
      acquireRecoverySeatLocks: vi.fn().mockResolvedValue({ acquired: true }),
      releaseRecoverySeatLocks: vi.fn().mockResolvedValue(undefined),
    };
    mockTossClient = {
      cancelPayment: vi.fn().mockResolvedValue({}),
      queryPayment: vi.fn(),
      getOverseasCardAvailability: vi.fn().mockReturnValue({ enabled: true }),
    };
    service = new PaymentService(
      mockDb as any,
      mockBookingGateway as any,
      mockQrTicketService as any,
    );
    (service as unknown as { bookingService: typeof mockBookingService }).bookingService =
      mockBookingService;
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

  describe('findPaymentCancelSnapshotByCancelRequestId', () => {
    it('resolves generated cancel request ids that point directly at a payment id', async () => {
      const paymentId = randomUUID();
      const payment = {
        id: paymentId,
        paymentKey: 'pay_async_1',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        amount: 150000,
        providerMetadata: null,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
      };
      const paymentLookup = createSelectChain([payment]);

      mockDb.select
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(paymentLookup);

      const result = await service.findPaymentCancelSnapshotByCancelRequestId(
        `cancel_${paymentId}`,
      );

      expect(result).toEqual(payment);
      expect(paymentLookup.where).toHaveBeenCalledOnce();
      expect(sqlPredicateHasParamValue(
        paymentLookup.where.mock.calls[0]?.[0],
        paymentId,
      )).toBe(true);
    });
  });

  describe('markWebhookEventFailed', () => {
    it('truncates long processing messages to fit the webhook ledger column', async () => {
      const mutation = createMutationChain();
      mockDb.update.mockReturnValue(mutation);

      await service.markWebhookEventFailed(
        'whtrans-long-message',
        'PROCESSING_FAILED',
        'x'.repeat(600),
      );

      expect(mutation.set).toHaveBeenCalledWith({
        processingResultCode: 'PROCESSING_FAILED',
        processingResultMessage: `${'x'.repeat(497)}...`,
      });
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

    it('keeps domestic card on the synchronous confirm branch', async () => {
      const branch = await service.prepareTossPaymentBranch({
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

    it('routes overseas card through CARD in KRW without a provider charge quote', async () => {
      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-FOREIGN-CARD',
        paymentMethod: createPaymentMethod({
          currency: 'KRW',
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
      expect(branch.providerChargeQuote).toBeUndefined();
      expect(branch.checkoutEnabled).toBe(true);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('disables overseas card checkout when the scoped server secret is missing', async () => {
      mockTossClient.getOverseasCardAvailability.mockReturnValueOnce({
        enabled: false,
        disabledReason: 'OVERSEAS_CARD_SECRET_KEY_MISSING',
      });

      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-FOREIGN-CARD-NO-SECRET',
        paymentMethod: createPaymentMethod({
          currency: 'KRW',
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
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        useInternationalCardOnly: true,
        checkoutEnabled: false,
        disabledReason: 'OVERSEAS_CARD_SECRET_KEY_MISSING',
      });
      expect(branch.providerChargeQuote).toBeUndefined();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('routes foreign easy-pay through pendingUrl + async webhook tracking', async () => {
      const branch = await service.prepareTossPaymentBranch({
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

    it('routes Alipay through async webhook checkout with the stored provider quote', async () => {
      (service as unknown as {
        providerChargeQuoteService: {
          getForeignEasyPayAvailability: ReturnType<typeof vi.fn>;
        };
      }).providerChargeQuoteService = {
        getForeignEasyPayAvailability: vi.fn().mockReturnValue({ enabled: true }),
      };
      mockDb.select.mockReturnValue(createSelectChain([{
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerChargeRate: '0.00072',
        providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
      }]));

      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-ALIPAY-QUOTE',
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
        pendingUrl: 'https://grabit.test/booking/perf-1/complete?pending=true&orderId=GRP-ALIPAY-QUOTE',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-ALIPAY-QUOTE',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        asyncStatus: 'pending_webhook',
        pendingUrl:
          'https://grabit.test/booking/perf-1/complete?pending=true&orderId=GRP-ALIPAY-QUOTE',
        checkoutEnabled: true,
        providerChargeQuote: {
          currency: 'USD',
          amountMinor: 10800,
          amountDecimal: '108.00',
        },
      });
      expect(branch.useInternationalCardOnly).toBe(false);
    });

    it('keeps Alipay checkout disabled when the Alipay provider flag is off', async () => {
      const providerChargeQuoteService = {
        getAlipayAvailability: vi.fn().mockReturnValue({
          enabled: false,
          disabledReason: 'ALIPAY_CHECKOUT_DISABLED',
        }),
        getForeignEasyPayAvailability: vi.fn().mockReturnValue({ enabled: true }),
      };
      (service as unknown as {
        providerChargeQuoteService: typeof providerChargeQuoteService;
      }).providerChargeQuoteService = providerChargeQuoteService;
      mockDb.select.mockReturnValue(createSelectChain([{
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerChargeRate: '0.00072',
        providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
      }]));

      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-ALIPAY-DISABLED',
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
        pendingUrl: 'https://grabit.test/booking/perf-1/complete?pending=true&orderId=GRP-ALIPAY-DISABLED',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-ALIPAY-DISABLED',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        asyncStatus: 'pending_webhook',
        checkoutEnabled: false,
        disabledReason: 'ALIPAY_CHECKOUT_DISABLED',
      });
      expect(branch.providerChargeQuote).toBeUndefined();
      expect(providerChargeQuoteService.getAlipayAvailability).toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('keeps TrueMoney on the async webhook branch', async () => {
      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-TRUEMONEY',
        paymentMethod: createPaymentMethod({
          method: 'FOREIGN_EASY_PAY',
          provider: 'TRUEMONEY',
          currency: 'THB',
          pendingUrlRequired: true,
          overseasPaymentConsent: {
            required: true,
            agreed: true,
            agreementVersion: '2026-05-08',
          },
        }),
        successUrl: 'https://grabit.test/booking/perf-1/complete',
        failUrl: 'https://grabit.test/booking/perf-1/confirm?error=true',
        pendingUrl: 'https://grabit.test/booking/perf-1/pending?orderId=GRP-TRUEMONEY',
      });

      expect(branch).toMatchObject({
        orderId: 'GRP-TRUEMONEY',
        method: 'FOREIGN_EASY_PAY',
        provider: 'TRUEMONEY',
        currency: 'THB',
        asyncStatus: 'pending_webhook',
        pendingUrl:
          'https://grabit.test/booking/perf-1/pending?orderId=GRP-TRUEMONEY',
      });
      expect(branch.useInternationalCardOnly).toBe(false);
    });

    it('routes PayPal through sync checkout with stored provider quote', async () => {
      (service as unknown as {
        providerChargeQuoteService: {
          getPaypalAvailability: ReturnType<typeof vi.fn>;
        };
      }).providerChargeQuoteService = {
        getPaypalAvailability: vi.fn().mockReturnValue({ enabled: true }),
      };
      mockDb.select.mockReturnValue(createSelectChain([{
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerChargeRate: '0.00072',
        providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
      }]));

      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-PAYPAL',
        paymentMethod: createPaymentMethod({
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL',
          currency: 'EUR',
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
        orderId: 'GRP-PAYPAL',
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'USD',
        asyncStatus: 'sync',
        checkoutEnabled: true,
        providerChargeQuote: {
          currency: 'USD',
          amountMinor: 10800,
          amountDecimal: '108.00',
          rate: '0.00072',
          quotedAt: '2026-05-29T10:00:00.000Z',
        },
      });
      expect(branch.useInternationalCardOnly).toBe(false);
      expect(branch.pendingUrl).toBeUndefined();
    });

    it('keeps PayPal checkout disabled when the stored provider quote is missing', async () => {
      (service as unknown as {
        providerChargeQuoteService: {
          getPaypalAvailability: ReturnType<typeof vi.fn>;
        };
      }).providerChargeQuoteService = {
        getPaypalAvailability: vi.fn().mockReturnValue({ enabled: true }),
      };
      mockDb.select.mockReturnValue(createSelectChain([]));

      const branch = await service.prepareTossPaymentBranch({
        orderId: 'GRP-PAYPAL-NO-QUOTE',
        paymentMethod: createPaymentMethod({
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL',
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
        orderId: 'GRP-PAYPAL-NO-QUOTE',
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        asyncStatus: 'sync',
        checkoutEnabled: false,
        disabledReason: 'PAYPAL_PROVIDER_CHARGE_QUOTE_MISSING',
      });
      expect(branch.providerChargeQuote).toBeUndefined();
    });

    it('rejects foreign easy-pay when pendingUrl is missing', async () => {
      await expect(
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
      ).rejects.toThrow(
        new BadRequestException('FOREIGN_EASY_PAY 결제는 pendingUrl이 필요합니다'),
      );
    });
  });

  describe('upsertAsyncPaymentProgress', () => {
    function createConfirmedCancelWebhookPayload(
      paymentKey: string,
      orderId: string,
      cancelRequestId?: string,
    ) {
      return {
        eventId: 'evt-paypal-cancelled',
        eventType: 'CANCEL_STATUS_CHANGED' as const,
        data: {
          paymentKey,
          orderId,
          status: 'CANCELED',
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL' as const,
          currency: 'USD',
          totalAmount: 108,
          canceledAt: '2026-05-29T08:05:00.000Z',
          cancelReason: 'provider cancellation',
          ...(cancelRequestId ? { cancelRequestId } : {}),
        },
      };
    }

    function createConfirmedCancelProviderResponse(
      paymentKey: string,
      orderId: string,
    ) {
      return {
        paymentKey,
        orderId,
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 108,
        status: 'CANCELED',
        approvedAt: '2026-05-29T08:00:00.000Z',
        cancels: [
          {
            cancelAmount: 108,
            cancelReason: 'provider cancellation',
            canceledAt: '2026-05-29T08:05:00.000Z',
            cancelStatus: 'DONE',
          },
        ],
      };
    }

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

    it('records live Alipay failed webhook as foreign easy pay from easyPay payload', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const providerChargeQuotedAt = new Date('2026-06-04T01:17:34.000Z');
      const insertPayment = createMutationChain();
      const updateReservation = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 82000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 5576,
          providerChargeRate: '0.00068',
          providerChargeQuotedAt,
        }]))
        .mockReturnValueOnce(createSelectChain([]));
      mockDb.insert.mockReturnValueOnce(insertPayment);
      mockDb.update.mockReturnValueOnce(updateReservation);

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-live-alipay-aborted',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_live_alipay',
            orderId: 'GRP-LIVE-ALIPAY',
            status: 'ABORTED',
            method: '해외간편결제',
            easyPay: '알리페이',
            currency: 'USD',
            totalAmount: 55.76,
          },
        },
        'ABORTED',
        'payment_status_changed:aborted',
      );

      expect(insertPayment.values).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId,
          paymentKey: 'pay_live_alipay',
          tossOrderId: 'GRP-LIVE-ALIPAY',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'KRW',
          amount: 82000,
          status: 'ABORTED',
          asyncStatus: 'payment_status_changed:aborted',
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 5576,
        }),
      );
      expect(updateReservation.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'FAILED' }),
      );
    });

    it('finalizes Alipay DONE webhook only when provider totalAmount matches the stored USD quote', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const quotedAt = new Date('2026-05-29T10:00:00.000Z');
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const insertPayment = createMutationChain([{ id: paymentId }]);
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([{ id: randomUUID() }]);

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: quotedAt,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 148000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updateSeat);
      tx.insert
        .mockReturnValueOnce(insertPayment)
        .mockReturnValueOnce(insertTicketItems);

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-done-provider-quote',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_alipay_provider_quote',
            orderId: 'GRP-ALIPAY-PROVIDER-QUOTE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY',
            currency: 'USD',
            totalAmount: 108,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      );

      expect(insertPayment.values).toHaveBeenCalledWith(expect.objectContaining({
        reservationId,
        paymentKey: 'pay_alipay_provider_quote',
        tossOrderId: 'GRP-ALIPAY-PROVIDER-QUOTE',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'KRW',
        amount: 150000,
        status: 'DONE',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerChargeRate: '0.00072',
        providerChargeQuotedAt: quotedAt,
      }));
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId,
      });
    });

    it('recovers Alipay DONE webhook with a new paymentKey for the same orderId', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const quotedAt = new Date('2026-05-29T10:00:00.000Z');
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const updatePayment = createMutationChain();
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([{ id: randomUUID() }]);

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: quotedAt,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_old_expired',
          tossOrderId: 'GRP-ALIPAY-RECOVER',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'KRW',
          amount: 150000,
          status: 'EXPIRED',
          providerMetadata: null,
          providerChargeAmountMinor: 10800,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 148000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updatePayment)
        .mockReturnValueOnce(updateSeat);
      tx.insert.mockReturnValueOnce(insertTicketItems);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-payment-key-recovery',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_new_done',
            orderId: 'GRP-ALIPAY-RECOVER',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY',
            currency: 'USD',
            totalAmount: 108,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBe('DONE_RECOVERED_PAYMENT_KEY');

      expect(updatePayment.set).toHaveBeenCalledWith(expect.objectContaining({
        paymentKey: 'pay_new_done',
        tossOrderId: 'GRP-ALIPAY-RECOVER',
        status: 'DONE',
        asyncStatus: 'payment_status_changed:done',
        providerMetadata: expect.objectContaining({
          paymentKeyRecovery: expect.objectContaining({
            previousPaymentKey: 'pay_old_expired',
            eventId: 'evt-alipay-payment-key-recovery',
          }),
        }),
      }));
      expect(insertTicketItems.values).toHaveBeenCalledWith([
        expect.objectContaining({
          reservationId,
          paymentId,
          seatKey: '1F:A-1',
          status: 'active',
        }),
      ]);
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId,
      });
    });

    it('recovers Alipay DONE webhook for an already failed reservation when the seat is still available', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const updatePayment = createMutationChain();
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([{ id: randomUUID() }]);

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'FAILED',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_old_expired',
          tossOrderId: 'GRP-ALIPAY-LATE-DONE',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 102000,
          status: 'EXPIRED',
          providerMetadata: null,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updatePayment)
        .mockReturnValueOnce(updateSeat);
      tx.insert.mockReturnValueOnce(insertTicketItems);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-late-done',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_late_done',
            orderId: 'GRP-ALIPAY-LATE-DONE',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 102000,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBe('DONE_RECOVERED_PAYMENT_KEY');

      expect(updateReservation.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CONFIRMED' }),
      );
      expect(updatePayment.set).toHaveBeenCalledWith(expect.objectContaining({
        paymentKey: 'pay_late_done',
        status: 'DONE',
      }));
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId,
      });
    });

    it('rejects Alipay paymentKey recovery when the new key belongs to another reservation', async () => {
      const reservationId = randomUUID();
      const otherReservationId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'PENDING_PAYMENT',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([
          {
            id: randomUUID(),
            reservationId,
            paymentKey: 'pay_old_expired',
            tossOrderId: 'GRP-ALIPAY-CONFLICT',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            amount: 102000,
            status: 'EXPIRED',
            providerMetadata: null,
          },
          {
            id: randomUUID(),
            reservationId: otherReservationId,
            paymentKey: 'pay_other_reservation',
            tossOrderId: 'GRP-OTHER-ORDER',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            amount: 102000,
            status: 'DONE',
            providerMetadata: null,
          },
        ]));

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-conflicting-key',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_other_reservation',
            orderId: 'GRP-ALIPAY-CONFLICT',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 102000,
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('결제 정보가 예매와 일치하지 않습니다');
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('does not recover ambiguous foreign easy pay DONE webhooks for persisted PayPal payments', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'FAILED',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_paypal_done',
          tossOrderId: 'GRP-PAYPAL-AMBIGUOUS',
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL',
          currency: 'USD',
          amount: 102000,
          status: 'EXPIRED',
          providerMetadata: { requestedProvider: 'PAYPAL' },
        }]));

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-paypal-ambiguous-done',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_paypal_done',
            orderId: 'GRP-PAYPAL-AMBIGUOUS',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            currency: 'USD',
            totalAmount: 102000,
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBeUndefined();

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('finalizes overseas-card DONE webhook when provider totalAmount matches the stored USD quote', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const quotedAt = new Date('2026-06-05T01:00:00.000Z');
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const insertPayment = createMutationChain([{ id: paymentId }]);
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([{ id: randomUUID() }]);

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: quotedAt,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 148000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updateSeat);
      tx.insert
        .mockReturnValueOnce(insertPayment)
        .mockReturnValueOnce(insertTicketItems);

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-overseas-card-done-provider-quote',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_overseas_card_provider_quote',
            orderId: 'GRP-OVERSEAS-CARD-PROVIDER-QUOTE',
            status: 'DONE',
            method: 'CARD',
            provider: 'CARD',
            currency: 'USD',
            totalAmount: 108,
            approvedAt: '2026-06-05T01:00:05.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      );

      expect(insertPayment.values).toHaveBeenCalledWith(expect.objectContaining({
        reservationId,
        paymentKey: 'pay_overseas_card_provider_quote',
        tossOrderId: 'GRP-OVERSEAS-CARD-PROVIDER-QUOTE',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        amount: 150000,
        status: 'DONE',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
      }));
    });

    it('reconciles Alipay pending return by querying Toss and finalizing the async payment', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const quotedAt = new Date('2026-05-29T10:00:00.000Z');
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const insertPayment = createMutationChain([{ id: paymentId }]);
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([{ id: randomUUID() }]);

      mockTossClient.queryPayment.mockResolvedValueOnce({
        paymentKey: 'pay_alipay_return',
        orderId: 'GRP-ALIPAY-RETURN',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 108,
        status: 'DONE',
        approvedAt: '2026-05-29T08:00:00.000Z',
      });
      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          status: 'PENDING_PAYMENT',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: quotedAt,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 148000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updateSeat);
      tx.insert
        .mockReturnValueOnce(insertPayment)
        .mockReturnValueOnce(insertTicketItems);

      await (service as unknown as {
        reconcileAsyncPaymentReturn: (input: {
          orderId: string;
          paymentKey: string;
          amount: number;
          provider: 'ALIPAY_PLUS';
          userId: string;
        }) => Promise<void>;
      }).reconcileAsyncPaymentReturn({
        orderId: 'GRP-ALIPAY-RETURN',
        paymentKey: 'pay_alipay_return',
        amount: 108,
        provider: 'ALIPAY_PLUS',
        userId,
      });

      expect(mockTossClient.queryPayment).toHaveBeenCalledWith('pay_alipay_return', {
        secretKeyScope: 'foreign-easy-pay',
      });
      expect(insertPayment.values).toHaveBeenCalledWith(expect.objectContaining({
        reservationId,
        paymentKey: 'pay_alipay_return',
        tossOrderId: 'GRP-ALIPAY-RETURN',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'KRW',
        amount: 150000,
        status: 'DONE',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
      }));
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId,
      });
    });

    it('rejects Alipay DONE webhook when provider totalAmount differs from the stored USD quote', async () => {
      const reservationId = randomUUID();
      const insertRejectedPayment = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 148000, row: 'A', number: '1' },
        ]));
      mockDb.insert.mockReturnValueOnce(insertRejectedPayment);

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-provider-mismatch',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_alipay_provider_mismatch',
            orderId: 'GRP-ALIPAY-PROVIDER-MISMATCH',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 107.99,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).rejects.toThrow('결제 금액이 일치하지 않습니다');

      expect(insertRejectedPayment.values).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId,
          paymentKey: 'pay_alipay_provider_mismatch',
          amount: 150000,
          status: 'ABORTED',
          asyncStatus: 'payment_amount_mismatch',
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
        }),
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
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

    it('acks PayPal DONE webhook before sync confirm without creating async payment rows', async () => {
      const reservationId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([]));

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-paypal-done-before-confirm',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_paypal_before_confirm',
            orderId: 'GRP-PAYPAL-BEFORE-CONFIRM',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'PAYPAL',
            currency: 'USD',
            totalAmount: 108,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      );

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('acks PayPal IN_PROGRESS webhook before sync confirm without creating async payment rows', async () => {
      const reservationId = randomUUID();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId: randomUUID(),
          showtimeId: randomUUID(),
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([]));

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-paypal-in-progress-before-confirm',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_paypal_in_progress',
            orderId: 'GRP-PAYPAL-IN-PROGRESS',
            status: 'IN_PROGRESS',
            method: 'FOREIGN_EASY_PAY',
            provider: 'PAYPAL',
            currency: 'USD',
            totalAmount: 108,
          },
        },
        'IN_PROGRESS',
        'payment_status_changed:in_progress',
      );

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('applies PayPal cancel webhook without overwriting the stored KRW payment amount', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const updatePayment = createMutationChain();

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
          paymentKey: 'pay_paypal_cancelled',
          tossOrderId: 'GRP-PAYPAL-CANCELLED',
          amount: 150000,
          status: 'DONE',
        }]));
      mockDb.update.mockReturnValueOnce(updatePayment);

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-paypal-cancelled',
          eventType: 'CANCEL_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_paypal_cancelled',
            orderId: 'GRP-PAYPAL-CANCELLED',
            status: 'CANCELED',
            method: 'FOREIGN_EASY_PAY',
            provider: 'PAYPAL',
            currency: 'USD',
            totalAmount: 108,
            canceledAt: '2026-05-29T08:05:00.000Z',
            cancelReason: 'provider cancellation',
          },
        },
        'CANCELED',
        'cancelled_webhook',
      );

      expect(updatePayment.set).toHaveBeenCalledWith(expect.objectContaining({
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'KRW',
        amount: 150000,
        status: 'CANCELED',
        asyncStatus: 'cancelled_webhook',
        cancelReason: 'provider cancellation',
      }));
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });

    it('finalizes a confirmed cancel webhook with the shared cancellation finalizer', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const finalizer = {
        finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
          releaseJobId: 'release-job-1',
          releaseEnqueued: true,
        }),
      };
      (service as unknown as {
        paymentCancellationFinalizer: typeof finalizer;
      }).paymentCancellationFinalizer = finalizer;

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          reservationNumber: 'GRP-20260508-ABCDE',
          userId: randomUUID(),
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_paypal_cancelled',
          tossOrderId: 'GRP-PAYPAL-CANCELLED',
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL',
          currency: 'KRW',
          amount: 150000,
          status: 'CANCELED',
          providerMetadata: { requestedProvider: 'PAYPAL' },
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([{
          id: 'showtime-1',
          performanceId: 'performance-1',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-10' },
          { seatId: '1F:A-11' },
        ]))
        .mockReturnValueOnce(createSelectChain([]));

      const result = await service.finalizeConfirmedCancelWebhook(
        createConfirmedCancelWebhookPayload(
          'pay_paypal_cancelled',
          'GRP-PAYPAL-CANCELLED',
        ),
        createConfirmedCancelProviderResponse(
          'pay_paypal_cancelled',
          'GRP-PAYPAL-CANCELLED',
        ),
      );

      expect(result).toBe('finalized');
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith({
        source: 'cancel_webhook',
        context: {
          reservation: {
            id: reservationId,
            showtimeId: 'showtime-1',
            reservationNumber: 'GRP-20260508-ABCDE',
          },
          payment: {
            id: paymentId,
            paymentKey: 'pay_paypal_cancelled',
            providerMetadata: { requestedProvider: 'PAYPAL' },
          },
          bookingPolicy: {
            cancelledSeatHoldMinMinutes: 1,
            cancelledSeatHoldMaxMinutes: 10,
          },
          seats: [{ seatId: '1F:A-10' }, { seatId: '1F:A-11' }],
        },
        reason: 'provider cancellation',
        providerResponse: expect.objectContaining({ status: 'CANCELED' }),
        actor: { kind: 'system' },
      });
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('passes a matching processing refund id to the confirmed cancel webhook finalizer', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const refundId = randomUUID();
      const finalizer = {
        finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
          releaseJobId: 'release-job-1',
          releaseEnqueued: true,
        }),
      };
      (service as unknown as {
        paymentCancellationFinalizer: typeof finalizer;
      }).paymentCancellationFinalizer = finalizer;

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          reservationNumber: 'GRP-20260508-ABCDE',
          userId: randomUUID(),
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_refund_async_cancelled',
          tossOrderId: 'GRP-REFUND-ASYNC-CANCELLED',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY',
          currency: 'KRW',
          amount: 150000,
          status: 'CANCELED',
          providerMetadata: { requestedProvider: 'ALIPAY' },
        }]))
        .mockReturnValueOnce(createSelectChain([{ id: refundId }]))
        .mockReturnValueOnce(createSelectChain([{
          id: 'showtime-1',
          performanceId: 'performance-1',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
        }]))
        .mockReturnValueOnce(createSelectChain([{ seatId: '1F:A-10' }]))
        .mockReturnValueOnce(createSelectChain([]));

      const result = await service.finalizeConfirmedCancelWebhook(
        createConfirmedCancelWebhookPayload(
          'pay_refund_async_cancelled',
          'GRP-REFUND-ASYNC-CANCELLED',
        ),
        createConfirmedCancelProviderResponse(
          'pay_refund_async_cancelled',
          'GRP-REFUND-ASYNC-CANCELLED',
        ),
      );

      expect(result).toBe('finalized');
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cancel_webhook',
          refundId,
          context: expect.objectContaining({
            reservation: expect.objectContaining({ id: reservationId }),
            payment: expect.objectContaining({ id: paymentId }),
          }),
        }),
      );
    });

    it('passes a matching failed refund id to reconcile a late confirmed cancel webhook', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const refundId = randomUUID();
      const refundSelect = createSelectChain([{ id: refundId }]);
      const finalizer = {
        finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
          releaseJobId: 'release-job-1',
          releaseEnqueued: true,
        }),
      };
      (service as unknown as {
        paymentCancellationFinalizer: typeof finalizer;
      }).paymentCancellationFinalizer = finalizer;

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          reservationNumber: 'GRP-20260508-ABCDE',
          userId: randomUUID(),
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_failed_refund_cancelled',
          tossOrderId: 'GRP-FAILED-REFUND-CANCELLED',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY',
          currency: 'KRW',
          amount: 150000,
          status: 'CANCELED',
          providerMetadata: { requestedProvider: 'ALIPAY' },
        }]))
        .mockReturnValueOnce(refundSelect)
        .mockReturnValueOnce(createSelectChain([{
          id: 'showtime-1',
          performanceId: 'performance-1',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
        }]))
        .mockReturnValueOnce(createSelectChain([{ seatId: '1F:A-10' }]))
        .mockReturnValueOnce(createSelectChain([]));

      const result = await service.finalizeConfirmedCancelWebhook(
        createConfirmedCancelWebhookPayload(
          'pay_failed_refund_cancelled',
          'GRP-FAILED-REFUND-CANCELLED',
        ),
        createConfirmedCancelProviderResponse(
          'pay_failed_refund_cancelled',
          'GRP-FAILED-REFUND-CANCELLED',
        ),
      );

      expect(result).toBe('finalized');
      expect(sqlPredicateHasParamValue(refundSelect.where.mock.calls[0]?.[0], 'failed'))
        .toBe(true);
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cancel_webhook',
          refundId,
        }),
      );
    });

    it('passes prepared ticket item cancellation economics for ticket-item async cancel webhooks', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const ticketItemId = randomUUID();
      const finalizer = {
        finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
          releaseJobId: 'release-job-1',
          releaseEnqueued: true,
        }),
      };
      (service as unknown as {
        paymentCancellationFinalizer: typeof finalizer;
      }).paymentCancellationFinalizer = finalizer;

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          reservationNumber: 'GRP-20260508-ABCDE',
          userId: randomUUID(),
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 150000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_ticket_item_cancelled',
          tossOrderId: 'GRP-TICKET-ITEM-CANCELLED',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY',
          currency: 'KRW',
          amount: 150000,
          status: 'CANCELED',
          providerMetadata: { requestedProvider: 'ALIPAY' },
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([{
          id: 'showtime-1',
          performanceId: 'performance-1',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
        }]))
        .mockReturnValueOnce(createSelectChain([{ seatId: '1F:A-10' }]))
        .mockReturnValueOnce(createSelectChain([{
          ticketItemId,
          cancellationFee: 7700,
          serviceFeeRefund: 0,
          refundableAmount: 69300,
        }]));

      const result = await service.finalizeConfirmedCancelWebhook(
        createConfirmedCancelWebhookPayload(
          'pay_ticket_item_cancelled',
          'GRP-TICKET-ITEM-CANCELLED',
          `cancel_${ticketItemId}`,
        ),
        createConfirmedCancelProviderResponse(
          'pay_ticket_item_cancelled',
          'GRP-TICKET-ITEM-CANCELLED',
        ),
      );

      expect(result).toBe('finalized');
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cancel_webhook',
          ticketItemCancellation: {
            ticketItemId,
            cancellationFee: 7700,
            serviceFeeRefund: 0,
            refundableAmount: 69300,
          },
        }),
      );
    });

    it('limits ticket-item async cancel webhook finalization to the cancelled seat', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const ticketItemId = randomUUID();
      const finalizer = {
        finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
          releaseJobId: 'release-job-1',
          releaseEnqueued: true,
        }),
      };
      (service as unknown as {
        paymentCancellationFinalizer: typeof finalizer;
      }).paymentCancellationFinalizer = finalizer;

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          reservationNumber: 'GRP-20260604-2IO8C',
          userId: randomUUID(),
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 724000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_ticket_item_partial_cancelled',
          tossOrderId: 'GRP-TICKET-ITEM-PARTIAL-CANCELLED',
          method: 'CARD',
          provider: 'CARD',
          currency: 'KRW',
          amount: 724000,
          status: 'DONE',
          providerMetadata: null,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([{
          id: 'showtime-1',
          performanceId: 'performance-1',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:라-100' },
          { seatId: '1F:라-81' },
        ]))
        .mockReturnValueOnce(createSelectChain([{
          ticketItemId,
          seatId: '라-81',
          floorKey: '1F',
          seatKey: '1F:라-81',
          cancellationFee: 0,
          serviceFeeRefund: 2000,
          refundableAmount: 362000,
        }]));

      const result = await service.finalizeConfirmedCancelWebhook(
        createConfirmedCancelWebhookPayload(
          'pay_ticket_item_partial_cancelled',
          'GRP-TICKET-ITEM-PARTIAL-CANCELLED',
          `cancel_${ticketItemId}`,
        ),
        {
          ...createConfirmedCancelProviderResponse(
            'pay_ticket_item_partial_cancelled',
            'GRP-TICKET-ITEM-PARTIAL-CANCELLED',
          ),
          status: 'PARTIAL_CANCELED',
          totalAmount: 724000,
          balanceAmount: 362000,
          cancels: [
            {
              cancelAmount: 362000,
              cancelReason: '다른 좌석으로 재예매',
              canceledAt: '2026-06-04T20:15:45+09:00',
              cancelStatus: 'DONE',
              cancelRequestId: `cancel_${ticketItemId}`,
            },
          ],
        },
      );

      expect(result).toBe('finalized');
      expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            seats: [
              {
                seatId: '라-81',
                floorKey: '1F',
                seatKey: '1F:라-81',
              },
            ],
          }),
          ticketItemCancellation: expect.objectContaining({
            ticketItemId,
            refundableAmount: 362000,
          }),
        }),
      );
    });

    it('does not finalize partial cancel webhooks without a ticket-item match', async () => {
      const reservationId = randomUUID();
      const paymentId = randomUUID();
      const finalizer = {
        finalizeFullPaymentCancellation: vi.fn(),
      };
      (service as unknown as {
        paymentCancellationFinalizer: typeof finalizer;
      }).paymentCancellationFinalizer = finalizer;

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          reservationNumber: 'GRP-20260604-PARTIAL-NO-MATCH',
          userId: randomUUID(),
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 724000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_partial_no_ticket_match',
          tossOrderId: 'GRP-PARTIAL-NO-TICKET-MATCH',
          method: 'CARD',
          provider: 'CARD',
          currency: 'KRW',
          amount: 724000,
          status: 'DONE',
          providerMetadata: null,
        }]))
        .mockReturnValueOnce(createSelectChain([]))
        .mockReturnValueOnce(createSelectChain([{
          id: 'showtime-1',
          performanceId: 'performance-1',
        }]))
        .mockReturnValueOnce(createSelectChain([{
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:라-100' },
          { seatId: '1F:라-81' },
        ]))
        .mockReturnValueOnce(createSelectChain([]));

      const result = await service.finalizeConfirmedCancelWebhook(
        createConfirmedCancelWebhookPayload(
          'pay_partial_no_ticket_match',
          'GRP-PARTIAL-NO-TICKET-MATCH',
          'cancel_external-partial-1',
        ),
        {
          ...createConfirmedCancelProviderResponse(
            'pay_partial_no_ticket_match',
            'GRP-PARTIAL-NO-TICKET-MATCH',
          ),
          status: 'PARTIAL_CANCELED',
          totalAmount: 724000,
          balanceAmount: 362000,
          cancels: [
            {
              cancelAmount: 362000,
              cancelReason: 'external partial cancel',
              canceledAt: '2026-06-04T20:15:45+09:00',
              cancelStatus: 'DONE',
              cancelRequestId: 'cancel_external-partial-1',
            },
          ],
        },
      );

      expect(result).toBe('no_local_match');
      expect(finalizer.finalizeFullPaymentCancellation).not.toHaveBeenCalled();
    });

    it('acks PayPal DONE webhook after sync confirm without overwriting the KRW payment row', async () => {
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
          paymentKey: 'pay_paypal_after_confirm',
          tossOrderId: 'GRP-PAYPAL-AFTER-CONFIRM',
          amount: 150000,
          status: 'DONE',
        }]));

      await service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-paypal-done-after-confirm',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_paypal_after_confirm',
            orderId: 'GRP-PAYPAL-AFTER-CONFIRM',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'PAYPAL',
            currency: 'USD',
            totalAmount: 108,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      );

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
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
      mockTossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pay_async_done',
        orderId: 'GRP-ASYNC-DONE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 102000,
        status: 'DONE',
        approvedAt: '2026-05-08T08:00:00.000Z',
        cancels: [
          {
            cancelAmount: 102000,
            cancelReason: '판매 불가능 좌석으로 인한 자동 취소',
            canceledAt: '2026-05-08T08:00:05.000Z',
            cancelStatus: 'IN_PROGRESS',
            cancelRequestId: `cancel_${reservationId}`,
          },
        ],
      });

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
      )).resolves.toBe('DONE_CANCEL_PENDING');

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_async_done',
        expect.stringContaining('판매 불가능'),
        {
          idempotencyKey: 'toss-webhook:evt-payment-done-disabled-seat:seat-failure-cancel',
          secretKeyScope: 'foreign-easy-pay',
          cancelRequestId: `cancel_${reservationId}`,
        },
      );
      expect(insertCanceledPayment.values).toHaveBeenCalledWith(expect.objectContaining({
        reservationId,
        paymentKey: 'pay_async_done',
        tossOrderId: 'GRP-ASYNC-DONE',
        status: 'DONE',
        asyncStatus: 'cancel_pending',
        cancelReason: expect.stringContaining('판매 불가능'),
      }));
      expect(failReservation.set).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('cancels recovered Alipay DONE payment when a sold seat blocks late finalization', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const updatePayment = createMutationChain();
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([]);
      const insertSeat = createMutationChain([]);
      const updateCanceledPayment = createMutationChain();
      const failReservation = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'FAILED',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_old_expired',
          tossOrderId: 'GRP-ALIPAY-SOLD-SEAT',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 102000,
          status: 'EXPIRED',
          providerMetadata: null,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updatePayment)
        .mockReturnValueOnce(updateSeat);
      tx.insert
        .mockReturnValueOnce(insertTicketItems)
        .mockReturnValueOnce(insertSeat);
      mockDb.update
        .mockReturnValueOnce(updateCanceledPayment)
        .mockReturnValueOnce(failReservation);
      mockTossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pay_recovered_sold_seat',
        orderId: 'GRP-ALIPAY-SOLD-SEAT',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 102000,
        status: 'CANCELED',
        approvedAt: '2026-05-29T08:00:00.000Z',
        cancels: [
          {
            cancelAmount: 102000,
            cancelReason: '판매 불가능 좌석으로 인한 자동 취소',
            canceledAt: '2026-05-29T08:00:05.000Z',
            cancelStatus: 'DONE',
            cancelRequestId: `cancel_${reservationId}`,
          },
        ],
      });

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-sold-seat',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_recovered_sold_seat',
            orderId: 'GRP-ALIPAY-SOLD-SEAT',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 102000,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBe('DONE_COMPENSATED_SEAT_CONFLICT');

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_recovered_sold_seat',
        expect.stringContaining('판매 불가능'),
        {
          idempotencyKey: 'toss-webhook:evt-alipay-sold-seat:seat-failure-cancel',
          secretKeyScope: 'foreign-easy-pay',
          cancelRequestId: `cancel_${reservationId}`,
        },
      );
      expect(updateCanceledPayment.set).toHaveBeenCalledWith(expect.objectContaining({
        paymentKey: 'pay_recovered_sold_seat',
        status: 'CANCELED',
        asyncStatus: 'payment_status_changed:done',
      }));
      expect(failReservation.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'FAILED',
      }));
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('cancels recovered Alipay DONE payment when another user holds an active Redis lock', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const updateCanceledPayment = createMutationChain();
      const failReservation = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'FAILED',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_old_expired',
          tossOrderId: 'GRP-ALIPAY-REDIS-LOCKED',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 102000,
          status: 'EXPIRED',
          providerMetadata: null,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        ]));
      mockBookingService.acquireRecoverySeatLocks.mockResolvedValueOnce({ acquired: false });
      mockDb.update
        .mockReturnValueOnce(updateCanceledPayment)
        .mockReturnValueOnce(failReservation);
      mockTossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pay_recovered_redis_locked',
        orderId: 'GRP-ALIPAY-REDIS-LOCKED',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 102000,
        status: 'CANCELED',
        approvedAt: '2026-05-29T08:00:00.000Z',
        cancels: [
          {
            cancelAmount: 102000,
            cancelReason: '판매 불가능 좌석으로 인한 자동 취소',
            canceledAt: '2026-05-29T08:00:05.000Z',
            cancelStatus: 'DONE',
            cancelRequestId: `cancel_${reservationId}`,
          },
        ],
      });

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-redis-locked',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_recovered_redis_locked',
            orderId: 'GRP-ALIPAY-REDIS-LOCKED',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 102000,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBe('DONE_COMPENSATED_SEAT_CONFLICT');

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_recovered_redis_locked',
        expect.stringContaining('판매 불가능'),
        {
          idempotencyKey: 'toss-webhook:evt-alipay-redis-locked:seat-failure-cancel',
          secretKeyScope: 'foreign-easy-pay',
          cancelRequestId: `cancel_${reservationId}`,
        },
      );
      expect(updateCanceledPayment.set).toHaveBeenCalledWith(expect.objectContaining({
        paymentKey: 'pay_recovered_redis_locked',
        status: 'CANCELED',
      }));
      expect(mockQrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('keeps recovered Alipay DONE payment cancel_pending when sold-seat compensation is asynchronous', async () => {
      const reservationId = randomUUID();
      const showtimeId = randomUUID();
      const userId = randomUUID();
      const paymentId = randomUUID();
      const tx = {
        update: vi.fn(),
        insert: vi.fn(),
      };
      const updateReservation = createMutationChain();
      const updatePayment = createMutationChain();
      const insertTicketItems = createMutationChain();
      const updateSeat = createMutationChain([]);
      const insertSeat = createMutationChain([]);
      const updateCancelPendingPayment = createMutationChain();

      mockDb.select
        .mockReturnValueOnce(createSelectChain([{
          id: reservationId,
          userId,
          showtimeId,
          status: 'FAILED',
          totalAmount: 102000,
        }]))
        .mockReturnValueOnce(createSelectChain([{
          id: paymentId,
          reservationId,
          paymentKey: 'pay_old_expired',
          tossOrderId: 'GRP-ALIPAY-SOLD-SEAT-PENDING',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 102000,
          status: 'EXPIRED',
          providerMetadata: null,
        }]))
        .mockReturnValueOnce(createSelectChain([
          { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        ]));
      mockDb.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx);
      });
      tx.update
        .mockReturnValueOnce(updateReservation)
        .mockReturnValueOnce(updatePayment)
        .mockReturnValueOnce(updateSeat);
      tx.insert
        .mockReturnValueOnce(insertTicketItems)
        .mockReturnValueOnce(insertSeat);
      mockDb.update.mockReturnValueOnce(updateCancelPendingPayment);
      mockTossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pay_recovered_cancel_pending',
        orderId: 'GRP-ALIPAY-SOLD-SEAT-PENDING',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 102000,
        status: 'DONE',
        approvedAt: '2026-05-29T08:00:00.000Z',
        cancels: [
          {
            cancelAmount: 102000,
            cancelReason: '판매 불가능 좌석으로 인한 자동 취소',
            canceledAt: '2026-05-29T08:00:05.000Z',
            cancelStatus: 'IN_PROGRESS',
            cancelRequestId: `cancel_${reservationId}`,
          },
        ],
      });

      await expect(service.upsertAsyncPaymentProgress(
        {
          eventId: 'evt-alipay-sold-seat-pending',
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'pay_recovered_cancel_pending',
            orderId: 'GRP-ALIPAY-SOLD-SEAT-PENDING',
            status: 'DONE',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            totalAmount: 102000,
            approvedAt: '2026-05-29T08:00:00.000Z',
          },
        },
        'DONE',
        'payment_status_changed:done',
      )).resolves.toBe('DONE_CANCEL_PENDING');

      expect(updateCancelPendingPayment.set).toHaveBeenCalledWith(expect.objectContaining({
        paymentKey: 'pay_recovered_cancel_pending',
        status: 'DONE',
        asyncStatus: 'cancel_pending',
      }));
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
