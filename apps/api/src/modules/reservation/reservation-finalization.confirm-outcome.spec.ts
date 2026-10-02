import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  payments,
  reservationPaymentFailureDiagnostics,
  reservations,
  seatInventories,
  ticketItems,
} from '../../database/schema/index.js';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE,
  PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE,
  ReservationFinalizationService,
  SHOWTIME_SALES_CLOSED_MESSAGE,
} from './reservation-finalization.service.js';

/**
 * Regression tests for the payment confirm core (audit #1, #2, #17, #18, #19,
 * #72, #73, #74): provider approval validation, unknown provider outcomes,
 * transient DB retries, confirm lease loss and post-commit side effects.
 */

const FUTURE = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = () => new Date(Date.now() - 60 * 1000);

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

function executeResult(showtimeStartsAt: Date = FUTURE()) {
  // One row answers both the ticket limit snapshot and the showtime cutoff.
  return {
    rows: [{
      performance_id: 'performance-1',
      max_tickets_per_user: 999,
      active_ticket_count: 0,
      date_time: showtimeStartsAt,
    }],
  };
}

type ReservationRow = Record<string, unknown>;

const SEATS = [
  { seatId: '1F:A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
  { seatId: '1F:A-2', tierName: 'VIP', price: 46000, row: 'A', number: '2' },
];
// 146000 seats + 2 x 2000 service fee
const TOTAL_KRW = 150000;

function domesticReservation(overrides: ReservationRow = {}): ReservationRow {
  return {
    id: 'reservation-1',
    userId: 'user-1',
    showtimeId: 'showtime-1',
    status: 'PENDING_PAYMENT',
    totalAmount: TOTAL_KRW,
    admissionActiveUntilAt: new Date(Date.now() + 60_000),
    checkoutPaymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' },
    ...overrides,
  };
}

function paypalReservation(overrides: ReservationRow = {}): ReservationRow {
  return domesticReservation({
    providerChargeCurrency: 'USD',
    providerChargeAmountMinor: 10800,
    providerChargeRate: '0.00072',
    providerChargeQuotedAt: new Date('2026-09-30T10:00:00.000Z'),
    checkoutPaymentMethod: { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' },
    ...overrides,
  });
}

function overseasCardReservation(overrides: ReservationRow = {}): ReservationRow {
  return paypalReservation({
    checkoutPaymentMethod: { method: 'CARD', provider: 'CARD', currency: 'USD' },
    ...overrides,
  });
}

function domesticApproval(overrides: Record<string, unknown> = {}) {
  return {
    paymentKey: 'payment-key-1',
    orderId: 'order-1',
    status: 'DONE',
    currency: 'KRW',
    method: '카드',
    totalAmount: TOTAL_KRW,
    approvedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const DOMESTIC_DTO = { paymentKey: 'payment-key-1', orderId: 'order-1', amount: TOTAL_KRW };
const PAYPAL_DTO = {
  paymentKey: 'payment-key-1',
  orderId: 'order-1',
  provider: 'PAYPAL' as const,
  providerChargeAmount: '108.00',
};
const OVERSEAS_CARD_DTO = {
  paymentKey: 'payment-key-1',
  orderId: 'order-1',
  provider: 'OVERSEAS_CARD' as const,
  providerChargeAmount: '108.00',
};

function issuanceTx() {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const tx = {
    execute: vi.fn().mockResolvedValue(executeResult()),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
        }),
      }),
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserted.push({ table, values });
        if (table === payments) {
          return { returning: vi.fn().mockResolvedValue([{ id: 'payment-1' }]) };
        }
        if (table === ticketItems) {
          return {
            returning: vi.fn().mockResolvedValue([
              { id: 'ticket-item-1', tierName: 'VIP' },
              { id: 'ticket-item-2', tierName: 'VIP' },
            ]),
          };
        }
        if (table === seatInventories) {
          return {
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
            }),
          };
        }
        return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    select: vi.fn(() => chainResult([])),
  };
  return { tx, inserted };
}

