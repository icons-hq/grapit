import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookingOperationAuditLogs,
  payments,
  refunds,
  reservations,
  seatInventories,
  ticketItems,
  tickets,
} from '../../database/schema/index.js';
import { PG_BOSS_JOB_NAMES } from '../jobs/pgboss.provider.js';
import {
  JOB_ENQUEUE_FAILED,
  PaymentCancellationFinalizerService,
  type FinalizeFullPaymentCancellationInput,
} from './payment-cancellation-finalizer.service.js';

const NOW = new Date('2026-05-08T03:10:00.000Z');
const RELEASE_AT = new Date('2026-05-08T03:12:00.000Z');
const EXPECTED_DEPOSIT_AT = new Date('2026-05-11T03:10:00.000Z');

function createContext(
  overrides: Partial<FinalizeFullPaymentCancellationInput['context']> = {},
): FinalizeFullPaymentCancellationInput['context'] {
  return {
    reservation: {
      id: 'reservation-1',
      showtimeId: 'showtime-1',
      reservationNumber: 'GRP-20260508-ABCDE',
    },
    payment: {
      id: 'payment-1',
      paymentKey: 'pay-key-1',
      providerMetadata: {
        requestedProvider: 'OVERSEAS_CARD',
        secretKeyScope: 'overseas-card',
      },
    },
    bookingPolicy: {
      cancelledSeatHoldMinMinutes: 2,
      cancelledSeatHoldMaxMinutes: 2,
    },
    seats: [{ seatId: '1F:A-10' }, { seatId: '2F:B-20' }],
    ...overrides,
  };
}

type UpdateCall = {
  table: unknown;
  values: Record<string, unknown>;
  whereArgs: unknown[];
  returningSelection?: unknown;
};

function objectGraphContains(root: unknown, needle: unknown): boolean {
  const seen = new Set<unknown>();

  function visit(value: unknown): boolean {
    if (value === needle) {
      return true;
    }
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value !== 'object') {
      return value === needle;
    }
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some(visit);
    }

    return Object.values(value as Record<string, unknown>).some(visit);
  }

  return visit(root);
}

function createTransactionMock(options: {
  refundReturning?: Array<{ id: string }>;
  ticketItemReturning?: Array<{ id: string }>;
} = {}) {
  const updateCalls: UpdateCall[] = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const refundReturning = options.refundReturning ?? [{ id: 'refund-1' }];
  const ticketItemReturning = options.ticketItemReturning ?? [
    { id: 'ticket-item-1' },
    { id: 'ticket-item-2' },
  ];

  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          const call: UpdateCall = { table, values, whereArgs: [] };
          updateCalls.push(call);
          return {
            where: vi.fn((...whereArgs: unknown[]) => {
              call.whereArgs = whereArgs;
              return {
                returning: vi.fn((selection: unknown) => {
                  call.returningSelection = selection;
                  if (table === refunds) {
                    return Promise.resolve(refundReturning);
                  }
                  if (table === ticketItems) {
                    return Promise.resolve(ticketItemReturning);
                  }
                  return Promise.resolve([{ id: 'updated-row-1' }]);
                }),
              };
            }),
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: unknown) {
          insertCalls.push({ table, values });
          return Promise.resolve(values);
        },
      };
    },
  };

  return { tx, updateCalls, insertCalls };
}

function createService(pgBoss?: {
  isAvailable: boolean;
  send: ReturnType<typeof vi.fn>;
}, transactionOptions?: Parameters<typeof createTransactionMock>[0]) {
  const transaction = createTransactionMock(transactionOptions);
  const db = {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(transaction.tx),
    ),
  };
  const service = new PaymentCancellationFinalizerService(db as never, pgBoss as never);

  return { service, db, transaction };
}

