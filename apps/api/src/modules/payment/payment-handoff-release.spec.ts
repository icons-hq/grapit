import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentMethod } from '@grabit/shared';
import { PaymentService } from './payment.service.js';
import { PAYMENT_HANDOFF_RELEASE_WINDOW_MS } from './payment-handoff-policy.js';
import { PAYMENT_CONFIRM_ATTEMPT_MARKER_TTL } from '../booking/booking.service.js';

function createSelectChain<T>(rows: T[]) {
  const chain = { from: vi.fn(), where: vi.fn() };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  return chain;
}

function createUpdateChain<T>(rows: T[]) {
  const chain = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(rows);
  return chain;
}

const CARD: PaymentMethod = { method: 'CARD', provider: 'CARD', currency: 'KRW' };
const NOW = new Date('2026-10-02T03:00:00.000Z');
const DEADLINE = new Date('2026-10-02T03:08:00.000Z');

describe('PaymentService.releaseTossPaymentHandoff', () => {
  let db: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let locks: {
    acquirePaymentConfirmLock: ReturnType<typeof vi.fn>;
    releasePaymentConfirmLock: ReturnType<typeof vi.fn>;
    hasPaymentConfirmAttempt: ReturnType<typeof vi.fn>;
  };
  let service: PaymentService;

  function pendingReservation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'reservation-handoff',
      status: 'PENDING_PAYMENT',
      paymentDeadlineAt: DEADLINE,
      checkoutPaymentMethod: CARD,
      checkoutStartedAt: new Date(NOW.getTime() - 2_000),
      ...overrides,
    };
  }

  beforeEach(() => {
    db = { select: vi.fn(), update: vi.fn() };
    locks = {
      acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
      releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
      hasPaymentConfirmAttempt: vi.fn().mockResolvedValue(false),
    };
    service = new PaymentService(
      db as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      locks as never,
    );
  });

  it('keeps a confirm attempt visible far beyond the release window', () => {
    expect(PAYMENT_CONFIRM_ATTEMPT_MARKER_TTL * 1000).toBeGreaterThan(PAYMENT_HANDOFF_RELEASE_WINDOW_MS * 10);
  });

  it('reopens a card checkout whose SDK rejected before the provider opened, under the confirm lease', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation()]));
    const update = createUpdateChain([{ id: 'reservation-handoff', paymentDeadlineAt: DEADLINE }]);
    db.update.mockReturnValue(update);

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-RELEASE', userId: 'buyer' },
      NOW,
    )).resolves.toEqual({
      orderId: 'GRP-RELEASE',
      released: true,
      paymentDeadlineAt: DEADLINE.toISOString(),
    });

    expect(update.set).toHaveBeenCalledWith({ checkoutStartedAt: null, updatedAt: NOW });
    expect(locks.acquirePaymentConfirmLock).toHaveBeenCalledWith('GRP-RELEASE', expect.any(String));
    const leaseToken = locks.acquirePaymentConfirmLock.mock.calls[0]![1];
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledWith('GRP-RELEASE', leaseToken);
    expect(locks.acquirePaymentConfirmLock.mock.invocationCallOrder[0]!)
      .toBeLessThan(locks.hasPaymentConfirmAttempt.mock.invocationCallOrder[0]!);
    expect(locks.hasPaymentConfirmAttempt).toHaveBeenCalledWith('GRP-RELEASE');
    expect(locks.hasPaymentConfirmAttempt.mock.invocationCallOrder[0]!)
      .toBeLessThan(db.update.mock.invocationCallOrder[0]!);
    expect(db.update.mock.invocationCallOrder[0]!)
      .toBeLessThan(locks.releasePaymentConfirmLock.mock.invocationCallOrder[0]!);
  });

  it('never reopens an order once a confirm ran for it, even after that confirm released its lease', async () => {
    // A confirm that timed out at the provider (or failed to record its approval)
    // leaves no Payment row and frees the lease; only its attempt marker remains.
    db.select.mockReturnValue(createSelectChain([pendingReservation()]));
    locks.hasPaymentConfirmAttempt.mockResolvedValue(true);

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-CONFIRM-UNKNOWN', userId: 'buyer' },
      NOW,
    )).rejects.toThrow(new ConflictException('결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.'));
    expect(db.update).not.toHaveBeenCalled();
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledTimes(1);
  });

  it('keeps the handoff when the confirm-attempt marker cannot be read', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation()]));
    locks.hasPaymentConfirmAttempt.mockRejectedValue(new Error('ECONNRESET'));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-MARKER-DOWN', userId: 'buyer' },
      NOW,
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.update).not.toHaveBeenCalled();
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent once the handoff was already released', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation({ checkoutStartedAt: null })]));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-RELEASED', userId: 'buyer' },
      NOW,
    )).resolves.toMatchObject({ released: true });
    expect(locks.acquirePaymentConfirmLock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('never releases an asynchronous wallet handoff, which can be approved without a merchant confirm', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation({
      checkoutPaymentMethod: {
        method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', currency: 'USD', pendingUrlRequired: true,
      },
    })]));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-ALIPAY', userId: 'buyer' },
      NOW,
    )).rejects.toThrow(new ConflictException('결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.'));
    expect(locks.acquirePaymentConfirmLock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses a handoff older than the release window, whose provider result may be unknown', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation({
      checkoutStartedAt: new Date(NOW.getTime() - PAYMENT_HANDOFF_RELEASE_WINDOW_MS - 1),
    })]));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-OLD', userId: 'buyer' },
      NOW,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses while a payment confirm holds the order lease', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation()]));
    locks.acquirePaymentConfirmLock.mockResolvedValue(false);

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-CONFIRMING', userId: 'buyer' },
      NOW,
    )).rejects.toThrow(new ConflictException('결제 확인이 이미 진행 중입니다.'));
    expect(db.update).not.toHaveBeenCalled();
    expect(locks.releasePaymentConfirmLock).not.toHaveBeenCalled();
  });

  it('reports lease service outages as retryable instead of releasing', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation()]));
    locks.acquirePaymentConfirmLock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-REDIS-DOWN', userId: 'buyer' },
      NOW,
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('keeps the handoff when a payment row or another state change wins the conditional update', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation()]));
    db.update.mockReturnValue(createUpdateChain([]));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-RACE', userId: 'buyer' },
      NOW,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(locks.releasePaymentConfirmLock).toHaveBeenCalledTimes(1);
  });

  it('does not reveal or release another buyer\'s order', async () => {
    db.select.mockReturnValue(createSelectChain([]));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-OTHER', userId: 'intruder' },
      NOW,
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a finished order', async () => {
    db.select.mockReturnValue(createSelectChain([pendingReservation({ status: 'CONFIRMED' })]));

    await expect(service.releaseTossPaymentHandoff(
      { orderId: 'GRP-DONE', userId: 'buyer' },
      NOW,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(locks.acquirePaymentConfirmLock).not.toHaveBeenCalled();
  });
});