function createDependencies(options: {
  reservation: ReservationRow;
  existingPayment?: Record<string, unknown>;
  showtimeStartsAt?: Date;
  /** Whether an earlier attempt already sent this order to Toss confirm. */
  providerConfirmSent?: boolean;
} = { reservation: domesticReservation() }) {
  const rootInserts: Array<{ table: unknown; values: unknown }> = [];
  const db = {
    select: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        rootInserts.push({ table, values });
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          // The compensation claim row.
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'payment-claim-1' }]),
          }),
        };
      }),
    })),
    execute: vi.fn().mockResolvedValue(executeResult(options.showtimeStartsAt)),
    transaction: vi.fn(),
  };
  db.select
    .mockReturnValueOnce(chainResult(options.existingPayment ? [options.existingPayment] : []))
    .mockReturnValueOnce(chainResult([options.reservation]))
    .mockReturnValueOnce(chainResult(SEATS));
  // Later reads (finalization state lookups) see no committed payment.
  db.select.mockImplementation(() => chainResult([]));

  const tossClient = {
    confirmPayment: vi.fn(),
    cancelPayment: vi.fn().mockResolvedValue({
      paymentKey: 'payment-key-1',
      orderId: 'order-1',
      status: 'CANCELED',
      totalAmount: TOTAL_KRW,
      cancels: [{ cancelStatus: 'DONE' }],
    }),
    queryPayment: vi.fn(),
  };
  const bookingService = {
    acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
    refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
    releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
    extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    consumeOwnedSeatLocks: vi.fn().mockResolvedValue({ consumedSeatIds: [] }),
  };
  const bookingGateway = { broadcastSeatUpdate: vi.fn() };
  const qrTicketService = { ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([]) };
  const providerChargeQuoteService = {
    parseProviderDecimalToMinor: vi.fn((value: string) => Math.round(Number(value) * 100)),
  };

  const pgBoss = {
    isAvailable: true,
    processesJobs: true,
    createQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('job-1'),
    work: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const markerValues = new Map<string, string>();
  if (options.providerConfirmSent ?? true) {
    markerValues.set('{payment-provider-confirm}:order-1', 'payment-key-1');
  }
  const providerConfirmMarkers = {
    set: vi.fn(async (key: string, value: string) => {
      markerValues.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => markerValues.get(key) ?? null),
  };

  const service = new ReservationFinalizationService(
    db as never,
    tossClient as never,
    bookingService as never,
    bookingGateway as never,
    qrTicketService as never,
    providerChargeQuoteService as never,
    pgBoss as never,
    providerConfirmMarkers as never,
  );

  return {
    service,
    db,
    rootInserts,
    tossClient,
    bookingService,
    bookingGateway,
    qrTicketService,
    pgBoss,
    providerConfirmMarkers,
  };
}

/** Captures the payment/reservation updates of a completed compensation record. */
function withCompensationRecord(db: { transaction: ReturnType<typeof vi.fn> }) {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const inserts: unknown[] = [];
  const tx = {
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    insert: vi.fn((table: unknown) => {
      inserts.push(table);
      throw new Error('a compensation record never inserts in its transaction');
    }),
  };
  db.transaction.mockImplementation(async (cb: (value: typeof tx) => Promise<unknown>) => cb(tx));
  return { updates, inserts };
}

function expectRecordedCompensation(
  deps: ReturnType<typeof createDependencies>,
  record: ReturnType<typeof withCompensationRecord>,
  reason: string,
  diagnosticSource = 'payment_confirm',
) {
  expect(deps.rootInserts).toContainEqual({
    table: payments,
    values: expect.objectContaining({
      reservationId: 'reservation-1',
      paymentKey: 'payment-key-1',
      tossOrderId: 'order-1',
      status: 'DONE',
      asyncStatus: 'cancel_pending',
      cancelReason: reason,
    }),
  });
  expect(record.updates).toEqual([
    {
      table: payments,
      values: expect.objectContaining({ status: 'CANCELED', asyncStatus: 'compensation_cancelled' }),
    },
    { table: reservations, values: expect.objectContaining({ status: 'FAILED' }) },
  ]);
  expect(record.inserts).toEqual([]);
  expect(deps.rootInserts).toContainEqual({
    table: reservationPaymentFailureDiagnostics,
    values: expect.objectContaining({
      paymentId: 'payment-claim-1',
      diagnosticKind: 'payment_compensated_cancel',
      diagnosticCode: 'CONFIRM_APPROVAL_COMPENSATED',
      diagnosticMessage: reason,
      diagnosticSource,
    }),
  });
}

function reconcileJobs(deps: ReturnType<typeof createDependencies>) {
  return deps.pgBoss.send.mock.calls
    .filter(([name]) => name === 'payment-confirm-reconcile')
    .map(([, payload, options]) => ({ payload, options }));
}

function withIssuance(db: { transaction: ReturnType<typeof vi.fn> }) {
  const issuance = issuanceTx();
  db.transaction.mockImplementation(
    async (cb: (tx: typeof issuance.tx) => Promise<unknown>) => cb(issuance.tx),
  );
  return issuance;
}

describe('ReservationFinalizationService provider approval validation (#1, #74)', () => {
  it('cancels a PayPal approval that Toss settled in KRW instead of the USD quote', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    withIssuance(deps.db);
    // Attack: the same orderId authenticated as a domestic KRW 108 payment.
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({
      currency: 'KRW',
      method: '카드',
      totalAmount: 108,
    }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(deps.tossClient.confirmPayment).toHaveBeenCalledWith({
      paymentKey: 'payment-key-1',
      orderId: 'order-1',
      amount: 108,
    });
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '결제 승인 정보 불일치로 인한 자동 취소',
      expect.objectContaining({ idempotencyKey: 'reservation-finalization-cancel:order-1' }),
    );
    expect(deps.db.transaction).not.toHaveBeenCalled();
    expect(deps.qrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
  });

  it('cancels a PayPal approval whose method is not foreign easy pay', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({
      currency: 'USD',
      method: '카드',
      totalAmount: 108,
    }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('issues a PayPal approval only when Toss settled the quoted USD amount', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    const { inserted } = withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({
      currency: 'USD',
      method: '해외간편결제',
      totalAmount: 108,
    }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(inserted).toContainEqual({
      table: payments,
      values: expect.objectContaining({
        provider: 'PAYPAL',
        currency: 'KRW',
        amount: TOTAL_KRW,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
      }),
    });
  });

  it('rejects a PayPal confirm for a reservation prepared with another checkout method before calling Toss', async () => {
    const deps = createDependencies({ reservation: overseasCardReservation() });

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toThrow('예매에 저장된 결제수단과 PayPal 결제 요청이 일치하지 않습니다');

    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
  });

  it('rejects an overseas-card USD confirm for a domestic checkout before calling Toss', async () => {
    const deps = createDependencies({
      reservation: overseasCardReservation({
        checkoutPaymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' },
      }),
    });

    await expect(deps.service.confirmAndCreateReservation(OVERSEAS_CARD_DTO, 'user-1'))
      .rejects.toThrow('예매에 저장된 결제수단과 해외카드 결제 요청이 일치하지 않습니다');

    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
  });

  it('cancels an overseas-card approval whose USD amount differs from the quote', async () => {
    const deps = createDependencies({ reservation: overseasCardReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({
      currency: 'USD',
      method: 'CARD',
      totalAmount: 1.08,
    }));

    await expect(deps.service.confirmAndCreateReservation(OVERSEAS_CARD_DTO, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '결제 승인 정보 불일치로 인한 자동 취소',
      expect.objectContaining({ secretKeyScope: 'overseas-card' }),
    );
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('accepts the MUSD currency label used by the foreign merchant for an overseas-card approval', async () => {
    const deps = createDependencies({ reservation: overseasCardReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({
      currency: 'MUSD',
      method: 'CARD',
      totalAmount: 108,
    }));

    await expect(deps.service.confirmAndCreateReservation(OVERSEAS_CARD_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('cancels a domestic approval settled in a foreign currency', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({ currency: 'USD' }));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('does not issue tickets for a virtual account waiting for deposit and cancels it', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({
      status: 'WAITING_FOR_DEPOSIT',
      method: '가상계좌',
      approvedAt: null,
    }));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ConflictException);

    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '결제 미완료 상태로 인한 자동 취소',
      expect.objectContaining({ secretKeyScope: 'default' }),
    );
    expect(deps.db.transaction).not.toHaveBeenCalled();
    expect(deps.qrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
  });

  it('rejects a DONE approval made with a payment method that checkout does not sell', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval({ method: '문화상품권' }));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });
});

describe('ReservationFinalizationService showtime cutoff before approval (#2)', () => {
  it('rejects with 403 before calling Toss when the showtime has started', async () => {
    const deps = createDependencies({ reservation: domesticReservation(), showtimeStartsAt: PAST() });
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
      status: 'IN_PROGRESS',
      approvedAt: null,
    }));

    const result = deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toThrow(SHOWTIME_SALES_CLOSED_MESSAGE);

    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('answers a retryable 503 instead of a final 403 when the provider lookup for a started showtime fails', async () => {
    const deps = createDependencies({ reservation: domesticReservation(), showtimeStartsAt: PAST() });
    deps.tossClient.queryPayment.mockRejectedValue(new Error('fetch failed'));

    const result = deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a 5xx lookup', new TossPaymentError('PROVIDER_ERROR', 'gateway', 502)],
    ['a rate-limited lookup', new TossPaymentError('TOO_MANY_REQUESTS', 'slow down', 429)],
  ])('answers 503 for %s on a started showtime', async (_label, lookupError) => {
    const deps = createDependencies({ reservation: domesticReservation(), showtimeStartsAt: PAST() });
    deps.tossClient.queryPayment.mockRejectedValue(lookupError);

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
  });

  it('keeps the 403 when the provider proves no payment exists under the key', async () => {
    const deps = createDependencies({ reservation: domesticReservation(), showtimeStartsAt: PAST() });
    deps.tossClient.queryPayment.mockRejectedValue(
      new TossPaymentError('NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.', 404),
    );

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toThrow(SHOWTIME_SALES_CLOSED_MESSAGE);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
  });

  it('finalizes a payment an earlier attempt already approved even after the showtime started', async () => {
    const deps = createDependencies({ reservation: domesticReservation(), showtimeStartsAt: PAST() });
    withIssuance(deps.db);
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).toHaveBeenCalledOnce();
  });

  it('treats the scheduled start instant itself as closed', async () => {
    vi.useFakeTimers();
    try {
      const startsAt = new Date('2026-10-05T10:00:00.000Z');
      vi.setSystemTime(startsAt);
      const deps = createDependencies({
        reservation: domesticReservation({ admissionActiveUntilAt: new Date('2026-10-05T10:05:00.000Z') }),
        showtimeStartsAt: startsAt,
      });
      deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
        status: 'IN_PROGRESS',
        approvedAt: null,
      }));

      await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
        .rejects.toThrow(SHOWTIME_SALES_CLOSED_MESSAGE);
      expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not apply the cutoff to an already approved payment', async () => {
    const deps = createDependencies({
      reservation: domesticReservation(),
      showtimeStartsAt: PAST(),
      existingPayment: {
        id: 'payment-existing',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        tossOrderId: 'order-1',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        amount: TOTAL_KRW,
        status: 'DONE',
        asyncStatus: 'pending_webhook',
        paidAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    });
    withIssuance(deps.db);

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).toHaveBeenCalledOnce();
  });
});

describe('ReservationFinalizationService unknown provider outcome (#18, #73)', () => {
  it('recovers a timed-out confirm that Toss approved and issues tickets', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockRejectedValue(
      new TossPaymentError('PROVIDER_TIMEOUT', 'timeout'),
    );
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.tossClient.queryPayment).toHaveBeenCalledWith('payment-key-1', {});
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).toHaveBeenCalledOnce();
  });

  it('recovers ALREADY_PROCESSED_PAYMENT for a PayPal retry through a provider lookup', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockRejectedValue(
      new TossPaymentError('ALREADY_PROCESSED_PAYMENT', '이미 처리된 결제 입니다.', 400),
    );
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
      currency: 'USD',
      method: '해외간편결제',
      totalAmount: 108,
    }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('still validates a recovered approval and cancels a mismatching one', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockRejectedValue(
      new TossPaymentError('ALREADY_PROCESSED_PAYMENT', '이미 처리된 결제 입니다.', 400),
    );
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
      currency: 'KRW',
      method: '카드',
      totalAmount: 108,
    }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('returns 503 without cancelling when neither confirm nor lookup can prove the outcome', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    deps.tossClient.confirmPayment.mockRejectedValue(
      new TossPaymentError('NETWORK_ERROR', 'socket hang up'),
    );
    deps.tossClient.queryPayment.mockRejectedValue(new Error('fetch failed'));

    const result = deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);

    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('returns 503 while the provider still reports the payment in progress', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockRejectedValue(
      new TossPaymentError('PROVIDER_ERROR', 'gateway', 502),
    );
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
      status: 'IN_PROGRESS',
      approvedAt: null,
    }));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('never acts on a looked-up payment that belongs to another order', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockRejectedValue(
      new TossPaymentError('PROVIDER_TIMEOUT', 'timeout'),
    );
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({ orderId: 'someone-elses-order' }));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('records a provider-verified rejection so the reservation does not stay pending', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    const rejection = new TossPaymentError('REJECT_CARD_COMPANY', '카드사 거절', 403);
    deps.tossClient.confirmPayment.mockRejectedValue(rejection);
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
      status: 'ABORTED',
      approvedAt: null,
    }));
    const failureInserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const failureUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          failureInserts.push({ table, values });
          return {
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'payment-aborted-1' }]),
            }),
          };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          failureUpdates.push({ table, values });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    deps.db.transaction.mockImplementation(async (cb: (value: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBe(rejection);

    expect(failureInserts).toEqual([{
      table: payments,
      values: expect.objectContaining({
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        tossOrderId: 'order-1',
        status: 'ABORTED',
        asyncStatus: 'confirm_rejected',
        amount: TOTAL_KRW,
        paidAt: null,
      }),
    }]);
    expect(failureUpdates).toEqual([{ table: reservations, values: expect.objectContaining({ status: 'FAILED' }) }]);
    expect(deps.rootInserts).toContainEqual({
      table: reservationPaymentFailureDiagnostics,
      values: expect.objectContaining({
        reservationId: 'reservation-1',
        paymentId: 'payment-aborted-1',
        diagnosticCode: 'PAYMENT_ABORTED',
        diagnosticSource: 'payment_confirm',
      }),
    });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('keeps a definitive rejection unchanged when the provider still reports it in progress', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    const rejection = new TossPaymentError('REJECT_CARD_COMPANY', '카드사 거절', 403);
    deps.tossClient.confirmPayment.mockRejectedValue(rejection);
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({ status: 'IN_PROGRESS' }));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBe(rejection);
    expect(deps.db.transaction).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });
});

