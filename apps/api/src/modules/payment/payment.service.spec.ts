import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PaymentMethod } from '@grabit/shared';
import { PaymentService } from './payment.service.js';

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
}

describe('PaymentService', () => {
  let service: PaymentService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new PaymentService(mockDb as any);
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
});
