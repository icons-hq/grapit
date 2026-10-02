import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethod } from '@grabit/shared';
import {
  ABANDONED_PAYMENT_HANDOFF_DIAGNOSTIC,
  ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS,
  AbandonedPaymentHandoffService,
  formatTossKstDateTime,
} from './abandoned-payment-handoff.service.js';
import { ABANDONED_PAYMENT_HANDOFF_GRACE_MS } from './payment-handoff-policy.js';
import { TOSS_TRANSACTION_PAGE_SIZE } from './toss-payments.client.js';

const NOW = new Date('2026-10-02T05:00:00.000Z');
const STARTED = new Date('2026-10-02T03:00:00.000Z');
const DEADLINE = new Date('2026-10-02T03:08:00.000Z');
const CARD: PaymentMethod = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reservation-orphan',
    tossOrderId: 'GRP-ORPHAN',
    checkoutStartedAt: STARTED,
    paymentDeadlineAt: DEADLINE,
    checkoutPaymentMethod: CARD,
    ...overrides,
  };
}

function createCandidateQuery(rows: unknown[]) {
  const chain = {
    from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createTx(failedRows: unknown[]) {
  const update = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
  update.set.mockReturnValue(update);
  update.where.mockReturnValue(update);
  update.returning.mockResolvedValue(failedRows);
  const insert = { values: vi.fn(), onConflictDoUpdate: vi.fn() };
  insert.values.mockReturnValue(insert);
  insert.onConflictDoUpdate.mockResolvedValue(undefined);
  return {
    update: vi.fn().mockReturnValue(update),
    insert: vi.fn().mockReturnValue(insert),
    updateChain: update,
    insertChain: insert,
  };
}

describe('AbandonedPaymentHandoffService', () => {
  let db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let tx: ReturnType<typeof createTx>;
  let toss: { queryTransactions: ReturnType<typeof vi.fn> };
  let locks: {
    acquirePaymentConfirmLock: ReturnType<typeof vi.fn>;
    releasePaymentConfirmLock: ReturnType<typeof vi.fn>;
  };
  let service: AbandonedPaymentHandoffService;

  beforeEach(() => {
    tx = createTx([{ id: 'reservation-orphan' }]);
    db = {
      select: vi.fn().mockReturnValue(createCandidateQuery([candidate()])),
      transaction: vi.fn(async (run: (trx: unknown) => Promise<unknown>) => run(tx)),
    };
    toss = { queryTransactions: vi.fn().mockResolvedValue([]) };
    locks = {
      acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
      releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
    };
    service = new AbandonedPaymentHandoffService(db as never, toss as never, locks as never);
  });

  it('formats Toss lookup bounds in KST without an offset suffix', () => {
    expect(formatTossKstDateTime(new Date('2026-10-01T23:30:05.123Z'))).toBe('2026-10-02T08:30:05');
  });

  it('fails a handoff only after the provider proves the order has no transaction', async () => {
    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 1,
      failedReservations: 1,
    });

    expect(toss.queryTransactions).toHaveBeenCalledWith({
      startDate: '2026-10-02T11:50:00',
      endDate: '2026-10-02T14:00:00',
      limit: TOSS_TRANSACTION_PAGE_SIZE,
      secretKeyScope: 'default',
    });
    expect(tx.updateChain.set).toHaveBeenCalledWith({ status: 'FAILED', updatedAt: NOW });
    expect(tx.insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 'reservation-orphan',
      tossOrderId: 'GRP-ORPHAN',
      diagnosticCode: ABANDONED_PAYMENT_HANDOFF_DIAGNOSTIC.diagnosticCode,
      providerCheckStatus: 'no_provider_transaction',
      providerCheckedAt: NOW,
    }));
    expect(locks.acquirePaymentConfirmLock.mock.invocationCallOrder[0]!)
      .toBeLessThan(toss.queryTransactions.mock.invocationCallOrder[0]!);
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledWith(
      'GRP-ORPHAN',
      locks.acquirePaymentConfirmLock.mock.calls[0]![1],
    );
  });

  it('keeps the order in review when the provider has any transaction for it', async () => {
    toss.queryTransactions.mockResolvedValue([
      { transactionKey: 'tx-other', orderId: 'GRP-OTHER', status: 'DONE' },
      { transactionKey: 'tx-orphan', orderId: 'GRP-ORPHAN', status: 'DONE' },
    ]);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('treats a lookup failure as no evidence', async () => {
    toss.queryTransactions.mockRejectedValue(new Error('UNAUTHORIZED_KEY'));

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledTimes(1);
  });

  it('follows pages and gives up without evidence when the page cap is reached', async () => {
    const fullPage = Array.from({ length: TOSS_TRANSACTION_PAGE_SIZE }, (_, index) => ({
      transactionKey: `tx-${toss.queryTransactions.mock.calls.length}-${index}`,
      orderId: `GRP-${index}`,
    }));
    toss.queryTransactions.mockImplementation(async () => fullPage.map((row, index) => ({
      ...row,
      transactionKey: `tx-${toss.queryTransactions.mock.calls.length}-${index}`,
    })));

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(toss.queryTransactions).toHaveBeenCalledTimes(4);
    expect(toss.queryTransactions.mock.calls[1]![0]).toMatchObject({
      startingAfter: `tx-1-${TOSS_TRANSACTION_PAGE_SIZE - 1}`,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('uses the overseas card MID for an overseas card checkout', async () => {
    db.select.mockReturnValue(createCandidateQuery([candidate({
      checkoutPaymentMethod: {
        method: 'CARD', provider: 'CARD', currency: 'USD',
        overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test' },
      },
    })]));

    await service.sweepAbandonedPaymentHandoffs(NOW);
    expect(toss.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({
      secretKeyScope: 'overseas-card',
    }));
  });

  it('never fails an asynchronous wallet handoff or one whose confirm lease is held', async () => {
    db.select.mockReturnValue(createCandidateQuery([
      candidate({
        id: 'reservation-alipay',
        checkoutPaymentMethod: {
          method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', currency: 'USD', pendingUrlRequired: true,
        },
      }),
      candidate({ id: 'reservation-confirming', tossOrderId: 'GRP-CONFIRMING' }),
    ]));
    locks.acquirePaymentConfirmLock.mockResolvedValue(false);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 2,
      failedReservations: 0,
    });
    expect(locks.acquirePaymentConfirmLock).toHaveBeenCalledTimes(1);
    expect(locks.acquirePaymentConfirmLock).toHaveBeenCalledWith('GRP-CONFIRMING', expect.any(String));
    expect(toss.queryTransactions).not.toHaveBeenCalled();
  });

  it('does not count an order that changed before the conditional failure update', async () => {
    tx = createTx([]);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(tx.insertChain.values).not.toHaveBeenCalled();
  });

  it('continues with other orders when one review throws', async () => {
    db.select.mockReturnValue(createCandidateQuery([
      candidate({ id: 'reservation-a', tossOrderId: 'GRP-A' }),
      candidate({ id: 'reservation-b', tossOrderId: 'GRP-B' }),
    ]));
    locks.acquirePaymentConfirmLock
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce(true);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 2,
      failedReservations: 1,
    });
  });

  it('stops reviewing new orders once a slow provider exhausts the sweep budget', async () => {
    db.select.mockReturnValue(createCandidateQuery([
      candidate({ id: 'reservation-a', tossOrderId: 'GRP-A' }),
      candidate({ id: 'reservation-b', tossOrderId: 'GRP-B' }),
    ]));
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValueOnce(0).mockReturnValueOnce(0)
      .mockReturnValue(ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS + 1);

    try {
      await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
        reviewedReservations: 1,
        failedReservations: 1,
      });
      expect(toss.queryTransactions).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('is inert without a provider client', async () => {
    const inert = new AbandonedPaymentHandoffService(db as never, undefined, locks as never);
    await expect(inert.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 0,
      failedReservations: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('waits for the provider expiry grace before reviewing', () => {
    expect(ABANDONED_PAYMENT_HANDOFF_GRACE_MS).toBeGreaterThanOrEqual(40 * 60 * 1000);
  });
});