describe('ReservationFinalizationService transient DB failure after approval (#17)', () => {
  it('retries a deadlocked issuance transaction instead of refunding the payment', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    const issuance = issuanceTx();
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    deps.db.transaction
      .mockRejectedValueOnce(deadlock)
      .mockImplementation(async (cb: (tx: typeof issuance.tx) => Promise<unknown>) => cb(issuance.tx));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.db.transaction).toHaveBeenCalledTimes(2);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });
  });

  it('retries a wrapped pool acquire timeout from the drizzle error cause', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    const issuance = issuanceTx();
    const poolTimeout = new Error('Failed query', {
      cause: new Error('timeout exceeded when trying to connect'),
    });
    deps.db.transaction
      .mockRejectedValueOnce(poolTimeout)
      .mockImplementation(async (cb: (tx: typeof issuance.tx) => Promise<unknown>) => cb(issuance.tx));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('treats a commit whose acknowledgement was lost as committed', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.db.transaction.mockRejectedValueOnce(
      Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }),
    );
    deps.db.select
      .mockReturnValueOnce(chainResult([{
        id: 'payment-committed',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        tossOrderId: 'order-1',
        status: 'DONE',
        asyncStatus: 'sync',
      }]))
      .mockReturnValueOnce(chainResult([{ status: 'CONFIRMED' }]));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.db.transaction).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      paymentId: 'payment-committed',
    });
  });

  it('cancels only after the bounded retries are exhausted', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.db.transaction.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(InternalServerErrorException);

    expect(deps.db.transaction).toHaveBeenCalledTimes(3);
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '서버 오류로 인한 자동 취소',
      expect.anything(),
    );
  });

  it('does not retry a non-transient failure', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.db.transaction.mockRejectedValue(new Error('column does not exist'));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(InternalServerErrorException);
    expect(deps.db.transaction).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
  });
});

