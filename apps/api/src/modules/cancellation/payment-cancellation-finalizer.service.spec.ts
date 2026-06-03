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

function createTransactionMock() {
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];

  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          updateCalls.push({ table, values });
          return {
            where: vi.fn().mockResolvedValue(undefined),
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
}) {
  const transaction = createTransactionMock();
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

  it('finalizes a full cancellation and merges payment provider metadata', async () => {
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
        reopenState: 'held_cancelled',
        reopenHoldUntil: RELEASE_AT,
        reopenJobId: JOB_ENQUEUE_FAILED,
        updatedAt: NOW,
      });

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
        reopenJobId: releaseJobId,
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
        reopenJobId: JOB_ENQUEUE_FAILED,
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