function baseInput(
  overrides: Partial<FinalizeFullPaymentCancellationInput> = {},
): FinalizeFullPaymentCancellationInput {
  return {
    context: createContext(),
    refundId: 'refund-1',
    reason: '사용자 환불',
    providerResponse: { status: 'CANCELED' },
    actor: { kind: 'user' },
    source: 'refund_request',
    ...overrides,
  };
}

describe('PaymentCancellationFinalizerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('finalizes a full cancellation, merges payment metadata, and sets item refund SQL fields', async () => {
    const pgBoss = {
      isAvailable: false,
      send: vi.fn(),
    };
    const { service, transaction } = createService(pgBoss);

    const result = await service.finalizeFullPaymentCancellation(baseInput());

    expect(result).toEqual({
      releaseJobId: JOB_ENQUEUE_FAILED,
      releaseEnqueued: false,
    });
    expect(pgBoss.send).not.toHaveBeenCalled();

    expect(transaction.updateCalls.find((call) => call.table === refunds)?.values)
      .toMatchObject({
        status: 'completed',
        sentToPgAt: NOW,
        completedAt: NOW,
        updatedAt: NOW,
        resultCode: 'CANCELED',
        resultMessage: 'PG cancel completed',
        failureReason: null,
        expectedDepositAt: EXPECTED_DEPOSIT_AT,
        customerServiceCtaVisible: false,
        providerMetadata: {
          cancelReason: '사용자 환불',
          paymentStatus: 'CANCELED',
          source: 'refund_request',
        },
      });

    expect(transaction.updateCalls.find((call) => call.table === reservations)?.values)
      .toMatchObject({
        status: 'CANCELLED',
        cancelledAt: NOW,
        cancelReason: '사용자 환불',
        updatedAt: NOW,
      });

    expect(transaction.updateCalls.find((call) => call.table === payments)?.values)
      .toMatchObject({
        status: 'CANCELED',
        cancelledAt: NOW,
        cancelReason: '사용자 환불',
        providerMetadata: {
          requestedProvider: 'OVERSEAS_CARD',
          secretKeyScope: 'overseas-card',
          refundCompletedAt: NOW.toISOString(),
          cancellationSource: 'refund_request',
        },
      });

    expect(transaction.updateCalls.find((call) => call.table === tickets)?.values)
      .toMatchObject({
        status: 'revoked',
        revokedAt: NOW,
        updatedAt: NOW,
      });

    expect(transaction.updateCalls.find((call) => call.table === ticketItems)?.values)
      .toMatchObject({
        status: 'cancelled',
        cancelledAt: NOW,
        cancelReason: '사용자 환불',
        cancellationFee: 0,
        reopenState: 'not_required',
        reopenHoldUntil: null,
        reopenJobId: null,
        updatedAt: NOW,
      });
    expect(transaction.updateCalls.find((call) => call.table === ticketItems)?.values)
      .toHaveProperty('serviceFeeRefund');
    expect(transaction.updateCalls.find((call) => call.table === ticketItems)?.values)
      .toHaveProperty('refundableAmount');

    const seatUpdates = transaction.updateCalls.filter(
      (call) => call.table === seatInventories,
    );
    expect(seatUpdates).toHaveLength(2);
    for (const update of seatUpdates) {
      expect(update.values).toMatchObject({
        status: 'held_cancelled',
        lockedBy: null,
        lockedUntil: null,
        soldAt: null,
        heldCancelledAt: NOW,
        reopenHoldUntil: RELEASE_AT,
        reopenJobId: JOB_ENQUEUE_FAILED,
      });
    }
  });

  it('writes booking operation audit rows for admin actors', async () => {
    const { service, transaction } = createService({
      isAvailable: false,
      send: vi.fn(),
    });

    await service.finalizeFullPaymentCancellation(
      baseInput({
        reason: '관리자 환불',
        actor: { kind: 'admin', operatorUserId: 'admin-1' },
      }),
    );

    expect(transaction.insertCalls).toHaveLength(1);
    expect(transaction.insertCalls[0]?.table).toBe(bookingOperationAuditLogs);
    expect(transaction.insertCalls[0]?.values).toEqual([
      expect.objectContaining({
        operatorUserId: 'admin-1',
        action: 'admin_refund',
        seatKey: '1F:A-10',
        reservationId: 'reservation-1',
        createdAt: NOW,
      }),
      expect.objectContaining({
        operatorUserId: 'admin-1',
        action: 'admin_refund',
        seatKey: '2F:B-20',
        reservationId: 'reservation-1',
        createdAt: NOW,
      }),
    ]);
  });

  it('persists the preallocated release job id when pgBoss send succeeds', async () => {
    const pgBoss = {
      isAvailable: true,
      send: vi.fn((_name: unknown, _payload: unknown, options: { id: string }) =>
        Promise.resolve(options.id),
      ),
    };
    const { service, transaction } = createService(pgBoss);

    const result = await service.finalizeFullPaymentCancellation(
      baseInput({ source: 'refund_retry' }),
    );

    const sendOptions = pgBoss.send.mock.calls[0]?.[2] as { id?: string } | undefined;
    const releaseJobId = sendOptions?.id;
    expect(releaseJobId).toEqual(expect.any(String));
    expect(result).toEqual({
      releaseJobId,
      releaseEnqueued: true,
    });
    expect(pgBoss.send).toHaveBeenCalledWith(
      PG_BOSS_JOB_NAMES.releaseCancelledSeat,
      {
        reservationId: 'reservation-1',
        showtimeId: 'showtime-1',
        releaseAt: RELEASE_AT.toISOString(),
        seatIdentities: [
          { floorKey: '1F', seatId: 'A-10', seatKey: '1F:A-10' },
          { floorKey: '2F', seatId: 'B-20', seatKey: '2F:B-20' },
        ],
      },
      expect.objectContaining({
        id: releaseJobId,
        startAfter: RELEASE_AT,
        singletonKey: 'reservation-1',
        retryLimit: 3,
        retryBackoff: true,
        retryDelay: 30,
      }),
    );

    expect(transaction.updateCalls.find((call) => call.table === ticketItems)?.values)
      .toMatchObject({
        reopenState: 'not_required',
        reopenHoldUntil: null,
        reopenJobId: null,
      });
    expect(transaction.updateCalls.filter((call) => call.table === seatInventories))
      .toEqual([
        expect.objectContaining({
          values: expect.objectContaining({ reopenJobId: releaseJobId }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({ reopenJobId: releaseJobId }),
        }),
      ]);
  });

  it('aborts before reservation state changes when the scoped refund update returns no row', async () => {
    const { service, transaction } = createService(
      {
        isAvailable: false,
        send: vi.fn(),
      },
      { refundReturning: [] },
    );

    await expect(
      service.finalizeFullPaymentCancellation(baseInput({ refundId: 'wrong-refund' })),
    ).rejects.toThrow();

    expect(transaction.updateCalls.find((call) => call.table === refunds)?.returningSelection)
      .toEqual({ id: refunds.id });
    const refundWhere = transaction.updateCalls.find((call) => call.table === refunds)
      ?.whereArgs[0];
    expect(objectGraphContains(refundWhere, refunds.id)).toBe(true);
    expect(objectGraphContains(refundWhere, refunds.reservationId)).toBe(true);
    expect(objectGraphContains(refundWhere, refunds.paymentId)).toBe(true);
    expect(objectGraphContains(refundWhere, 'wrong-refund')).toBe(true);
    expect(objectGraphContains(refundWhere, 'reservation-1')).toBe(true);
    expect(objectGraphContains(refundWhere, 'payment-1')).toBe(true);
    expect(transaction.updateCalls.some((call) => call.table === reservations)).toBe(false);
    expect(transaction.updateCalls.some((call) => call.table === payments)).toBe(false);
    expect(transaction.updateCalls.some((call) => call.table === tickets)).toBe(false);
    expect(transaction.updateCalls.some((call) => call.table === ticketItems)).toBe(false);
    expect(transaction.updateCalls.some((call) => call.table === seatInventories)).toBe(false);
  });

  it('scopes ticket item cancellation to expected active or pending seat keys only', async () => {
    const { service, transaction } = createService({
      isAvailable: false,
      send: vi.fn(),
    });

    await service.finalizeFullPaymentCancellation(baseInput());

    const ticketItemUpdate = transaction.updateCalls.find(
      (call) => call.table === ticketItems,
    );
    const where = ticketItemUpdate?.whereArgs[0];
    expect(where).toBeDefined();
    expect(objectGraphContains(where, ticketItems.reservationId)).toBe(true);
    expect(objectGraphContains(where, ticketItems.paymentId)).toBe(true);
    expect(objectGraphContains(where, ticketItems.showtimeId)).toBe(true);
    expect(objectGraphContains(where, ticketItems.seatKey)).toBe(true);
    expect(objectGraphContains(where, ticketItems.status)).toBe(true);
    expect(objectGraphContains(where, '1F:A-10')).toBe(true);
    expect(objectGraphContains(where, '2F:B-20')).toBe(true);
    expect(objectGraphContains(where, 'active')).toBe(true);
    expect(objectGraphContains(where, 'cancellation_pending')).toBe(true);
    expect(objectGraphContains(where, '1F:already-cancelled-sibling')).toBe(false);
  });

  it('aborts seat state updates when not every expected ticket item row is updated', async () => {
    const { service, transaction } = createService(
      {
        isAvailable: false,
        send: vi.fn(),
      },
      { ticketItemReturning: [{ id: 'ticket-item-1' }] },
    );

    await expect(service.finalizeFullPaymentCancellation(baseInput())).rejects.toThrow();

    expect(transaction.updateCalls.find((call) => call.table === ticketItems)?.returningSelection)
      .toEqual({ id: ticketItems.id });
    expect(transaction.updateCalls.some((call) => call.table === seatInventories)).toBe(false);
  });

  it('persists JOB_ENQUEUE_FAILED when pgBoss send fails', async () => {
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockRejectedValue(new Error('Queue missing')),
    };
    const { service, transaction } = createService(pgBoss);

    const result = await service.finalizeFullPaymentCancellation(baseInput());

    expect(result).toEqual({
      releaseJobId: JOB_ENQUEUE_FAILED,
      releaseEnqueued: false,
    });
    expect(transaction.updateCalls.find((call) => call.table === ticketItems)?.values)
      .toMatchObject({
        reopenState: 'not_required',
        reopenHoldUntil: null,
        reopenJobId: null,
      });
    expect(transaction.updateCalls.filter((call) => call.table === seatInventories))
      .toEqual([
        expect.objectContaining({
          values: expect.objectContaining({ reopenJobId: JOB_ENQUEUE_FAILED }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({ reopenJobId: JOB_ENQUEUE_FAILED }),
        }),
      ]);
  });

  it('skips refund updates when refundId is omitted', async () => {
    const { service, transaction } = createService({
      isAvailable: false,
      send: vi.fn(),
    });

    const result = await service.finalizeFullPaymentCancellation(
      baseInput({
        refundId: undefined,
        source: 'cancel_webhook',
        reason: '외부 결제 취소 웹훅',
      }),
    );

    expect(result.releaseJobId).toBe(JOB_ENQUEUE_FAILED);
    expect(transaction.updateCalls.some((call) => call.table === refunds)).toBe(false);
    expect(transaction.updateCalls.some((call) => call.table === reservations)).toBe(true);
    expect(transaction.updateCalls.some((call) => call.table === payments)).toBe(true);
    expect(transaction.updateCalls.some((call) => call.table === tickets)).toBe(true);
    expect(transaction.updateCalls.some((call) => call.table === ticketItems)).toBe(true);
    expect(transaction.updateCalls.filter((call) => call.table === seatInventories))
      .toHaveLength(2);
  });
});