describe('ReservationFinalizationService confirm lease (#72)', () => {
  it('answers lock contention with a retryable 503', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.bookingService.acquirePaymentConfirmLock.mockResolvedValueOnce(false);

    const result = deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
  });

  it('returns the order committed by the finalizer that took over the lease without cancelling', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.bookingService.refreshPaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.bookingService.acquirePaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.db.select
      .mockReturnValueOnce(chainResult([{
        id: 'payment-webhook',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        tossOrderId: 'order-1',
        status: 'DONE',
        asyncStatus: 'payment_status_changed:done',
      }]))
      .mockReturnValueOnce(chainResult([{ status: 'CONFIRMED' }]));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('continues finalization after reacquiring an expired lease nobody else took', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.bookingService.refreshPaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    const lockToken = deps.bookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
    expect(deps.bookingService.acquirePaymentConfirmLock).toHaveBeenNthCalledWith(2, 'order-1', lockToken);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).toHaveBeenCalledOnce();
  });

  it('does not refund when a seat conflict comes from another finalizer committing the same order', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.db.transaction.mockRejectedValueOnce(new ConflictException('판매 불가능한 좌석입니다'));
    deps.db.select
      .mockReturnValueOnce(chainResult([{
        id: 'payment-webhook',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        tossOrderId: 'order-1',
        status: 'DONE',
        asyncStatus: 'payment_status_changed:done',
      }]))
      .mockReturnValueOnce(chainResult([{ status: 'CONFIRMED' }]));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('still refunds a seat conflict caused by another reservation', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.db.transaction.mockRejectedValueOnce(new ConflictException('판매 불가능한 좌석입니다'));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toThrow('판매 불가능한 좌석입니다');
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '판매 불가능 좌석으로 인한 자동 취소',
      expect.anything(),
    );
  });

  it('returns 503 without cancelling when the seat lock check fails for infrastructure reasons', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.bookingService.assertOwnedSeatLocks.mockRejectedValue(new Error('Connection is closed.'));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });
});

