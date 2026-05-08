import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
  type Mock,
} from 'vitest';
import { AdminBookingService } from './admin-booking.service.js';
import { TossPaymentsClient } from '../payment/toss-payments.client.js';
import {
  bookingOperationAuditLogs,
  seatInventories,
} from '../../database/schema/index.js';

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  };
}

function createMockTossClient() {
  return {
    confirmPayment: vi.fn(),
    cancelPayment: vi.fn().mockResolvedValue({
      paymentKey: 'pk_test_123',
      orderId: 'GRP-20260403-ABCDE',
      method: '카드',
      totalAmount: 150000,
      status: 'CANCELED',
      approvedAt: '2026-04-03T10:00:00+09:00',
      cancels: [{ cancelAmount: 150000, cancelReason: '관리자 환불', canceledAt: '2026-04-03T11:00:00+09:00' }],
    }),
  };
}

function createMockBookingGateway() {
  return {
    broadcastSeatUpdate: vi.fn(),
  };
}

function createChainMock(resolvedValue: unknown) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(resolvedValue);
      }
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
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

describe('AdminBookingService', () => {
  let service: AdminBookingService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTossClient: ReturnType<typeof createMockTossClient>;
  let mockBookingGateway: ReturnType<typeof createMockBookingGateway>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockTossClient = createMockTossClient();
    mockBookingGateway = createMockBookingGateway();

    service = new AdminBookingService(
      mockDb as any,
      mockTossClient as unknown as TossPaymentsClient,
      mockBookingGateway as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('should return bookings with stats (totalBookings, totalRevenue, cancelRate)', async () => {
      // Stats queries: totalBookings, totalRevenue, cancelledCount, then list query
      mockDb.select
        .mockReturnValueOnce(createChainMock([{ count: 10 }]))        // total bookings
        .mockReturnValueOnce(createChainMock([{ sum: 1500000 }]))     // total revenue
        .mockReturnValueOnce(createChainMock([{ count: 2 }]))         // cancelled count
        .mockReturnValueOnce(createChainMock([]));                     // bookings list (empty for simplicity)

      const result = await service.getBookings({});
      expect(result).toHaveProperty('stats');
      expect(result.stats).toHaveProperty('totalBookings');
      expect(result.stats).toHaveProperty('totalRevenue');
      expect(result.stats).toHaveProperty('cancelRate');
      expect(result.stats.totalBookings).toBe(10);
      expect(result.stats.totalRevenue).toBe(1500000);
      expect(result.stats.cancelRate).toBe(20); // 2/10 * 100
    });
  });

  describe('manualOpen', () => {
    it('should reopen held cancelled seats immediately and write immutable manual-open audit rows', async () => {
      const operatorUserId = 'admin-1';
      const reservationId = 'reservation-1';
      const showtimeId = 'showtime-1';
      const transaction = createTransactionMock();

      mockDb.select
        .mockReturnValueOnce(
          createChainMock([
            {
              reservation: {
                id: reservationId,
                showtimeId,
                status: 'CANCELLED',
              },
              bookingPolicy: {
                manualOpenEnabled: true,
              },
            },
          ]),
        )
        .mockReturnValueOnce(
          createChainMock([
            {
              seatId: '2F:A-1',
              tierName: 'VIP',
              price: 150000,
              row: 'A',
              number: '1',
            },
            {
              seatId: '2F:A-2',
              tierName: 'VIP',
              price: 150000,
              row: 'A',
              number: '2',
            },
          ]),
        );
      mockDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction.tx),
      );

      await service.manualOpen(reservationId, operatorUserId);

      expect(transaction.insertCalls).toHaveLength(1);
      expect(transaction.insertCalls[0]?.table).toBe(bookingOperationAuditLogs);
      expect(transaction.insertCalls[0]?.values).toEqual([
        expect.objectContaining({
          operatorUserId,
          action: 'manual_open',
          seatKey: '2F:A-1',
          reservationId,
        }),
        expect.objectContaining({
          operatorUserId,
          action: 'manual_open',
          seatKey: '2F:A-2',
          reservationId,
        }),
      ]);

      const seatUpdates = transaction.updateCalls.filter(
        (call) => call.table === seatInventories,
      );
      expect(seatUpdates).toHaveLength(2);
      for (const update of seatUpdates) {
        expect(update.values).toMatchObject({
          status: 'available',
          lockedBy: null,
          lockedUntil: null,
          soldAt: null,
          heldCancelledAt: null,
          reopenHoldUntil: null,
          reopenJobId: null,
        });
      }

      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledTimes(2);
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenNthCalledWith(
        1,
        showtimeId,
        '2F:A-1',
        'available',
      );
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenNthCalledWith(
        2,
        showtimeId,
        '2F:A-2',
        'available',
      );
      expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
    });

    it('should reject manual open when the booking policy disables it', async () => {
      mockDb.select.mockReturnValueOnce(
        createChainMock([
          {
            reservation: {
              id: 'reservation-1',
              showtimeId: 'showtime-1',
              status: 'CANCELLED',
            },
            bookingPolicy: {
              manualOpenEnabled: false,
            },
          },
        ]),
      );

      await expect(service.manualOpen('reservation-1', 'admin-1')).rejects.toThrow(
        '수동 오픈이 비활성화된 공연입니다',
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });
  });
});
