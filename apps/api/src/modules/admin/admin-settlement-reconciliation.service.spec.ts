import { describe, expect, it, vi } from 'vitest';

import { AdminSettlementReconciliationService } from './admin-settlement-reconciliation.service.js';

function chainResult<T>(rows: T[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }

      return () => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

function createService(rows: unknown[]) {
  const db = {
    select: vi.fn().mockReturnValue(chainResult(rows)),
  };
  const tossClient = {
    querySettlements: vi.fn().mockResolvedValue([
      {
        paymentKey: 'payment-key-domestic-card',
        amount: 159_004_000,
        fee: 5_971_275,
        supplyAmount: 5_428_307,
        vat: 542_968,
        payOutAmount: 153_032_725,
        soldDate: '2026-06-04',
        paidOutDate: '2026-06-15',
        method: '카드',
      },
    ]),
    queryPayment: vi.fn().mockResolvedValue({
      paymentKey: 'payment-key-transfer',
      method: '계좌이체',
      status: 'DONE',
      totalAmount: 3_432_000,
      transfer: {
        settlementStatus: 'INCOMPLETED',
      },
    }),
  };
  const service = new AdminSettlementReconciliationService(
    db as never,
    tossClient as never,
  );

  return { service, db, tossClient };
}

describe('AdminSettlementReconciliationService', () => {
  it('reconciles site gross sales with Toss domestic settlement and foreign gross', async () => {
    const { service, tossClient } = createService([
      {
        eventId: 'event-girl-rules-20260704',
        paymentKey: 'payment-key-domestic-card',
        provider: 'CARD',
        method: '카드',
        providerChargeCurrency: null,
        activeGrossAmount: 158_280_000,
        paidAt: new Date('2026-06-04T10:00:00.000Z'),
      },
      {
        eventId: 'event-girl-rules-20260704',
        paymentKey: 'payment-key-transfer',
        provider: 'CARD',
        method: '계좌이체',
        providerChargeCurrency: null,
        activeGrossAmount: 3_432_000,
        paidAt: new Date('2026-06-04T10:08:40.000Z'),
      },
      {
        eventId: 'event-girl-rules-20260704',
        paymentKey: 'payment-key-paypal',
        provider: 'PAYPAL',
        method: '해외간편결제',
        providerChargeCurrency: 'USD',
        activeGrossAmount: 21_818_000,
        paidAt: new Date('2026-06-04T10:09:00.000Z'),
      },
    ]);

    const result = await service.getReconciliation({
      eventId: 'event-girl-rules-20260704',
    });

    expect(tossClient.querySettlements).toHaveBeenCalledWith({
      startDate: '2026-06-04',
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dateType: 'soldDate',
      secretKeyScope: 'default',
    });
    expect(tossClient.queryPayment).toHaveBeenCalledWith('payment-key-transfer', {
      secretKeyScope: 'default',
    });
    expect(result).toMatchObject({
      eventId: 'event-girl-rules-20260704',
      siteSalesGrossAmount: 183_530_000,
      domestic: {
        tossGrossAmount: 159_004_000,
        payoutAmount: 153_032_725,
        feeAmount: 5_971_275,
        matchedGrossAmount: 158_280_000,
        unmatchedGrossAmount: 3_432_000,
        unsettledTransferAmount: 3_432_000,
        unsettledTransferCount: 1,
      },
      foreign: {
        grossAmount: 21_818_000,
        byProvider: [
          { provider: 'PAYPAL', grossAmount: 21_818_000, reservationCount: 1 },
        ],
      },
    });

    expect(JSON.stringify(result)).not.toContain('payment-key');
  });
});