describe('ReservationFinalizationService post-commit side effects (#19)', () => {
  it('returns the committed reservation when QR issuance or reminder scheduling fails', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.qrTicketService.ensureIssuedTicketsForReservation.mockRejectedValue(
      new Error('pg-boss send failed'),
    );
    deps.bookingGateway.broadcastSeatUpdate.mockImplementation(() => {
      throw new Error('adapter down');
    });

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });
});

function paypalApproval(overrides: Record<string, unknown> = {}) {
  return domesticApproval({
    currency: 'USD',
    method: '해외간편결제',
    totalAmount: 108,
    ...overrides,
  });
}

const HOLD_EXPIRED_MESSAGE = '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.';

type GateCase = {
  gate: string;
  reservation: () => ReservationRow;
  arrange: (deps: ReturnType<typeof createDependencies>) => void;
  message: string;
  cancelReason: string;
};

const GATE_CASES: GateCase[] = [
  {
    gate: 'admission window',
    reservation: () => paypalReservation({ admissionActiveUntilAt: PAST() }),
    arrange: () => {},
    message: HOLD_EXPIRED_MESSAGE,
    cancelReason: '결제 유효 시간 초과로 인한 자동 취소',
  },
  {
    gate: 'ticket limit',
    reservation: () => paypalReservation(),
    arrange: (deps) => {
      deps.db.execute.mockResolvedValue({
        rows: [{
          performance_id: 'performance-1',
          max_tickets_per_user: 2,
          active_ticket_count: 1,
          date_time: FUTURE(),
        }],
      });
    },
    message: '1인 최대 2매',
    cancelReason: '예매 매수 제한 초과로 인한 자동 취소',
  },
  {
    gate: 'seat hold',
    reservation: () => paypalReservation(),
    arrange: (deps) => {
      deps.bookingService.extendOwnedSeatLocks.mockRejectedValue(
        new ConflictException(HOLD_EXPIRED_MESSAGE),
      );
    },
    message: HOLD_EXPIRED_MESSAGE,
    cancelReason: '좌석 점유 만료로 인한 자동 취소',
  },
];

