import { describe, expect, it, vi } from 'vitest';

import { ReservationFinalizationService } from './reservation-finalization.service.js';

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

function createDependencies() {
  const db = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  };
  const tossClient = {
    confirmPayment: vi.fn(),
    cancelPayment: vi.fn(),
  };
  const bookingService = {
    acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
    refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
    releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
    extendOwnedSeatLocks: vi.fn(),
    assertOwnedSeatLocks: vi.fn(),
    consumeOwnedSeatLocks: vi.fn(),
  };
  const bookingGateway = {
    broadcastSeatUpdate: vi.fn(),
  };
  const qrTicketService = {
    ensureIssuedTicketForReservation: vi.fn(),
  };

  const service = new ReservationFinalizationService(
    db as never,
    tossClient as never,
    bookingService as never,
    bookingGateway as never,
    qrTicketService as never,
  );

  return {
    service,
    db,
    tossClient,
    bookingService,
    bookingGateway,
    qrTicketService,
  };
}

describe('ReservationFinalizationService', () => {
  it('returns reservationId for already confirmed reservations without rendering detail', async () => {
    const { service, db, tossClient, bookingService } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-confirmed-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 150000,
          admissionActiveUntilAt: null,
        },
      ]));

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-1',
          orderId: 'order-1',
          amount: 150000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-confirmed-1' });

    expect(bookingService.acquirePaymentConfirmLock).toHaveBeenCalledWith(
      'order-1',
      expect.any(String),
    );
    expect(bookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(
      'order-1',
      expect.any(String),
    );
    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
