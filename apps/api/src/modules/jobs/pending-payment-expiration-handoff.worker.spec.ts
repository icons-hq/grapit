import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PendingPaymentExpirationWorker } from './pending-payment-expiration.worker.js';

function createDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) };
}

function createConfig(values: Record<string, string> = {}) {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

const NOW = new Date('2026-10-02T05:00:00.000Z');

describe('PendingPaymentExpirationWorker abandoned handoff review', () => {
  it('adds provider-proven abandoned handoffs to the expiration result', async () => {
    const abandoned = {
      sweepAbandonedPaymentHandoffs: vi.fn().mockResolvedValue({
        reviewedReservations: 3,
        failedReservations: 2,
      }),
    };
    const worker = new PendingPaymentExpirationWorker(
      createDb([{ id: 'expired', user_id: 'u', showtime_id: 's' }]) as never,
      {} as never,
      createConfig(),
      abandoned as never,
    );

    await expect(worker.sweepExpiredPendingPayments(NOW)).resolves.toEqual({
      expiredReservations: 3,
      unlockedSeats: 0,
    });
    expect(abandoned.sweepAbandonedPaymentHandoffs).toHaveBeenCalledWith(NOW);
  });

  it('keeps the regular expiration result when the handoff review fails', async () => {
    const abandoned = {
      sweepAbandonedPaymentHandoffs: vi.fn().mockRejectedValue(new Error('Toss unavailable')),
    };
    const worker = new PendingPaymentExpirationWorker(
      createDb([{ id: 'expired', user_id: 'u', showtime_id: 's' }]) as never,
      {} as never,
      createConfig(),
      abandoned as never,
    );

    await expect(worker.sweepExpiredPendingPayments(NOW)).resolves.toEqual({
      expiredReservations: 1,
      unlockedSeats: 0,
    });
  });

  it('can be switched off without a deploy of new code', async () => {
    const abandoned = { sweepAbandonedPaymentHandoffs: vi.fn() };
    const worker = new PendingPaymentExpirationWorker(
      createDb() as never,
      {} as never,
      createConfig({ PAYMENT_HANDOFF_ABANDON_SWEEP_ENABLED: 'false' }),
      abandoned as never,
    );

    await worker.sweepExpiredPendingPayments(NOW);
    expect(abandoned.sweepAbandonedPaymentHandoffs).not.toHaveBeenCalled();
  });
});