describe('ReservationFinalizationService pre-approval gates after an unrecorded approval (#18, #72)', () => {
  it('compensates a PayPal approval left by a 503 when the retry finds the seat hold expired', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(paypalApproval());
    // First attempt: Toss approved, then the confirm lease went to another holder.
    deps.bookingService.refreshPaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.bookingService.acquirePaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const first = deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1');
    await expect(first).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
    // The 503 also schedules the client-independent reconcile job.
    expect(reconcileJobs(deps)).toEqual([{
      payload: expect.objectContaining({
        orderId: 'order-1',
        paymentKey: 'payment-key-1',
        reason: 'confirm_lease_lost',
        attempt: 0,
        expectation: { route: 'PAYPAL', currency: 'USD', amountMinor: 10800 },
        providerCharge: expect.objectContaining({ currency: 'USD', amountMinor: 10800 }),
      }),
      options: expect.objectContaining({ singletonKey: 'order-1:payment-key-1' }),
    }]);

    // Retry after the hold expired: no payment row exists, the gate must not
    // strand the USD charge.
    const record = withCompensationRecord(deps.db);
    deps.db.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([paypalReservation({ admissionActiveUntilAt: PAST() })]))
      .mockReturnValueOnce(chainResult(SEATS));
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval());

    const retry = deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1');
    await expect(retry).rejects.toBeInstanceOf(ConflictException);
    await expect(retry).rejects.toThrow(HOLD_EXPIRED_MESSAGE);

    expect(deps.tossClient.confirmPayment).toHaveBeenCalledOnce();
    expect(deps.tossClient.queryPayment).toHaveBeenCalledWith('payment-key-1', {});
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '결제 유효 시간 초과로 인한 자동 취소',
      expect.objectContaining({ idempotencyKey: 'reservation-finalization-cancel:order-1' }),
    );
    expectRecordedCompensation(deps, record, '결제 유효 시간 초과로 인한 자동 취소');
  });

  it.each(GATE_CASES)('cancels an earlier approval found at the $gate gate and keeps its rejection', async ({
    reservation,
    arrange,
    message,
    cancelReason,
  }) => {
    const deps = createDependencies({ reservation: reservation() });
    arrange(deps);
    const record = withCompensationRecord(deps.db);
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval());

    const result = deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow(message);

    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      cancelReason,
      expect.anything(),
    );
    // The claim row is written before the cancel and completed after it.
    const claimOrder = deps.db.insert.mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(deps.tossClient.cancelPayment.mock.invocationCallOrder[0]!);
    expectRecordedCompensation(deps, record, cancelReason);
  });

  it.each(GATE_CASES)('keeps the $gate rejection without cancelling while the payment is unapproved', async ({
    reservation,
    arrange,
    message,
  }) => {
    const deps = createDependencies({ reservation: reservation() });
    arrange(deps);
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval({
      status: 'IN_PROGRESS',
      approvedAt: null,
    }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toThrow(message);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it.each(GATE_CASES)('answers 503 without cancelling when the provider lookup at the $gate gate fails', async ({
    reservation,
    arrange,
  }) => {
    const deps = createDependencies({ reservation: reservation() });
    arrange(deps);
    deps.tossClient.queryPayment.mockRejectedValue(new Error('fetch failed'));

    const result = deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['no payment under the key', () => Promise.reject(
      new TossPaymentError('NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.', 404),
    )],
    ['a payment of another order', () => Promise.resolve(paypalApproval({ orderId: 'someone-elses-order' }))],
  ])('keeps the gate rejection without cancelling for %s', async (_label, lookup) => {
    const deps = createDependencies({
      reservation: paypalReservation({ admissionActiveUntilAt: PAST() }),
    });
    deps.tossClient.queryPayment.mockImplementation(lookup);

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toThrow(HOLD_EXPIRED_MESSAGE);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('records a provider-expired payment found at a gate like the terminal webhook', async () => {
    const deps = createDependencies({
      reservation: domesticReservation({ admissionActiveUntilAt: PAST() }),
    });
    deps.tossClient.queryPayment.mockResolvedValue(domesticApproval({
      status: 'EXPIRED',
      approvedAt: null,
    }));
    const failureInserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const failureUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          failureInserts.push({ table, values });
          return {
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'payment-expired-1' }]),
            }),
          };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          failureUpdates.push({ table, values });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    deps.db.transaction.mockImplementation(async (cb: (value: typeof tx) => Promise<unknown>) => cb(tx));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toThrow(HOLD_EXPIRED_MESSAGE);

    expect(failureInserts).toEqual([{
      table: payments,
      values: expect.objectContaining({
        tossOrderId: 'order-1',
        status: 'EXPIRED',
        asyncStatus: 'confirm_rejected',
        paidAt: null,
      }),
    }]);
    expect(failureUpdates).toEqual([{ table: reservations, values: expect.objectContaining({ status: 'FAILED' }) }]);
    expect(deps.rootInserts).toContainEqual({
      table: reservationPaymentFailureDiagnostics,
      values: expect.objectContaining({
        paymentId: 'payment-expired-1',
        diagnosticCode: 'PAYMENT_EXPIRED',
        diagnosticSource: 'payment_confirm',
      }),
    });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('does not query the provider for a Redis outage at the seat hold gate', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    const outage = new Error('Connection is closed.');
    deps.bookingService.extendOwnedSeatLocks.mockRejectedValue(outage);

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBe(outage);
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('does not query the provider when the order already has a provider-terminal payment row', async () => {
    const deps = createDependencies({
      reservation: domesticReservation({ admissionActiveUntilAt: PAST() }),
      existingPayment: {
        id: 'payment-aborted',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        tossOrderId: 'order-1',
        status: 'ABORTED',
        asyncStatus: 'confirm_rejected',
      },
    });

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toThrow(HOLD_EXPIRED_MESSAGE);
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });
});

describe('ReservationFinalizationService unverifiable commit (#17)', () => {
  const unreadableState = () => {
    throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
  };

  it('answers 503 without cancelling when a connection died and the committed state cannot be read', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.db.select.mockImplementation(unreadableState);
    deps.db.transaction.mockRejectedValue(
      Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }),
    );
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    const result = deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1');
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);

    expect(deps.db.transaction).toHaveBeenCalledTimes(3);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('answers 503 for a seat conflict that follows a dropped commit when the state cannot be read', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.db.select.mockImplementation(unreadableState);
    deps.db.transaction
      .mockRejectedValueOnce(
        Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }),
      )
      // The retry conflicts with the seats the dropped commit may have sold.
      .mockRejectedValueOnce(new ConflictException('판매 불가능한 좌석입니다'));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.db.transaction).toHaveBeenCalledTimes(2);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('still cancels when no attempt could have committed even if the state cannot be read', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.db.select.mockImplementation(unreadableState);
    deps.db.transaction.mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(InternalServerErrorException);
    expect(deps.db.transaction).toHaveBeenCalledTimes(3);
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
  });
});

