import { describe, expect, it, vi } from 'vitest';

import {
  payments,
  seatInventories,
  ticketItems,
} from '../../database/schema/index.js';
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
    ensureIssuedTicketsForReservation: vi.fn(),
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
          totalAmount: 154000,
          admissionActiveUntilAt: null,
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '1',
        },
        {
          seatId: '1F:A-2',
          tierName: 'R',
          price: 50000,
          row: 'A',
          number: '2',
        },
      ]));

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-1',
          orderId: 'order-1',
          amount: 154000,
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

  it('rejects confirmed retry when stored and requested amounts omit service fees', async () => {
    const { service, db, tossClient } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-confirmed-legacy',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'CONFIRMED',
          totalAmount: 200000,
          admissionActiveUntilAt: null,
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '1',
        },
        {
          seatId: '1F:A-2',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '2',
        },
      ]));

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-1',
          orderId: 'order-legacy-confirmed',
          amount: 200000,
        },
        'user-1',
      ),
    ).rejects.toThrow('금액이 일치하지 않습니다');

    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects pending confirmation when stored and requested amounts omit service fees', async () => {
    const { service, db, tossClient } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-pending-legacy',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 200000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '1',
        },
        {
          seatId: '1F:A-2',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '2',
        },
      ]));
    tossClient.confirmPayment.mockResolvedValue({
      paymentKey: 'payment-key-1',
      orderId: 'order-legacy-pending',
      method: '카드',
      totalAmount: 200000,
      approvedAt: '2026-05-28T10:00:00.000Z',
    });

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-1',
          orderId: 'order-legacy-pending',
          amount: 200000,
        },
        'user-1',
      ),
    ).rejects.toThrow('금액이 일치하지 않습니다');

    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('creates one active ticket item per confirmed seat with service fee', async () => {
    const { service, db, tossClient, bookingService, qrTicketService } = createDependencies();
    const insertedValues: unknown[] = [];

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 204000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '1',
        },
        {
          seatId: '1F:A-2',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '2',
        },
      ]));
    tossClient.confirmPayment.mockResolvedValue({
      paymentKey: 'payment-key-1',
      orderId: 'order-1',
      method: '카드',
      totalAmount: 204000,
      approvedAt: '2026-05-28T10:00:00.000Z',
    });

    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
          }),
        }),
      }),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: unknown) => {
          insertedValues.push({ table, values });
          if (table === payments) {
            return {
              returning: vi.fn().mockResolvedValue([{ id: 'payment-1' }]),
            };
          }
          if (table === seatInventories) {
            return {
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
              }),
            };
          }
          return {};
        }),
      })),
    };
    db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-1',
          orderId: 'order-1',
          amount: 204000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-1' });

    expect(insertedValues).toContainEqual({
      table: ticketItems,
      values: [
        expect.objectContaining({
          reservationId: 'reservation-1',
          paymentId: 'payment-1',
          showtimeId: 'showtime-1',
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
          reservationId: 'reservation-1',
          paymentId: 'payment-1',
          showtimeId: 'showtime-1',
          seatId: 'A-2',
          seatKey: '1F:A-2',
          serviceFee: 2000,
          status: 'active',
          admissionState: 'not_entered',
        }),
      ],
    });
    expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });
    expect(bookingService.consumeOwnedSeatLocks).toHaveBeenCalledWith(
      'user-1',
      'showtime-1',
      ['1F:A-1', '1F:A-2'],
      { skipUnavailableCheck: true },
    );
  });
});
