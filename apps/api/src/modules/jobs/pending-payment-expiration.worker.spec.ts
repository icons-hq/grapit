import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import {
  ASYNC_PAYMENT_HANDOFF_STATUSES,
  PendingPaymentExpirationWorker,
} from './pending-payment-expiration.worker.js';

function createDb(rows: Array<Record<string, unknown>>) {
  return {
    execute: vi.fn().mockResolvedValue({ rows }),
  };
}

function createBookingService() {
  return {
    unlockAllSeats: vi.fn().mockResolvedValue({ unlockedSeats: ['1F:A-1', '1F:A-2'] }),
  };
}

function createConfig(intervalMs = '60000') {
  return {
    get: vi.fn((key: string) =>
      key === 'PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS' ? intervalMs : undefined
    ),
  } as unknown as ConfigService;
}

describe('PendingPaymentExpirationWorker', () => {
  it('marks expired pending reservations failed and releases their Redis seat locks', async () => {
    const db = createDb([
      {
        id: 'reservation-1',
        user_id: 'user-1',
        showtime_id: 'showtime-1',
      },
    ]);
    const bookingService = createBookingService();
    const worker = new PendingPaymentExpirationWorker(
      db as never,
      bookingService as never,
      createConfig(),
    );

    const result = await worker.sweepExpiredPendingPayments(
      new Date('2026-06-04T10:00:00.000Z'),
    );

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(bookingService.unlockAllSeats).toHaveBeenCalledWith('user-1', 'showtime-1');
    expect(result).toEqual({
      expiredReservations: 1,
      unlockedSeats: 2,
    });
  });

  it('ignores rows the database query did not return as expired', async () => {
    const db = createDb([]);
    const bookingService = createBookingService();
    const worker = new PendingPaymentExpirationWorker(
      db as never,
      bookingService as never,
      createConfig(),
    );

    const result = await worker.sweepExpiredPendingPayments(
      new Date('2026-06-04T10:00:00.000Z'),
    );

    expect(bookingService.unlockAllSeats).not.toHaveBeenCalled();
    expect(result).toEqual({
      expiredReservations: 0,
      unlockedSeats: 0,
    });
  });

  it('leaves payment-processing grace rows alone until their extended deadline expires', async () => {
    const db = createDb([]);
    const bookingService = createBookingService();
    const worker = new PendingPaymentExpirationWorker(
      db as never,
      bookingService as never,
      createConfig(),
    );

    const result = await worker.sweepExpiredPendingPayments(
      new Date('2026-06-09T03:28:00.000Z'),
    );

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(bookingService.unlockAllSeats).not.toHaveBeenCalled();
    expect(result).toEqual({
      expiredReservations: 0,
      unlockedSeats: 0,
    });
  });

  it('defines async payment handoff statuses that must be excluded from expiration', () => {
    expect(ASYNC_PAYMENT_HANDOFF_STATUSES).toEqual(['IN_PROGRESS', 'DONE']);
  });

  it('leaves late DONE recovery to the webhook finalizer instead of expiring protected payments', () => {
    expect(ASYNC_PAYMENT_HANDOFF_STATUSES).toContain('DONE');
  });

  it('registers and clears the periodic sweep interval', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const worker = new PendingPaymentExpirationWorker(
      createDb([]) as never,
      createBookingService() as never,
      createConfig('15000'),
    );

    worker.onModuleInit();
    worker.onModuleDestroy();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