describe('ReservationFinalizationService order committed with another payment', () => {
  const committedWithAnotherPayment = () => chainResult([{
    id: 'payment-other',
    reservationId: 'reservation-1',
    paymentKey: 'payment-key-other',
    tossOrderId: 'order-1',
    status: 'DONE',
    asyncStatus: 'sync',
  }]);

  it('cancels this approval as a duplicate after a commit conflict', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.db.transaction.mockRejectedValueOnce(new ConflictException('판매 불가능한 좌석입니다'));
    deps.db.select
      .mockReturnValueOnce(committedWithAnotherPayment())
      .mockReturnValueOnce(chainResult([{ status: 'CONFIRMED' }]));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });

    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '중복 결제로 인한 자동 취소',
      expect.objectContaining({
        idempotencyKey: 'reservation-finalization-duplicate-cancel:payment-key-1',
      }),
    );
    // The committed payment row is not touched.
    expect(deps.db.update).not.toHaveBeenCalled();
    expect(deps.qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      paymentId: 'payment-other',
    });
  });

  it('cancels this approval as a duplicate when the lease holder committed another payment', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.bookingService.refreshPaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.bookingService.acquirePaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.db.select
      .mockReturnValueOnce(committedWithAnotherPayment())
      .mockReturnValueOnce(chainResult([{ status: 'CONFIRMED' }]));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '중복 결제로 인한 자동 취소',
      expect.anything(),
    );
    expect(deps.db.transaction).not.toHaveBeenCalled();
    expect(deps.db.update).not.toHaveBeenCalled();
  });
});

