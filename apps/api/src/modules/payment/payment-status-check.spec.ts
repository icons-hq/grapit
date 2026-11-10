import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PaymentService } from './payment.service.js';

function setup(overrides: Record<string, unknown> = {}, paymentKey: string | null = 'stored-key') {
  const reservation = { id: 'reservation', status: 'PENDING_PAYMENT', createdAt: new Date('2026-11-10T03:00:00Z'), checkoutStartedAt: new Date('2026-11-10T03:01:00Z'),
    checkoutPaymentMethod: { method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', currency: 'USD' }, ...overrides };
  const chain = (rows: unknown[]) => ({ from: () => ({ where: vi.fn().mockResolvedValue(rows) }) });
  const db = { select: vi.fn().mockReturnValueOnce(chain(overrides.missing ? [] : [reservation])).mockReturnValue(chain(paymentKey ? [{ paymentKey }] : [])), update: vi.fn() };
  const toss = { queryPaymentByOrderId: vi.fn(),
    queryTransactions: vi.fn().mockResolvedValue([{ transactionKey: 'tx', paymentKey: 'found-key', orderId: 'order' }]),
    cancelPayment: vi.fn() };
  const service = new PaymentService(db as never, undefined, undefined, toss as never);
  const reconcile = vi.spyOn(service, 'reconcileAsyncPaymentReturn').mockResolvedValue(undefined);
  const release = vi.spyOn(service, 'releaseTossPaymentHandoff');
  return { db, toss, service, reconcile, release };
}
const request = { orderId: 'order', userId: 'buyer' };

describe('owner-scoped manual payment status check', () => {
  it('refuses missing or other-owner orders before querying a provider', async () => {
    const { service, toss, reconcile } = setup({ missing: true });
    await expect(service.checkPaymentStatus(request)).rejects.toBeInstanceOf(NotFoundException);
    expect(toss.queryPaymentByOrderId).not.toHaveBeenCalled();
    expect(toss.queryTransactions).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
  it.each([{ status: 'CONFIRMED' }, { status: 'FAILED' }, { checkoutStartedAt: null },
    { checkoutPaymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' } }])('leaves settled or merchant-confirmed orders alone: %j', async (overrides) => {
    const { service, toss, reconcile } = setup(overrides);
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'not_needed' });
    expect(toss.queryPaymentByOrderId).not.toHaveBeenCalled(); expect(reconcile).not.toHaveBeenCalled();
    expect(toss.queryTransactions).not.toHaveBeenCalled();
  });
  it('reconciles the stored key through the existing verified async return path', async () => {
    const { service, reconcile, release } = setup();
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'checked' });
    expect(reconcile).toHaveBeenCalledWith({ ...request, paymentKey: 'stored-key' });
    expect(release).not.toHaveBeenCalled();
  });
  it('discovers a missing return key through the supported foreign-MID ledger and verifies it before applying', async () => {
    const { service, toss, reconcile } = setup({}, null);
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'checked' });
    expect(toss.queryPaymentByOrderId).not.toHaveBeenCalled();
    expect(toss.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({
      secretKeyScope: 'foreign-easy-pay', startDate: '2026-11-10T11:50:00', limit: 5000,
    }));
    expect(reconcile).toHaveBeenCalledWith({ ...request, paymentKey: 'found-key' });
  });
  it.each(['NOT_FOUND_PAYMENT', 'NOT_FOUND_MERCHANT', 'TIMEOUT'])('keeps an old handoff blocked when lookup fails with %s', async (code) => {
    const { service, toss, reconcile, release, db } = setup({}, null);
    toss.queryTransactions.mockRejectedValue({ code });
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'unavailable' });
    expect(reconcile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    expect(toss.cancelPayment).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
  });
  it('reports a successful empty-ledger check without treating it as proof that an async checkout can end', async () => {
    const { service, toss, reconcile, release, db } = setup({}, null);
    toss.queryTransactions.mockResolvedValue([{ transactionKey: 'other-tx', paymentKey: 'other-key', orderId: 'another-order' }]);
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'checked' });
    expect(reconcile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    expect(toss.cancelPayment).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
  });
  it.each([
    [{ transactionKey: 'tx', orderId: 'order' }],
    [{ transactionKey: 'tx1', orderId: 'order', paymentKey: 'one' }, { transactionKey: 'tx2', orderId: 'order', paymentKey: 'two' }],
    Array.from({ length: 5000 }, (_, i) => ({ transactionKey: `tx${i}`, orderId: 'another-order', paymentKey: 'other-key' })),
  ])('keeps incomplete or ambiguous provider evidence unresolved', async (...rows) => {
    const { service, toss, reconcile, db } = setup({}, null);
    toss.queryTransactions.mockResolvedValue(rows);
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'unavailable' });
    expect(reconcile).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
  });
  it('does not claim a successful check when provider reconciliation fails', async () => {
    const { service, reconcile } = setup(); reconcile.mockRejectedValue(new Error('mismatched order'));
    await expect(service.checkPaymentStatus(request)).resolves.toEqual({ outcome: 'unavailable' });
  });
});
