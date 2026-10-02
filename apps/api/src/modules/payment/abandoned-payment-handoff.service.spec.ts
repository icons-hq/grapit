import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethod } from '@grabit/shared';
import {
  ABANDONED_PAYMENT_HANDOFF_DIAGNOSTIC,
  ABANDONED_PAYMENT_HANDOFF_FOUND_BACKOFF_SECONDS,
  ABANDONED_PAYMENT_HANDOFF_INCONCLUSIVE_BACKOFF_SECONDS,
  ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT,
  ABANDONED_PAYMENT_HANDOFF_SCAN_LIMIT,
  ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS,
  AbandonedPaymentHandoffService,
  formatTossKstDateTime,
  mergeProviderLookupWindows,
} from './abandoned-payment-handoff.service.js';
import { ABANDONED_PAYMENT_HANDOFF_GRACE_MS } from './payment-handoff-policy.js';
import {
  TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS,
  TOSS_TRANSACTION_PAGE_SIZE,
} from './toss-payments.client.js';

const NOW = new Date('2026-10-02T05:00:00.000Z');
const CREATED = new Date('2026-10-02T02:55:00.000Z');
const STARTED = new Date('2026-10-02T03:00:00.000Z');
const DEADLINE = new Date('2026-10-02T03:08:00.000Z');
const CARD: PaymentMethod = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tossOrderId: 'GRP-ORPHAN',
    createdAt: CREATED,
    checkoutStartedAt: STARTED,
    paymentDeadlineAt: DEADLINE,
    checkoutPaymentMethod: CARD,
    ...overrides,
  };
}

function numbered(index: number, overrides: Record<string, unknown> = {}) {
  return candidate({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    tossOrderId: `GRP-${index}`,
    ...overrides,
  });
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

/** Records review state like Valkey; TTL expiry itself is covered by the integration spec. */
function createReviewStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
  };
}