describe('ReservationFinalizationService client-independent reconcile scheduling (#18)', () => {
  it('schedules the reconcile job when neither confirm nor lookup proves the outcome', async () => {
    const deps = createDependencies({ reservation: paypalReservation() });
    deps.tossClient.confirmPayment.mockRejectedValue(new TossPaymentError('PROVIDER_TIMEOUT', 'timeout'));
    deps.tossClient.queryPayment.mockRejectedValue(new Error('fetch failed'));
    const before = Date.now();

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(reconcileJobs(deps)).toEqual([{
      payload: {
        orderId: 'order-1',
        paymentKey: 'payment-key-1',
        expectation: { route: 'PAYPAL', currency: 'USD', amountMinor: 10800 },
        providerCharge: {
          currency: 'USD',
          amountMinor: 10800,
          amountDecimal: '108.00',
          rate: '0.00072',
          quotedAt: '2026-09-30T10:00:00.000Z',
        },
        reason: 'provider_confirm_unresolved',
        attempt: 0,
      },
      options: expect.objectContaining({ singletonKey: 'order-1:payment-key-1' }),
    }]);
    const [{ options }] = reconcileJobs(deps) as Array<{ options: { startAfter: Date } }>;
    expect(options.startAfter.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(deps.pgBoss.createQueue).toHaveBeenCalledWith('payment-confirm-reconcile', { policy: 'short' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('schedules the reconcile job when the seat hold cannot be verified after approval', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.bookingService.assertOwnedSeatLocks.mockRejectedValue(new Error('READONLY'));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'seat_lock_check_failed' }),
    })]);
  });

  it('schedules the reconcile job for an unexpected failure after approval', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    const unexpected = new TypeError('unexpected');
    vi.spyOn(deps.service as never as { commitFinalizationWithRetry: () => Promise<string> },
      'commitFinalizationWithRetry').mockRejectedValue(unexpected);

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1')).rejects.toBe(unexpected);
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'unexpected_post_approval_error', paymentKey: 'payment-key-1' }),
    })]);
  });

  it('does not schedule anything for a confirmed order', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(deps.pgBoss.send).not.toHaveBeenCalled();
  });

  it('records the provider confirm marker with the paymentKey right before Toss confirm', async () => {
    const deps = createDependencies({ reservation: domesticReservation(), providerConfirmSent: false });
    withIssuance(deps.db);
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());

    await deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1');

    expect(deps.providerConfirmMarkers.set).toHaveBeenCalledWith(
      '{payment-provider-confirm}:order-1',
      'payment-key-1',
      'EX',
      24 * 60 * 60,
    );
    expect(deps.providerConfirmMarkers.set.mock.invocationCallOrder[0]!)
      .toBeLessThan(deps.tossClient.confirmPayment.mock.invocationCallOrder[0]!);
  });

  it('does not call Toss confirm when the provider confirm marker cannot be recorded', async () => {
    const deps = createDependencies({ reservation: domesticReservation(), providerConfirmSent: false });
    deps.providerConfirmMarkers.set.mockRejectedValue(new Error('READONLY'));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
    expect(deps.pgBoss.send).not.toHaveBeenCalled();
  });

  it.each(GATE_CASES)('keeps the $gate rejection without a provider lookup when Toss confirm was never sent', async ({
    reservation,
    arrange,
    message,
  }) => {
    const deps = createDependencies({ reservation: reservation(), providerConfirmSent: false });
    arrange(deps);

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1')).rejects.toThrow(message);
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('looks up the provider at a gate when the marker cannot be read', async () => {
    const deps = createDependencies({
      reservation: paypalReservation({ admissionActiveUntilAt: PAST() }),
      providerConfirmSent: false,
    });
    deps.providerConfirmMarkers.get.mockRejectedValue(new Error('timeout'));
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval({ status: 'IN_PROGRESS' }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toThrow(HOLD_EXPIRED_MESSAGE);
    expect(deps.tossClient.queryPayment).toHaveBeenCalledOnce();
  });

  it('rejects a started showtime with 403 without a provider lookup when Toss confirm was never sent', async () => {
    const deps = createDependencies({
      reservation: domesticReservation(),
      showtimeStartsAt: PAST(),
      providerConfirmSent: false,
    });

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .rejects.toThrow(SHOWTIME_SALES_CLOSED_MESSAGE);
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.confirmPayment).not.toHaveBeenCalled();
  });

  it('treats a malformed lookup body at a gate as an unknown outcome, not as proof of non-approval', async () => {
    const deps = createDependencies({ reservation: paypalReservation({ admissionActiveUntilAt: PAST() }) });
    // No orderId: proves nothing about this order.
    deps.tossClient.queryPayment.mockResolvedValue({ paymentKey: 'payment-key-1', status: 'DONE', totalAmount: 108 });

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'pre_approval_admission_window_lookup_failed' }),
    })]);
  });

  it('keeps the claim and schedules the reconcile job when the gate compensation is accepted asynchronously', async () => {
    const deps = createDependencies({ reservation: paypalReservation({ admissionActiveUntilAt: PAST() }) });
    const record = withCompensationRecord(deps.db);
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval());
    deps.tossClient.cancelPayment.mockResolvedValue(paypalApproval({ cancels: [{ cancelStatus: 'IN_PROGRESS' }] }));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toThrow(HOLD_EXPIRED_MESSAGE);
    expect(deps.rootInserts).toContainEqual({
      table: payments,
      values: expect.objectContaining({ status: 'DONE', asyncStatus: 'cancel_pending' }),
    });
    expect(record.updates).toEqual([]);
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'compensation_cancel_pending' }),
    })]);
  });

  it('keeps the claim and schedules the reconcile job when the gate compensation cancel fails', async () => {
    const deps = createDependencies({ reservation: paypalReservation({ admissionActiveUntilAt: PAST() }) });
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval());
    deps.tossClient.cancelPayment.mockRejectedValue(new TossPaymentError('PROVIDER_ERROR', 'down', 500));

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(InternalServerErrorException);
    expect(deps.rootInserts).toContainEqual({
      table: payments,
      values: expect.objectContaining({ status: 'DONE', asyncStatus: 'cancel_pending' }),
    });
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'compensation_cancel_failed' }),
    })]);
  });

  it('does not cancel at a gate once the confirm lease is lost; it answers 503 and schedules the job', async () => {
    const deps = createDependencies({ reservation: paypalReservation({ admissionActiveUntilAt: PAST() }) });
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval());
    // Owned at the start of the request, lost before the compensation.
    deps.bookingService.refreshPaymentConfirmLock
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await expect(deps.service.confirmAndCreateReservation(PAYPAL_DTO, 'user-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(deps.rootInserts).toEqual([]);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'confirm_lease_lost_before_compensation' }),
    })]);
  });

  it('returns the confirmed reservation even when the duplicate approval cannot be cancelled', async () => {
    const deps = createDependencies({ reservation: domesticReservation() });
    deps.tossClient.confirmPayment.mockResolvedValue(domesticApproval());
    deps.tossClient.cancelPayment.mockRejectedValue(new TossPaymentError('PROVIDER_ERROR', 'down', 500));
    deps.db.transaction.mockRejectedValueOnce(new ConflictException('판매 불가능한 좌석입니다'));
    deps.db.select
      .mockReturnValueOnce(chainResult([{
        id: 'payment-other',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-other',
        tossOrderId: 'order-1',
        status: 'DONE',
        asyncStatus: 'sync',
      }]))
      .mockReturnValueOnce(chainResult([{ status: 'CONFIRMED' }]));

    await expect(deps.service.confirmAndCreateReservation(DOMESTIC_DTO, 'user-1'))
      .resolves.toEqual({ reservationId: 'reservation-1' });
    expect(reconcileJobs(deps)).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ reason: 'duplicate_cancel_failed', paymentKey: 'payment-key-1' }),
    })]);
  });
});
