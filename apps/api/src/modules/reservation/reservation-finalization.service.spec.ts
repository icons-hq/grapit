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

function ticketLimitResult({
  performanceId = 'performance-1',
  maxTicketsPerUser = 999,
  activeTicketCount = 0,
}: {
  performanceId?: string;
  maxTicketsPerUser?: number;
  activeTicketCount?: number;
} = {}) {
  return {
    rows: [{
      performance_id: performanceId,
      max_tickets_per_user: maxTicketsPerUser,
      active_ticket_count: activeTicketCount,
    }],
  };
}

function createDependencies() {
  const db = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn().mockResolvedValue(ticketLimitResult()),
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
  it('rejects before Toss confirm when active tickets plus pending seats exceed maxTicketsPerUser', async () => {
    const {
      service,
      db,
      tossClient,
      bookingService,
    } = createDependencies();

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-cumulative-limit-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 156000,
          admissionActiveUntilAt: new Date(Date.now() + 60_000),
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 50000,
          row: 'A',
          number: '1',
        },
        {
          seatId: '1F:A-2',
          tierName: 'VIP',
          price: 50000,
          row: 'A',
          number: '2',
        },
        {
          seatId: '1F:A-3',
          tierName: 'VIP',
          price: 50000,
          row: 'A',
          number: '3',
        },
      ]));
    db.execute.mockResolvedValueOnce(ticketLimitResult({
      maxTicketsPerUser: 4,
      activeTicketCount: 2,
    }));

    await expect(
      service.confirmAndCreateReservation(
        { paymentKey: 'payment-key-1', orderId: 'order-cumulative-limit-1', amount: 156000 },
        'user-1',
      ),
    ).rejects.toThrow('이 공연은 1인 최대 4매까지 예매할 수 있습니다');

    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(bookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rechecks the cumulative ticket limit under an advisory transaction lock before issuing tickets', async () => {
    const {
      service,
      db,
      tossClient,
      bookingService,
      qrTicketService,
    } = createDependencies();

    db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-race-limit-1',
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
    db.execute.mockResolvedValueOnce(ticketLimitResult({
      maxTicketsPerUser: 2,
      activeTicketCount: 0,
    }));
    tossClient.confirmPayment.mockResolvedValue({
      paymentKey: 'payment-key-race-limit',
      orderId: 'order-race-limit-1',
      method: '카드',
      totalAmount: 204000,
      approvedAt: '2026-06-04T04:20:00.000Z',
    });
    tossClient.cancelPayment.mockResolvedValue({
      paymentKey: 'payment-key-race-limit',
      orderId: 'order-race-limit-1',
      method: '카드',
      totalAmount: 204000,
      status: 'CANCELED',
      cancels: [{ cancelStatus: 'DONE' }],
    });

    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(ticketLimitResult({
          maxTicketsPerUser: 2,
          activeTicketCount: 1,
        })),
      update: vi.fn(),
      insert: vi.fn(),
    };
    db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(
      service.confirmAndCreateReservation(
        { paymentKey: 'payment-key-race-limit', orderId: 'order-race-limit-1', amount: 204000 },
        'user-1',
      ),
    ).rejects.toThrow('이 공연은 1인 최대 2매까지 예매할 수 있습니다');

    expect(tossClient.confirmPayment).toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-race-limit',
      '예매 매수 제한 초과로 인한 자동 취소',
      expect.objectContaining({
        idempotencyKey: 'reservation-finalization-cancel:order-race-limit-1',
      }),
    );
    expect(qrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    expect(bookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
  });

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
      execute: vi.fn().mockResolvedValue(ticketLimitResult()),
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
      execute: vi.fn().mockResolvedValue(ticketLimitResult()),
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
      execute: vi.fn().mockResolvedValue(ticketLimitResult()),
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

  it('backfills overseas card metadata before returning confirmed duplicate payment', async () => {
    const { service, db, tossClient } = createDependencies();
    const setPaymentValues = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    db.update.mockReturnValue({
      set: setPaymentValues,
    });
    db.select
      .mockReturnValueOnce(chainResult([
        {
          id: 'payment-overseas-card-confirmed-1',
          reservationId: 'reservation-overseas-card-confirmed-1',
          status: 'DONE',
          paymentKey: 'payment-key-overseas-card-confirmed',
          tossOrderId: 'order-overseas-card-confirmed-1',
          method: 'CARD',
          provider: 'CARD',
          providerMetadata: null,
          currency: 'KRW',
          amount: 154000,
          paidAt: new Date('2026-06-02T10:01:00.000Z'),
          asyncStatus: 'sync',
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-overseas-card-confirmed-1',
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
          paymentKey: 'payment-key-overseas-card-confirmed',
          orderId: 'order-overseas-card-confirmed-1',
          provider: 'OVERSEAS_CARD',
          amount: 154000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-overseas-card-confirmed-1' });

    expect(db.update).toHaveBeenCalledWith(payments);
    expect(setPaymentValues).toHaveBeenCalledWith({
      providerMetadata: {
        requestedProvider: 'OVERSEAS_CARD',
        secretKeyScope: 'overseas-card',
      },
    });
    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('preserves existing object metadata when returning confirmed duplicate payment', async () => {
    const { service, db, tossClient } = createDependencies();
    db.select
      .mockReturnValueOnce(chainResult([
        {
          id: 'payment-overseas-card-confirmed-2',
          reservationId: 'reservation-overseas-card-confirmed-2',
          status: 'DONE',
          paymentKey: 'payment-key-overseas-card-confirmed-2',
          tossOrderId: 'order-overseas-card-confirmed-2',
          method: 'CARD',
          provider: 'CARD',
          providerMetadata: { existing: true },
          currency: 'KRW',
          amount: 154000,
          paidAt: new Date('2026-06-02T10:01:00.000Z'),
          asyncStatus: 'sync',
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-overseas-card-confirmed-2',
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
          paymentKey: 'payment-key-overseas-card-confirmed-2',
          orderId: 'order-overseas-card-confirmed-2',
          provider: 'OVERSEAS_CARD',
          amount: 154000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-overseas-card-confirmed-2' });

    expect(db.update).not.toHaveBeenCalled();
    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not backfill domestic card metadata on overseas-card confirmed retry', async () => {
    const { service, db, tossClient } = createDependencies();
    db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    db.select
      .mockReturnValueOnce(chainResult([
        {
          id: 'payment-domestic-card-confirmed-1',
          reservationId: 'reservation-domestic-card-confirmed-1',
          status: 'DONE',
          paymentKey: 'payment-key-domestic-card-confirmed',
          tossOrderId: 'order-domestic-card-confirmed-1',
          method: '카드',
          provider: 'CARD',
          providerMetadata: null,
          currency: 'KRW',
          amount: 154000,
          paidAt: new Date('2026-06-02T10:01:00.000Z'),
          asyncStatus: 'sync',
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-domestic-card-confirmed-1',
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
          paymentKey: 'payment-key-domestic-card-confirmed',
          orderId: 'order-domestic-card-confirmed-1',
          provider: 'OVERSEAS_CARD',
          amount: 154000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-domestic-card-confirmed-1' });

    expect(db.update).not.toHaveBeenCalled();
    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not backfill confirmed duplicate metadata when payment identity mismatches', async () => {
    const { service, db, tossClient } = createDependencies();
    db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    db.select
      .mockReturnValueOnce(chainResult([
        {
          id: 'payment-overseas-card-confirmed-mismatch',
          reservationId: 'reservation-overseas-card-confirmed-mismatch',
          status: 'DONE',
          paymentKey: 'different-payment-key',
          tossOrderId: 'different-order-id',
          method: 'CARD',
          provider: 'CARD',
          providerMetadata: null,
          currency: 'KRW',
          amount: 154000,
          paidAt: new Date('2026-06-02T10:01:00.000Z'),
          asyncStatus: 'sync',
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-overseas-card-confirmed-mismatch',
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
          paymentKey: 'payment-key-overseas-card-confirmed-mismatch',
          orderId: 'order-overseas-card-confirmed-mismatch',
          provider: 'OVERSEAS_CARD',
          amount: 154000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-overseas-card-confirmed-mismatch' });

    expect(db.update).not.toHaveBeenCalled();
    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not write overseas-card metadata when recovering a domestic card payment', async () => {
    const { service, db, tossClient, bookingService, qrTicketService } = createDependencies();
    const updatedValues: Array<{ table: unknown; values: Record<string, unknown> }> = [];

    db.select
      .mockReturnValueOnce(chainResult([
        {
          id: 'payment-domestic-card-recovery-1',
          reservationId: 'reservation-domestic-card-recovery-1',
          status: 'DONE',
          paymentKey: 'payment-key-domestic-card-recovery',
          tossOrderId: 'order-domestic-card-recovery-1',
          method: '카드',
          provider: 'CARD',
          providerMetadata: null,
          currency: 'KRW',
          amount: 154000,
          paidAt: new Date('2026-06-02T10:01:00.000Z'),
          asyncStatus: 'sync',
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-domestic-card-recovery-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 154000,
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
          tierName: 'R',
          price: 50000,
          row: 'A',
          number: '2',
        },
      ]));

    const tx = {
      execute: vi.fn().mockResolvedValue(ticketLimitResult()),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updatedValues.push({ table, values });
          return {
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
            }),
          };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockReturnValue({}),
      })),
    };
    db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-domestic-card-recovery',
          orderId: 'order-domestic-card-recovery-1',
          provider: 'OVERSEAS_CARD',
          amount: 154000,
        },
        'user-1',
      ),
    ).resolves.toEqual({ reservationId: 'reservation-domestic-card-recovery-1' });

    const paymentUpdate = updatedValues.find((entry) => entry.table === payments);
    expect(paymentUpdate?.values).toEqual(expect.objectContaining({
      status: 'DONE',
      amount: 154000,
      asyncStatus: 'sync',
    }));
    expect(paymentUpdate?.values).not.toHaveProperty('providerMetadata');
    expect(tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-domestic-card-recovery-1',
      paymentId: 'payment-domestic-card-recovery-1',
    });
    expect(bookingService.consumeOwnedSeatLocks).toHaveBeenCalledWith(
      'user-1',
      'showtime-1',
      ['1F:A-1', '1F:A-2'],
      { skipUnavailableCheck: true },
    );
  });

  it('uses overseas-card secret scope when compensating an existing approved overseas-card payment', async () => {
    const { service, db, tossClient, bookingService } = createDependencies();
    const updateValues: Record<string, unknown>[] = [];
    db.select
      .mockReturnValueOnce(chainResult([
        {
          id: 'payment-overseas-card-compensation-1',
          reservationId: 'reservation-overseas-card-compensation-1',
          status: 'DONE',
          paymentKey: 'payment-key-overseas-card-compensation',
          tossOrderId: 'order-overseas-card-compensation-1',
          method: 'CARD',
          provider: 'CARD',
          providerMetadata: {
            requestedProvider: 'OVERSEAS_CARD',
            secretKeyScope: 'overseas-card',
          },
          currency: 'KRW',
          amount: 154000,
          paidAt: new Date('2026-06-02T10:01:00.000Z'),
          asyncStatus: 'sync',
        },
      ]))
      .mockReturnValueOnce(chainResult([
        {
          id: 'reservation-overseas-card-compensation-1',
          userId: 'user-1',
          showtimeId: 'showtime-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 154000,
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
          tierName: 'R',
          price: 50000,
          row: 'A',
          number: '2',
        },
      ]));
    db.update.mockReturnValue({
      set: vi.fn((values: Record<string, unknown>) => {
        updateValues.push(values);
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      }),
    });
    bookingService.extendOwnedSeatLocks.mockRejectedValue(
      new Error('seat lock unavailable'),
    );
    tossClient.cancelPayment.mockResolvedValue({
      paymentKey: 'payment-key-overseas-card-compensation',
      orderId: 'order-overseas-card-compensation-1',
      method: 'CARD',
      totalAmount: 154000,
      status: 'CANCELED',
      approvedAt: '2026-06-02T10:01:00.000Z',
      cancels: [
        {
          cancelAmount: 154000,
          cancelReason: '좌석 점유 만료로 인한 자동 취소',
          canceledAt: '2026-06-02T10:02:00.000Z',
          cancelStatus: 'DONE',
        },
      ],
    });

    await expect(
      service.confirmAndCreateReservation(
        {
          paymentKey: 'payment-key-overseas-card-compensation',
          orderId: 'order-overseas-card-compensation-1',
          provider: 'OVERSEAS_CARD',
          amount: 154000,
        },
        'user-1',
      ),
    ).rejects.toThrow('seat lock unavailable');

    expect(tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-overseas-card-compensation',
      '좌석 점유 만료로 인한 자동 취소',
      expect.objectContaining({
        secretKeyScope: 'overseas-card',
        idempotencyKey: 'reservation-finalization-cancel:order-overseas-card-compensation-1',
      }),
    );
    expect(updateValues).toContainEqual(expect.objectContaining({
      status: 'CANCELED',
      cancelReason: '좌석 점유 만료로 인한 자동 취소',
    }));
    expect(updateValues).toContainEqual(expect.objectContaining({
      status: 'FAILED',
    }));
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
      execute: vi.fn().mockResolvedValue(ticketLimitResult()),
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