describe('AbandonedPaymentHandoffService', () => {
  let db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
  let tx: ReturnType<typeof createTx>;
  let toss: {
    queryTransactions: ReturnType<typeof vi.fn>;
    getTransactionLookupScopes: ReturnType<typeof vi.fn>;
  };
  let locks: {
    acquirePaymentConfirmLock: ReturnType<typeof vi.fn>;
    refreshPaymentConfirmLock: ReturnType<typeof vi.fn>;
    releasePaymentConfirmLock: ReturnType<typeof vi.fn>;
  };
  let store: ReturnType<typeof createReviewStore>;
  let service: AbandonedPaymentHandoffService;

  function useCandidates(rows: unknown[]) {
    db.select.mockReturnValue(createCandidateQuery(rows));
  }

  beforeEach(() => {
    tx = createTx([{ id: 'reservation-orphan' }]);
    db = {
      select: vi.fn(),
      transaction: vi.fn(async (run: (trx: unknown) => Promise<unknown>) => run(tx)),
    };
    useCandidates([candidate()]);
    toss = {
      queryTransactions: vi.fn().mockResolvedValue([]),
      getTransactionLookupScopes: vi.fn().mockReturnValue(['default', 'foreign-easy-pay']),
    };
    locks = {
      acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
      refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
      releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
    };
    store = createReviewStore();
    service = new AbandonedPaymentHandoffService(
      db as never,
      toss as never,
      locks as never,
      store as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats Toss lookup bounds in KST without an offset suffix', () => {
    expect(formatTossKstDateTime(new Date('2026-10-01T23:30:05.123Z'))).toBe('2026-10-02T08:30:05');
  });

  it('fails a handoff only after every configured MID proves the order has no transaction', async () => {
    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 1,
      failedReservations: 1,
    });

    // The window starts before the order existed, so a released and re-branched
    // order's earlier attempt is covered too.
    for (const secretKeyScope of ['default', 'foreign-easy-pay']) {
      expect(toss.queryTransactions).toHaveBeenCalledWith({
        startDate: '2026-10-02T11:45:00',
        endDate: '2026-10-02T14:00:00',
        limit: TOSS_TRANSACTION_PAGE_SIZE,
        secretKeyScope,
        timeoutMs: expect.any(Number),
      });
    }
    const { timeoutMs } = toss.queryTransactions.mock.calls[0]![0] as { timeoutMs: number };
    expect(timeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(timeoutMs).toBeLessThanOrEqual(TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS);

    expect(tx.updateChain.set).toHaveBeenCalledWith({ status: 'FAILED', updatedAt: NOW });
    expect(tx.insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: candidate().id,
      tossOrderId: 'GRP-ORPHAN',
      diagnosticCode: ABANDONED_PAYMENT_HANDOFF_DIAGNOSTIC.diagnosticCode,
      providerCheckStatus: 'no_provider_transaction',
      providerCheckedAt: NOW,
    }));
    // Lease taken before the lookup, still owned right before the update, released after.
    const leaseToken = locks.acquirePaymentConfirmLock.mock.calls[0]![1];
    expect(locks.acquirePaymentConfirmLock.mock.invocationCallOrder[0]!)
      .toBeLessThan(toss.queryTransactions.mock.invocationCallOrder[0]!);
    expect(locks.refreshPaymentConfirmLock).toHaveBeenCalledWith('GRP-ORPHAN', leaseToken);
    expect(locks.refreshPaymentConfirmLock.mock.invocationCallOrder[0]!)
      .toBeLessThan(db.transaction.mock.invocationCallOrder[0]!);
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledWith('GRP-ORPHAN', leaseToken);
  });

  it('treats a transaction on any MID (for example PayPal on the foreign MID) as evidence of a payment', async () => {
    const critical = vi.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    toss.queryTransactions.mockImplementation(async ({ secretKeyScope }: { secretKeyScope: string }) => (
      secretKeyScope === 'foreign-easy-pay'
        ? [{ transactionKey: 'tx-paypal', orderId: 'GRP-ORPHAN', status: 'DONE' }]
        : []
    ));

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 1,
      failedReservations: 0,
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(critical).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith(
      `{payment-handoff-review}:deferred:${candidate().id}`,
      'found',
      'EX',
      ABANDONED_PAYMENT_HANDOFF_FOUND_BACKOFF_SECONDS,
    );

    // The next sweeps neither query the provider again nor repeat the alert.
    toss.queryTransactions.mockClear();
    await service.sweepAbandonedPaymentHandoffs(NOW);
    await service.sweepAbandonedPaymentHandoffs(NOW);
    expect(toss.queryTransactions).not.toHaveBeenCalled();
    expect(locks.acquirePaymentConfirmLock).toHaveBeenCalledTimes(1);
    expect(critical).toHaveBeenCalledTimes(1);
  });

  it('defers an order whose lookup failed instead of failing it or re-querying every sweep', async () => {
    toss.queryTransactions.mockRejectedValue(new Error('UNAUTHORIZED_KEY'));

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(store.set).toHaveBeenCalledWith(
      `{payment-handoff-review}:deferred:${candidate().id}`,
      'inconclusive',
      'EX',
      ABANDONED_PAYMENT_HANDOFF_INCONCLUSIVE_BACKOFF_SECONDS,
    );
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledTimes(1);
  });

  it('follows pages and gives up without evidence when the page cap is reached', async () => {
    toss.getTransactionLookupScopes.mockReturnValue(['default']);
    toss.queryTransactions.mockImplementation(async () => Array.from(
      { length: TOSS_TRANSACTION_PAGE_SIZE },
      (_, index) => ({
        transactionKey: `tx-${toss.queryTransactions.mock.calls.length}-${index}`,
        orderId: `GRP-${index}`,
      }),
    ));

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(toss.queryTransactions).toHaveBeenCalledTimes(4);
    expect(toss.queryTransactions.mock.calls[1]![0]).toMatchObject({
      startingAfter: `tx-1-${TOSS_TRANSACTION_PAGE_SIZE - 1}`,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('reads overlapping order windows from the ledger once', async () => {
    toss.getTransactionLookupScopes.mockReturnValue(['default']);
    useCandidates([
      numbered(1),
      numbered(2, { checkoutStartedAt: new Date(STARTED.getTime() + 60_000) }),
      numbered(3, {
        createdAt: new Date('2026-10-01T20:00:00.000Z'),
        checkoutStartedAt: new Date('2026-10-01T20:01:00.000Z'),
        paymentDeadlineAt: new Date('2026-10-01T20:09:00.000Z'),
      }),
    ]);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 3,
      failedReservations: 3,
    });
    expect(toss.queryTransactions).toHaveBeenCalledTimes(2);
  });

  it('merges only overlapping lookup windows', () => {
    const windows = mergeProviderLookupWindows([
      { tossOrderId: 'A', createdAt: CREATED, checkoutStartedAt: STARTED, paymentDeadlineAt: DEADLINE },
      {
        tossOrderId: 'B',
        createdAt: new Date(DEADLINE.getTime() + 60 * 60_000),
        checkoutStartedAt: new Date(DEADLINE.getTime() + 61 * 60_000),
        paymentDeadlineAt: new Date(DEADLINE.getTime() + 68 * 60_000),
      },
      {
        tossOrderId: 'C',
        createdAt: new Date('2026-10-02T12:00:00.000Z'),
        checkoutStartedAt: new Date('2026-10-02T12:01:00.000Z'),
        paymentDeadlineAt: new Date('2026-10-02T12:09:00.000Z'),
      },
    ], new Date('2026-10-02T16:00:00.000Z'));

    expect(windows.map((window) => [...window.orderIds])).toEqual([['A', 'B'], ['C']]);
  });

  it('keeps reviewing newer orphans when more than a batch of unresolvable orders sit ahead of them', async () => {
    toss.getTransactionLookupScopes.mockReturnValue(['default']);
    const stuck = Array.from({ length: ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT + 5 }, (_, index) => numbered(index + 1));
    const orphan = numbered(900, { tossOrderId: 'GRP-NEW-ORPHAN' });
    const stuckOrderIds = new Set(stuck.map((row) => row.tossOrderId));
    toss.queryTransactions.mockImplementation(async () => [...stuckOrderIds]
      .map((orderId, index) => ({ transactionKey: `tx-${index}`, orderId })));
    vi.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    db.select.mockImplementation(() => createCandidateQuery([...stuck, orphan]));

    await service.sweepAbandonedPaymentHandoffs(NOW);
    expect(db.transaction).not.toHaveBeenCalled();
    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 6,
      failedReservations: 1,
    });
    expect(tx.updateChain.where).toHaveBeenCalledTimes(1);
    expect(locks.acquirePaymentConfirmLock).toHaveBeenCalledWith('GRP-NEW-ORPHAN', expect.any(String));
  });

  it('resumes the scan after the last examined order and wraps around at the end', async () => {
    const fullPage = Array.from({ length: ABANDONED_PAYMENT_HANDOFF_SCAN_LIMIT }, (_, index) => numbered(index + 1));
    for (const row of fullPage) {
      store.values.set(`{payment-handoff-review}:deferred:${row.id}`, 'inconclusive');
    }
    useCandidates(fullPage);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 0,
      failedReservations: 0,
    });
    expect(JSON.parse(store.values.get('{payment-handoff-review}:cursor')!)).toEqual({
      deadline: DEADLINE.toISOString(),
      id: fullPage[fullPage.length - 1]!.id,
    });

    useCandidates([numbered(500)]);
    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 1 });
    expect(store.values.has('{payment-handoff-review}:cursor')).toBe(false);
  });

  it('never fails an order whose confirm lease is held, and leaves it for the next cycle', async () => {
    useCandidates([candidate({ tossOrderId: 'GRP-CONFIRMING' })]);
    locks.acquirePaymentConfirmLock.mockResolvedValue(false);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 0,
      failedReservations: 0,
    });
    expect(toss.queryTransactions).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalledWith(
      expect.stringContaining(':deferred:'), expect.anything(), 'EX', expect.anything(),
    );
  });

  it('does not fail an order whose lease lapsed during the provider lookup', async () => {
    locks.refreshPaymentConfirmLock.mockResolvedValue(false);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('leaves orders unreviewed, not deferred, once the sweep budget is spent', async () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValueOnce(0).mockReturnValue(ABANDONED_PAYMENT_HANDOFF_SWEEP_BUDGET_MS);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 0,
      failedReservations: 0,
    });
    expect(toss.queryTransactions).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect([...store.values.keys()].some((key) => key.includes(':deferred:'))).toBe(false);
  });

  it('proves nothing without a configured provider key', async () => {
    toss.getTransactionLookupScopes.mockReturnValue([]);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(toss.queryTransactions).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not stack a second review while one is still waiting on the provider', async () => {
    let finishLookup!: (rows: unknown[]) => void;
    toss.getTransactionLookupScopes.mockReturnValue(['default']);
    toss.queryTransactions.mockReturnValueOnce(new Promise((resolve) => { finishLookup = resolve; }));

    const first = service.sweepAbandonedPaymentHandoffs(NOW);
    await vi.waitFor(() => expect(toss.queryTransactions).toHaveBeenCalledTimes(1));
    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 0,
      failedReservations: 0,
    });
    finishLookup([]);
    await expect(first).resolves.toMatchObject({ failedReservations: 1 });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('does not count an order that changed before the conditional failure update', async () => {
    tx = createTx([]);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 0 });
    expect(tx.insertChain.values).not.toHaveBeenCalled();
  });

  it('continues with other orders when one lease request throws', async () => {
    useCandidates([numbered(1), numbered(2)]);
    locks.acquirePaymentConfirmLock
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce(true);

    await expect(service.sweepAbandonedPaymentHandoffs(NOW)).resolves.toEqual({
      reviewedReservations: 1,
      failedReservations: 1,
    });
  });

  it('reviews without backoff state when Valkey is unavailable', async () => {
    const inertStore = new AbandonedPaymentHandoffService(db as never, toss as never, locks as never);
    await expect(inertStore.sweepAbandonedPaymentHandoffs(NOW)).resolves.toMatchObject({ failedReservations: 1 });
  });

  it('is inert without a provider client', async () => {
    const inert = new AbandonedPaymentHandoffService(db as never, undefined, locks as never, store as never);
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
