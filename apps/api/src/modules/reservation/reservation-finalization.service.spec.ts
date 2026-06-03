import { BadRequestException } from '@nestjs/common';
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
  const providerChargeQuoteService = {
    parseProviderDecimalToMinor: vi.fn(),
  };

  const service = new ReservationFinalizationService(
    db as never,
    tossClient as never,
    bookingService as never,
    bookingGateway as never,
    qrTicketService as never,
    providerChargeQuoteService as never,
  );

  return {
    service,
    db,
    tossClient,
    bookingService,
    bookingGateway,
    qrTicketService,
    providerChargeQuoteService,
  };
}

describe('ReservationFinalizationService', () => {
  it('confirms PayPal with the stored USD provider quote and stores KRW payment totals', async () => {
    const {
      service,
      db,
      tossClient,
      bookingService,
      qrTicketService,
      providerChargeQuoteService,
    } = createDependencies();
    const insertedValues: unknown[] = [];
    providerChargeQuoteService.parseProviderDecimalToMinor.mockReturnValue(10800);

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-paypal-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
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
          price: 46000,
          row: 'A',
          number: '2',
        },
      ]));
    tossClient.confirmPayment.mockResolvedValue({
      paymentKey: 'payment-key-paypal',
      orderId: 'order-paypal-1',
      method: 'FOREIGN_EASY_PAY',
      totalAmount: 108,
      approvedAt: '2026-05-29T10:01:00.000Z',
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
              returning: vi.fn().mockResolvedValue([{ id: 'payment-paypal-1' }]),
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
          paymentKey: 'payment-key-paypal',
          orderId: 'order-paypal-1',
          provider: 'PAYPAL',
          providerChargeAmount: '108.00',
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-paypal-1' });

    expect(providerChargeQuoteService.parseProviderDecimalToMinor).toHaveBeenCalledWith('108.00');
    expect(tossClient.confirmPayment).toHaveBeenCalledWith({
      paymentKey: 'payment-key-paypal',
      orderId: 'order-paypal-1',
      amount: 108,
    });
    expect(insertedValues).toContainEqual({
      table: payments,
      values: expect.objectContaining({
        reservationId: 'reservation-paypal-1',
        paymentKey: 'payment-key-paypal',
        tossOrderId: 'order-paypal-1',
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'KRW',
        asyncStatus: 'sync',
        amount: 150000,
        status: 'DONE',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerChargeRate: '0.00072',
        providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
      }),
    });
    expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-paypal-1',
      paymentId: 'payment-paypal-1',
    });
    expect(bookingService.consumeOwnedSeatLocks).toHaveBeenCalledWith(
      'user-1',
      'showtime-1',
      ['1F:A-1', '1F:A-2'],
      { skipUnavailableCheck: true },
    );
  });

  it('confirms overseas card with the overseas-card Toss secret scope and stores KRW card totals', async () => {
    const {
      service,
      db,
      tossClient,
      bookingService,
      qrTicketService,
    } = createDependencies();
    const insertedValues: unknown[] = [];

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-overseas-card-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 148000,
          row: 'A',
          number: '1',
        },
      ]));
    tossClient.confirmPayment.mockResolvedValue({
      paymentKey: 'payment-key-overseas-card',
      orderId: 'order-overseas-card-1',
      method: 'CARD',
      totalAmount: 150000,
      approvedAt: '2026-06-02T10:01:00.000Z',
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
              returning: vi.fn().mockResolvedValue([{ id: 'payment-overseas-card-1' }]),
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
          paymentKey: 'payment-key-overseas-card',
          orderId: 'order-overseas-card-1',
          provider: 'OVERSEAS_CARD',
          amount: 150000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-overseas-card-1' });

    expect(tossClient.confirmPayment).toHaveBeenCalledWith({
      paymentKey: 'payment-key-overseas-card',
      orderId: 'order-overseas-card-1',
      amount: 150000,
      secretKeyScope: 'overseas-card',
    });
    expect(insertedValues).toContainEqual({
      table: payments,
      values: expect.objectContaining({
        reservationId: 'reservation-overseas-card-1',
        paymentKey: 'payment-key-overseas-card',
        tossOrderId: 'order-overseas-card-1',
        method: 'CARD',
        provider: 'CARD',
        providerMetadata: {
          requestedProvider: 'OVERSEAS_CARD',
          secretKeyScope: 'overseas-card',
        },
        currency: 'KRW',
        asyncStatus: 'sync',
        amount: 150000,
        status: 'DONE',
      }),
    });
    expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-overseas-card-1',
      paymentId: 'payment-overseas-card-1',
    });
    expect(bookingService.consumeOwnedSeatLocks).toHaveBeenCalledWith(
      'user-1',
      'showtime-1',
      ['1F:A-1'],
      { skipUnavailableCheck: true },
    );
  });

  it('confirms USD overseas card with the stored provider quote and stores KRW card totals', async () => {
    const {
      service,
      db,
      tossClient,
      bookingService,
      qrTicketService,
      providerChargeQuoteService,
    } = createDependencies();
    const insertedValues: unknown[] = [];
    providerChargeQuoteService.parseProviderDecimalToMinor.mockReturnValue(10800);

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-overseas-card-usd-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 148000,
          row: 'A',
          number: '1',
        },
      ]));
    tossClient.confirmPayment.mockResolvedValue({
      paymentKey: 'payment-key-overseas-card-usd',
      orderId: 'order-overseas-card-usd-1',
      method: 'CARD',
      totalAmount: 108,
      approvedAt: '2026-06-02T10:01:00.000Z',
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
              returning: vi.fn().mockResolvedValue([{ id: 'payment-overseas-card-usd-1' }]),
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
          paymentKey: 'payment-key-overseas-card-usd',
          orderId: 'order-overseas-card-usd-1',
          provider: 'OVERSEAS_CARD',
          providerChargeAmount: '108.00',
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-overseas-card-usd-1' });

    expect(providerChargeQuoteService.parseProviderDecimalToMinor).toHaveBeenCalledWith('108.00');
    expect(tossClient.confirmPayment).toHaveBeenCalledWith({
      paymentKey: 'payment-key-overseas-card-usd',
      orderId: 'order-overseas-card-usd-1',
      amount: 108,
      secretKeyScope: 'overseas-card',
    });
    expect(insertedValues).toContainEqual({
      table: payments,
      values: expect.objectContaining({
        reservationId: 'reservation-overseas-card-usd-1',
        paymentKey: 'payment-key-overseas-card-usd',
        tossOrderId: 'order-overseas-card-usd-1',
        method: 'CARD',
        provider: 'CARD',
        providerMetadata: {
          requestedProvider: 'OVERSEAS_CARD',
          secretKeyScope: 'overseas-card',
        },
        currency: 'KRW',
        asyncStatus: 'sync',
        amount: 150000,
        status: 'DONE',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerChargeRate: '0.00072',
        providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
      }),
    });
    expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-overseas-card-usd-1',
      paymentId: 'payment-overseas-card-usd-1',
    });
    expect(bookingService.consumeOwnedSeatLocks).toHaveBeenCalledWith(
      'user-1',
      'showtime-1',
      ['1F:A-1'],
      { skipUnavailableCheck: true },
    );
  });

  it('rejects PayPal provider amount mismatch before confirming with Toss', async () => {
    const {
      service,
      db,
      tossClient,
      providerChargeQuoteService,
    } = createDependencies();
    providerChargeQuoteService.parseProviderDecimalToMinor.mockReturnValue(10799);

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-paypal-mismatch',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: new Date('2026-05-29T10:00:00.000Z'),
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 148000,
          row: 'A',
          number: '1',
        },
      ]));

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-paypal',
          orderId: 'order-paypal-mismatch',
          provider: 'PAYPAL',
          providerChargeAmount: '107.99',
        },
        'user-1',
      ),
    ).rejects.toThrow(new BadRequestException('PayPal 결제 금액이 일치하지 않습니다'));

    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

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
