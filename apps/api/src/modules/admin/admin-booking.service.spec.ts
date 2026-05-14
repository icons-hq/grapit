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
import {
  bookingOperationAuditLogs,
  seatInventories,
} from '../../database/schema/index.js';
import type { AdminAuditService } from './admin-audit.service.js';

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  };
}

function createMockRefundService() {
  return {
    requestAdminRefund: vi.fn().mockResolvedValue({
      idempotent: false,
      retryEnqueued: false,
      refundTimeline: { currentState: 'COMPLETED' },
    }),
  };
}

function createMockAdminAuditService() {
  return {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AdminAuditService & {
    write: Mock;
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
  let mockBookingGateway: ReturnType<typeof createMockBookingGateway>;
  let mockRefundService: ReturnType<typeof createMockRefundService>;
  let mockAdminAuditService: ReturnType<typeof createMockAdminAuditService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockBookingGateway = createMockBookingGateway();
    mockRefundService = createMockRefundService();
    mockAdminAuditService = createMockAdminAuditService();

    service = new AdminBookingService(
      mockDb as any,
      mockBookingGateway as any,
      mockRefundService as any,
      mockAdminAuditService,
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
    it('should reopen held cancelled seats immediately and write immutable manual-open audit rows plus admin audit evidence', async () => {
      const operatorUserId = 'admin-1';
      const reservationId = 'reservation-1';
      const showtimeId = 'showtime-1';
      const reason = '좌석 재오픈 요청 확인';
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

      await (service as any).manualOpen(reservationId, operatorUserId, reason);

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
      expect(mockAdminAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: operatorUserId,
          action: 'seat.manual_open',
          resourceType: 'reservation',
          resourceId: reservationId,
          status: 'success',
          reason,
          changedFields: ['seatStatus'],
          before: expect.objectContaining({
            seatStatus: [
              { seatKey: '2F:A-1', status: 'held_cancelled' },
              { seatKey: '2F:A-2', status: 'held_cancelled' },
            ],
          }),
          after: expect.objectContaining({
            seatStatus: [
              { seatKey: '2F:A-1', status: 'available' },
              { seatKey: '2F:A-2', status: 'available' },
            ],
          }),
        }),
        transaction.tx,
      );
      expect(mockRefundService.requestAdminRefund).not.toHaveBeenCalled();
    });

    it('should reject manual open without a reason before querying or auditing', async () => {
      await expect(
        (service as any).manualOpen('reservation-1', 'admin-1', '   '),
      ).rejects.toThrow('좌석 운영 사유를 입력해주세요');

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockAdminAuditService.write).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
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

      await expect(
        (service as any).manualOpen('reservation-1', 'admin-1', '정책 확인'),
      ).rejects.toThrow('수동 오픈이 비활성화된 공연입니다');
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockAdminAuditService.write).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });
  });

  describe('refundBooking', () => {
    it('delegates admin refunds to RefundService and writes masked admin refund audit', async () => {
      await service.refundBooking('reservation-1', 'admin-1', '관리자 환불');

      expect(mockRefundService.requestAdminRefund).toHaveBeenCalledWith(
        'reservation-1',
        'admin-1',
        '관리자 환불',
      );
      expect(mockAdminAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'refund.admin_refund',
          resourceType: 'reservation',
          resourceId: 'reservation-1',
          status: 'success',
          reason: '관리자 환불',
          changedFields: ['refund'],
          after: expect.objectContaining({
            refund: expect.objectContaining({
              idempotent: false,
              retryEnqueued: false,
              currentState: 'COMPLETED',
            }),
          }),
        }),
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });
  });

  describe('exportReservations', () => {
    it('exports raw reservation CSV with all seven filters, formula neutralization, and metadata-only audit', async () => {
      mockDb.select.mockReturnValueOnce(
        createChainMock([
          {
            reservation: {
              id: 'reservation-raw-1',
              reservationNumber: 'R-RAW-001',
              status: 'CONFIRMED',
              totalAmount: 99000,
              createdAt: new Date('2026-07-01T03:00:00.000Z'),
            },
            user: {
              name: '=HYPERLINK("https://evil.example")',
              email: '=raw-customer@example.com',
              phone: '+821055501234',
              country: 'KR',
            },
            showtime: {
              dateTime: new Date('2026-07-18T10:00:00.000Z'),
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            seat: {
              seatId: '2F:A-1',
              tierName: 'VIP',
              row: 'A',
              number: '1',
              price: 99000,
            },
            payment: {
              method: 'CARD',
              status: 'DONE',
              paidAt: new Date('2026-07-01T03:01:00.000Z'),
            },
          },
        ]),
      );

      const result = await service.exportReservations({
        actorUserId: 'admin-1',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
        filters: {
          eventId: 'performance-1',
          tierName: 'VIP',
          zoneFloor: '2F',
          reservationStatus: 'CONFIRMED',
          audienceRegion: 'domestic',
          paymentMethod: 'CARD',
          dateFrom: '2026-07-01',
          dateTo: '2026-07-31',
          exportType: 'raw_pii',
          reason: '정산 대조',
        },
      });

      expect(result.rowCount).toBe(1);
      expect(result.filename).toContain('reservation-export-raw');
      expect(result.csv).toContain('"Reservation Number","User Name","User Email","User Phone"');
      expect(result.csv).toContain('"\'=HYPERLINK(""https://evil.example"")"');
      expect(result.csv).toContain('"\'=raw-customer@example.com"');

      const [auditInput] = mockAdminAuditService.write.mock.calls[0]!;
      expect(auditInput).toMatchObject({
        actorUserId: 'admin-1',
        action: 'reservations.export_raw',
        resourceType: 'reservation_export',
        resourceId: 'raw_pii',
        status: 'success',
        reason: '정산 대조',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
        changedFields: ['exportType', 'filters', 'rowCount'],
        after: {
          exportType: 'raw_pii',
          filters: {
            eventId: 'performance-1',
            tierName: 'VIP',
            zoneFloor: '2F',
            reservationStatus: 'CONFIRMED',
            audienceRegion: 'domestic',
            paymentMethod: 'CARD',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-31',
          },
          rowCount: 1,
        },
      });
      expect(JSON.stringify(auditInput)).not.toContain('raw-customer@example.com');
      expect(JSON.stringify(auditInput)).not.toContain('+821055501234');
      expect(JSON.stringify(auditInput)).not.toContain('R-RAW-001');
      expect(JSON.stringify(auditInput)).not.toContain('HYPERLINK');
    });

    it('rejects raw exports without a reason before querying or auditing', async () => {
      await expect(
        service.exportReservations({
          actorUserId: 'admin-1',
          filters: {
            exportType: 'raw_pii',
          },
        }),
      ).rejects.toThrow('원본 CSV 내보내기 사유를 입력해주세요');

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockAdminAuditService.write).not.toHaveBeenCalled();
    });
  });
});
