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
  reservationPaymentFailureDiagnostics,
  seatInventories,
} from '../../database/schema/index.js';
import type { AdminAuditService } from './admin-audit.service.js';

function ticketItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-item-a1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    showtimeId: 'showtime-1',
    seatId: '1F:A-1',
    seatKey: '1F:A-1',
    floorKey: '1F',
    floorLabel: '1층',
    tierName: 'VIP',
    row: 'A',
    number: '1',
    price: 77000,
    serviceFee: 2000,
    status: 'active',
    admissionState: 'not_entered',
    enteredAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancellationFee: 0,
    serviceFeeRefund: 0,
    refundableAmount: 0,
    reopenState: 'not_required',
    reopenHoldUntil: null,
    reopenJobId: null,
    createdAt: new Date('2026-07-01T03:01:00.000Z'),
    updatedAt: new Date('2026-07-01T03:01:00.000Z'),
    ...overrides,
  };
}

function createMockDb() {
  return {
    select: vi.fn(() => createChainMock([])),
    execute: vi.fn(),
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

function createRecordingChainMock(
  resolvedValue: unknown,
  calls: Array<{ method: string; args: unknown[] }>,
) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(resolvedValue);
      }
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
        return new Proxy({}, handler);
      };
    },
  };

  return new Proxy({}, handler);
}

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
      if (typeof value === 'string' && typeof needle === 'string') {
        return value.includes(needle);
      }
      return value === needle;
    }
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some(visit);
    }

    if (value instanceof Date && typeof needle === 'string') {
      return value.toISOString().includes(needle);
    }

    return Object.values(value as Record<string, unknown>).some(visit);
  }

  return visit(root);
}

function objectGraphText(root: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];

  function visit(value: unknown): void {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value));
      return;
    }
    if (value instanceof Date) {
      parts.push(value.toISOString());
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const entry of Object.values(value as Record<string, unknown>)) {
      visit(entry);
    }
  }

  visit(root);
  return parts.join(' ');
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
    it('should return filtered operational stats with totalRevenue equal to completedRevenue', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 4,
          completedRevenue: 79000,
          soldCount: 2,
          pendingPaymentCount: 1,
          paymentProcessingCount: 0,
          failedCount: 1,
          expiredPaymentCount: 1,
          abortedPaymentCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 1,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookings({});

      expect(result.stats).toMatchObject({
        totalBookings: 4,
        completedRevenue: 79000,
        totalRevenue: 79000,
        soldCount: 2,
        failedCount: 1,
        expiredPaymentCount: 1,
        abortedPaymentCount: 0,
        cancelledCount: 1,
      });
      expect(result.stats.cancelRate).toBe(25);
      expect(result.total).toBe(4);
      const statsSelect = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(objectGraphContains(statsSelect.expiredPaymentCount, 'PAYMENT_DEADLINE_EXPIRED')).toBe(true);
      expect(objectGraphContains(statsSelect.expiredPaymentCount, 'EXPIRED')).toBe(true);
      expect(objectGraphContains(statsSelect.abortedPaymentCount, 'ABORTED')).toBe(true);
    });

    it('treats missing refund rows as not cancellation-processing when counting sold bookings', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 79000,
          soldCount: 1,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(createChainMock([]));

      await service.getBookings({});

      const statsSelect = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
      const soldCountSqlText = objectGraphText(statsSelect.soldCount);

      expect(soldCountSqlText).toContain('coalesce');
      expect(soldCountSqlText).toContain('false');
    });

    it('keeps active ticket revenue independent from cancellation-processing attention state', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 77000,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 1,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookings({});
      const statsSelect = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
      const completedRevenueSqlText = objectGraphText(statsSelect.completedRevenue);

      expect(result.stats).toMatchObject({
        completedRevenue: 77000,
        totalRevenue: 77000,
        cancelProcessingCount: 1,
        partialCancelledCount: 0,
      });
      expect(completedRevenueSqlText).toContain('admin_revenue_ti.status = ');
      expect(completedRevenueSqlText).not.toContain('cancellation_pending');
      expect(completedRevenueSqlText).not.toContain('requested');
      expect(completedRevenueSqlText).not.toContain('processing_at_pg');
      expect(completedRevenueSqlText).not.toContain('failed');
    });

    it('excludes cancellation-processing attention states from partial cancelled stats', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 77000,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 1,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookings({});
      const statsSelect = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
      const partialCancelledSqlText = objectGraphText(statsSelect.partialCancelledCount);

      expect(result.stats.cancelProcessingCount).toBe(1);
      expect(result.stats.partialCancelledCount).toBe(0);
      expect(partialCancelledSqlText).toContain('admin_cancelled_ti.status = ');
      expect(partialCancelledSqlText).toContain('and not');
      expect(partialCancelledSqlText).toContain('cancellation_pending');
      expect(partialCancelledSqlText).toContain('requested');
    });

    it('should return reservation seats for a pending booking without ticket items', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 0,
          soldCount: 0,
          pendingPaymentCount: 1,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(
          createChainMock([
            {
              reservation: {
                id: 'reservation-pending-1',
                reservationNumber: 'R-PENDING-001',
                tossOrderId: 'GRP-TOSS-PENDING-001',
                status: 'PENDING_PAYMENT',
                totalAmount: 158000,
                createdAt: new Date('2026-07-01T03:00:00.000Z'),
              },
              user: {
                name: '김대기',
                phone: '+821055501234',
                email: 'pending@example.com',
                country: 'TH',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              payment: {
                status: 'READY',
                method: 'FOREIGN_EASY_PAY',
              },
              refund: {
                status: null,
              },
            },
          ]),
        )
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(
          createChainMock([
            {
              id: 'reservation-seat-a1',
              reservationId: 'reservation-pending-1',
              seatId: '1F:A-1',
              tierName: 'VIP',
              price: 79000,
              row: 'A',
              number: '1',
            },
            {
              id: 'reservation-seat-a2',
              reservationId: 'reservation-pending-1',
              seatId: '1F:A-2',
              tierName: 'VIP',
              price: 79000,
              row: 'A',
              number: '2',
            },
          ]),
        );

      const result = await service.getBookings({});

      expect(result.bookings).toHaveLength(1);
      expect(result.bookings[0]?.status).toBe('PENDING_PAYMENT');
      expect(result.bookings[0]).toMatchObject({
        tossOrderId: 'GRP-TOSS-PENDING-001',
        userEmail: 'pending@example.com',
        userCountry: 'TH',
        paymentStatus: 'READY',
        paymentMethod: 'FOREIGN_EASY_PAY',
        paymentFailureDiagnostic: null,
        paymentMethodAttribution: {
          label: '해외간편결제',
          method: 'FOREIGN_EASY_PAY',
          provider: null,
          currency: null,
          source: 'DB',
        },
        funnelStatus: 'PAYMENT_PENDING',
        ticketStatusCounts: {
          ACTIVE: 0,
          CANCELLATION_PENDING: 0,
          CANCELLED: 0,
          EXPIRED: 0,
        },
      });
      expect(result.bookings[0]).not.toHaveProperty('userPhone');
      expect(result.bookings[0]?.seats).toEqual([
        {
          seatId: 'A-1',
          floorKey: '1F',
          floorLabel: '1층',
          seatKey: '1F:A-1',
          tierName: 'VIP',
          price: 79000,
          row: 'A',
          number: '1',
        },
        {
          seatId: 'A-2',
          floorKey: '1F',
          floorLabel: '1층',
          seatKey: '1F:A-2',
          tierName: 'VIP',
          price: 79000,
          row: 'A',
          number: '2',
        },
      ]);
    });

    it('maps payment, user, funnel, and ticket status fields for sold list rows', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 79000,
          soldCount: 1,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(
          createChainMock([
            {
              reservation: {
                id: 'reservation-1',
                reservationNumber: 'R-SOLD-001',
                tossOrderId: 'GRP-TOSS-SOLD-001',
                status: 'CONFIRMED',
                totalAmount: 79000,
                createdAt: new Date('2026-07-01T03:00:00.000Z'),
              },
              user: {
                name: '김예매',
                phone: '+821055501234',
                email: 'buyer@example.com',
                country: 'KR',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              payment: {
                status: 'DONE',
                method: 'CARD',
              },
              refund: {
                status: null,
              },
            },
          ]),
        )
        .mockReturnValueOnce(createChainMock([ticketItem()]));

      const result = await service.getBookings({ paymentStatus: 'DONE' as any });

      expect(result.bookings).toEqual([
        expect.objectContaining({
          reservationNumber: 'R-SOLD-001',
          tossOrderId: 'GRP-TOSS-SOLD-001',
          userEmail: 'buyer@example.com',
          userCountry: 'KR',
          paymentStatus: 'DONE',
          paymentMethod: 'CARD',
          paymentFailureDiagnostic: null,
          paymentMethodAttribution: {
            label: '카드',
            method: 'CARD',
            provider: null,
            currency: null,
            source: 'DB',
          },
          funnelStatus: 'SOLD',
          ticketStatusCounts: {
            ACTIVE: 1,
            CANCELLATION_PENDING: 0,
            CANCELLED: 0,
            EXPIRED: 0,
          },
        }),
      ]);
    });

    it('maps payment diagnostics and payment method attribution from left-joined rows', async () => {
      const listCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 2,
          completedRevenue: 79000,
          soldCount: 1,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 1,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(
          createRecordingChainMock([
            {
              reservation: {
                id: 'reservation-failed-1',
                reservationNumber: 'R-FAILED-001',
                tossOrderId: 'GRP-TOSS-FAILED-001',
                status: 'FAILED',
                totalAmount: 79000,
                createdAt: new Date('2026-07-01T03:00:00.000Z'),
              },
              user: {
                name: '김실패',
                email: 'failed@example.com',
                country: 'KR',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              payment: {
                status: 'ABORTED',
                method: 'FOREIGN_EASY_PAY',
                provider: 'PAYPAL',
                currency: 'USD',
              },
              refund: {
                status: null,
              },
              diagnostic: {
                diagnosticKind: 'checkout_timeout',
                diagnosticCode: 'PAY_PROCESS_CANCELED',
                diagnosticMessage: '사용자가 결제를 중단했습니다',
                diagnosticSource: 'Webhook',
                recordedAt: new Date('2026-07-01T03:05:00.000Z'),
                providerCheckStatus: 'not_checked',
                providerCheckedAt: null,
                providerCheckMessage: null,
              },
            },
            {
              reservation: {
                id: 'reservation-missing-payment',
                reservationNumber: 'R-MISSING-PAYMENT',
                tossOrderId: 'GRP-TOSS-MISSING-PAYMENT',
                status: 'FAILED',
                totalAmount: 79000,
                createdAt: new Date('2026-07-01T02:00:00.000Z'),
              },
              user: {
                name: 'No Payment Row',
                email: 'missing@example.com',
                country: 'TW',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              payment: null,
              refund: null,
              diagnostic: null,
            },
          ], listCalls),
        )
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookings({});

      const leftJoinTables = listCalls
        .filter((call) => call.method === 'leftJoin')
        .map((call) => call.args[0]);
      expect(leftJoinTables).toContain(reservationPaymentFailureDiagnostics);
      expect(result.bookings[0]).toMatchObject({
        paymentMethod: 'FOREIGN_EASY_PAY',
        paymentFailureDiagnostic: {
          kind: 'checkout_timeout',
          code: 'PAY_PROCESS_CANCELED',
          message: '사용자가 결제를 중단했습니다',
          source: 'Webhook',
          recordedAt: '2026-07-01T03:05:00.000Z',
          providerCheckStatus: 'not_checked',
          providerCheckedAt: null,
          providerCheckMessage: null,
        },
        paymentMethodAttribution: {
          label: '해외간편결제 / PayPal / USD',
          method: 'FOREIGN_EASY_PAY',
          provider: 'PAYPAL',
          currency: 'USD',
          source: 'DB',
        },
      });
      expect(result.bookings[1]).toMatchObject({
        paymentMethod: null,
        paymentFailureDiagnostic: null,
        paymentMethodAttribution: {
          label: '결제수단 확인 필요',
          method: null,
          provider: null,
          currency: null,
          source: 'Needs Review: payment row missing',
        },
      });
    });

    it('applies extended filters and returns the filtered total instead of an unfiltered count', async () => {
      const statsCalls: Array<{ method: string; args: unknown[] }> = [];
      const listCalls: Array<{ method: string; args: unknown[] }> = [];

      mockDb.select
        .mockReturnValueOnce(createRecordingChainMock([{
          totalBookings: 1,
          completedRevenue: 79000,
          soldCount: 1,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }], statsCalls))
        .mockReturnValueOnce(createRecordingChainMock([], listCalls));

      const result = await service.getBookings({
        status: 'CONFIRMED',
        performanceId: '11111111-1111-4111-8111-000000000301',
        showtimeId: '11111111-1111-4111-8111-000000000302',
        funnelStatus: 'SOLD',
        paymentStatus: 'DONE',
        paymentMethod: 'CARD',
        audienceRegion: 'domestic',
        seatTier: 'VIP',
        floorKey: '1F',
        seatQuery: 'A-10',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        search: 'buyer@example.com',
        page: 2,
      } as any);

      const statsWhere = statsCalls.find((call) => call.method === 'where')?.args[0];
      const listWhere = listCalls.find((call) => call.method === 'where')?.args[0];

      expect(objectGraphContains(statsWhere, 'CONFIRMED')).toBe(true);
      expect(objectGraphContains(statsWhere, '11111111-1111-4111-8111-000000000301')).toBe(true);
      expect(objectGraphContains(statsWhere, '11111111-1111-4111-8111-000000000302')).toBe(true);
      expect(objectGraphContains(statsWhere, 'SOLD')).toBe(true);
      expect(objectGraphContains(statsWhere, 'DONE')).toBe(true);
      expect(objectGraphContains(statsWhere, 'CARD')).toBe(true);
      expect(objectGraphContains(statsWhere, '카드')).toBe(true);
      expect(objectGraphContains(listWhere, 'CARD')).toBe(true);
      expect(objectGraphContains(listWhere, '카드')).toBe(true);
      expect(objectGraphContains(statsWhere, 'KR')).toBe(true);
      expect(objectGraphContains(statsWhere, 'VIP')).toBe(true);
      expect(objectGraphContains(statsWhere, '1F')).toBe(true);
      expect(objectGraphContains(statsWhere, 'A-10')).toBe(true);
      expect(objectGraphContains(statsWhere, 'buyer@example.com')).toBe(true);
      expect(objectGraphContains(listWhere, '2026-06-30T15:00:00.000Z')).toBe(true);
      expect(objectGraphContains(listWhere, '2026-07-31T14:59:59.999Z')).toBe(true);
      expect(result.stats.soldCount).toBe(1);
      expect(result.total).toBe(1);
    });

    it('searches ticket item seat_id as well as seat key, tier, row, and number', async () => {
      const listCalls: Array<{ method: string; args: unknown[] }> = [];

      mockDb.select
        .mockReturnValueOnce(createRecordingChainMock([{
          totalBookings: 0,
          completedRevenue: 0,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }], []))
        .mockReturnValueOnce(createRecordingChainMock([], listCalls));

      await service.getBookings({ search: 'seat-legacy-id' });

      const listWhere = listCalls.find((call) => call.method === 'where')?.args[0];
      expect(objectGraphText(listWhere)).toContain('admin_search_ti.seat_id');
    });

    it('returns tier statistics from ticket items and showtime capacity rows', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 158000,
          soldCount: 1,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(
          createChainMock([
            {
              reservation: {
                id: 'reservation-1',
                reservationNumber: 'R-SOLD-001',
                tossOrderId: 'GRP-TOSS-SOLD-001',
                status: 'CONFIRMED',
                totalAmount: 158000,
                createdAt: new Date('2026-07-01T03:00:00.000Z'),
              },
              user: {
                name: '김예매',
                email: 'buyer@example.com',
                country: 'KR',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              payment: {
                status: 'DONE',
                method: 'CARD',
              },
              refund: {
                status: null,
              },
            },
          ]),
        )
        .mockReturnValueOnce(createChainMock([ticketItem(), ticketItem({
          id: 'ticket-item-a2',
          seatId: '1F:A-2',
          seatKey: '1F:A-2',
          number: '2',
          admissionState: 'entered',
          enteredAt: new Date('2026-07-18T10:05:00.000Z'),
        })]))
        .mockReturnValueOnce(createChainMock([
          {
            tierName: 'VIP',
            price: 79000,
            soldSeats: 2,
            activeRevenue: 158000,
            cancelProcessingSeats: 1,
            cancelledSeats: 3,
            enteredSeats: 1,
          },
        ]))
        .mockReturnValueOnce(createChainMock([
          {
            tierName: 'VIP',
            price: 79000,
            totalSeats: 100,
            unavailableSeats: 4,
          },
        ]));

      const result = await service.getBookings({
        performanceId: '11111111-1111-4111-8111-000000000301',
        showtimeId: '11111111-1111-4111-8111-000000000302',
      } as any);
      const tierStatsSelect = mockDb.select.mock.calls[3]?.[0] as Record<string, unknown>;
      const enteredSeatsSqlText = objectGraphText(tierStatsSelect.enteredSeats);

      expect(result.tierStats).toEqual([
        {
          tierName: 'VIP',
          price: 79000,
          soldSeats: 2,
          activeRevenue: 158000,
          averageTicketAmount: 79000,
          cancelProcessingSeats: 1,
          cancelledSeats: 3,
          enteredSeats: 1,
          totalSeats: 100,
          remainingSeats: 94,
          sellThroughRate: 2,
        },
      ]);
      expect(enteredSeatsSqlText).toContain('entered');
      expect(enteredSeatsSqlText).toContain('CONFIRMED');
      expect(enteredSeatsSqlText).toContain('DONE');
    });

    it('sorts tier statistics by effective average amount, sold seats, then tier name after capacity merge', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 0,
          completedRevenue: 0,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([
          {
            tierName: 'B',
            price: 10000,
            soldSeats: 1,
            activeRevenue: 30000,
            cancelProcessingSeats: 0,
            cancelledSeats: 0,
            enteredSeats: 0,
          },
          {
            tierName: 'A',
            price: 10000,
            soldSeats: 2,
            activeRevenue: 60000,
            cancelProcessingSeats: 0,
            cancelledSeats: 0,
            enteredSeats: 0,
          },
          {
            tierName: 'C',
            price: 10000,
            soldSeats: 5,
            activeRevenue: 100000,
            cancelProcessingSeats: 0,
            cancelledSeats: 0,
            enteredSeats: 0,
          },
        ]))
        .mockReturnValueOnce(createChainMock([
          {
            tierName: 'Capacity Only',
            price: 50000,
            totalSeats: 10,
            unavailableSeats: 0,
          },
        ]));

      const result = await service.getBookings({
        showtimeId: '11111111-1111-4111-8111-000000000302',
      } as any);

      expect(result.tierStats.map((tier) => tier.tierName)).toEqual([
        'A',
        'B',
        'C',
        'Capacity Only',
      ]);
      expect(result.tierStats.map((tier) => tier.averageTicketAmount)).toEqual([
        30000,
        30000,
        20000,
        0,
      ]);
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

  describe('detail', () => {
    it('returns admin booking detail with ticket item status, admission, and refund fields', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createChainMock([
            {
              reservation: {
                id: 'reservation-1',
                reservationNumber: 'R-DETAIL-001',
                tossOrderId: 'GRP-TOSS-DETAIL-001',
                status: 'CONFIRMED',
                totalAmount: 158000,
                createdAt: new Date('2026-07-01T03:00:00.000Z'),
              },
              user: {
                name: '김예매',
                phone: '+821012345678',
                email: 'buyer@example.com',
                country: 'KR',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              payment: {
                status: 'DONE',
                method: 'CARD',
              },
              refund: {
                status: null,
              },
            },
          ]),
        )
        .mockReturnValueOnce(
          createChainMock([
            ticketItem({
              id: 'ticket-item-a1',
              seatKey: '1F:A-1',
              number: '1',
              status: 'active',
              admissionState: 'entered',
              enteredAt: new Date('2026-07-18T10:05:00.000Z'),
            }),
            ticketItem({
              id: 'ticket-item-a2',
              seatId: '1F:A-2',
              seatKey: '1F:A-2',
              number: '2',
              status: 'cancelled',
              cancelledAt: new Date('2026-07-02T01:00:00.000Z'),
              cancelReason: '일정 변경',
              serviceFeeRefund: 2000,
              refundableAmount: 79000,
              reopenState: 'available',
            }),
          ]),
        )
        .mockReturnValueOnce(
          createChainMock([
            {
              paymentKey: 'payment-key-1',
              method: 'CARD',
              amount: 158000,
              status: 'DONE',
              createdAt: new Date('2026-07-01T03:00:30.000Z'),
              paidAt: new Date('2026-07-01T03:01:00.000Z'),
              provider: 'CARD',
              currency: 'KRW',
            },
          ]),
        );

      const result = await service.getBookingDetail('reservation-1');

      expect(result.seats).toEqual([
        expect.objectContaining({ seatKey: '1F:A-1', number: '1' }),
        expect.objectContaining({ seatKey: '1F:A-2', number: '2' }),
      ]);
      expect(result.paymentFailureDiagnostic).toBeNull();
      expect(result.paymentMethodAttribution).toEqual({
        label: '카드 / 카드사 / KRW',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        source: 'DB',
      });
      expect(result.ticketItems).toEqual([
        expect.objectContaining({
          id: 'ticket-item-a1',
          status: 'ACTIVE',
          admissionState: 'ENTERED',
          enteredAt: '2026-07-18T10:05:00.000Z',
          refundableAmount: 0,
          reopenState: 'NOT_REQUIRED',
        }),
        expect.objectContaining({
          id: 'ticket-item-a2',
          status: 'CANCELLED',
          admissionState: 'NOT_ENTERED',
          cancelledAt: '2026-07-02T01:00:00.000Z',
          cancelReason: '일정 변경',
          serviceFeeRefund: 2000,
          refundableAmount: 79000,
          reopenState: 'AVAILABLE',
        }),
      ]);
      expect(result).toMatchObject({
        tossOrderId: 'GRP-TOSS-DETAIL-001',
        userEmail: 'buyer@example.com',
        userCountry: 'KR',
        paymentStatus: 'DONE',
        paymentMethod: 'CARD',
        paymentAttemptedAt: '2026-07-01T03:00:30.000Z',
        paymentCompletedAt: '2026-07-01T03:01:00.000Z',
        funnelStatus: 'PARTIAL_CANCELLED',
        ticketStatusCounts: {
          ACTIVE: 1,
          CANCELLATION_PENDING: 0,
          CANCELLED: 1,
          EXPIRED: 0,
        },
        paymentInfo: {
          paymentKey: 'payment-key-1',
          method: 'CARD',
          amount: 158000,
          status: 'DONE',
          paidAt: '2026-07-01T03:01:00.000Z',
          paymentMethod: {
            method: 'CARD',
            provider: 'CARD',
            currency: 'KRW',
          },
        },
      });
    });

    it('returns booking detail diagnostic and non-null missing payment attribution', async () => {
      const detailCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select
        .mockReturnValueOnce(
          createRecordingChainMock([
            {
              reservation: {
                id: 'reservation-1',
                reservationNumber: 'R-DETAIL-001',
                tossOrderId: 'GRP-TOSS-DETAIL-001',
                status: 'FAILED',
                totalAmount: 158000,
                createdAt: new Date('2026-07-01T03:00:00.000Z'),
              },
              user: {
                name: '김예매',
                phone: '+821012345678',
                email: 'buyer@example.com',
                country: 'KR',
              },
              showtime: {
                dateTime: new Date('2026-07-18T10:00:00.000Z'),
              },
              performance: {
                title: 'Girl Rules Fanmeeting',
              },
              refund: {
                status: null,
              },
              diagnostic: {
                diagnosticKind: 'provider_status',
                diagnosticCode: 'NOT_FOUND',
                diagnosticMessage: 'Provider payment was not found',
                diagnosticSource: 'DB',
                recordedAt: new Date('2026-07-01T03:06:00.000Z'),
                providerCheckStatus: 'not_found',
                providerCheckedAt: new Date('2026-07-01T03:07:00.000Z'),
                providerCheckMessage: 'Toss 결제 건 없음',
              },
            },
          ], detailCalls),
        )
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookingDetail('reservation-1');

      const leftJoinTables = detailCalls
        .filter((call) => call.method === 'leftJoin')
        .map((call) => call.args[0]);
      expect(leftJoinTables).toContain(reservationPaymentFailureDiagnostics);
      expect(result.paymentFailureDiagnostic).toEqual({
        kind: 'provider_status',
        code: 'NOT_FOUND',
        message: 'Provider payment was not found',
        source: 'DB',
        recordedAt: '2026-07-01T03:06:00.000Z',
        providerCheckStatus: 'not_found',
        providerCheckedAt: '2026-07-01T03:07:00.000Z',
        providerCheckMessage: 'Toss 결제 건 없음',
      });
      expect(result.paymentMethodAttribution).toEqual({
        label: '결제수단 확인 필요',
        method: null,
        provider: null,
        currency: null,
        source: 'Needs Review: payment row missing',
      });
    });
  });

  describe('exportReservations', () => {
    it('exports raw reservation CSV with all seven filters, formula neutralization, and metadata-only audit', async () => {
      const exportCalls: Array<{ method: string; args: unknown[] }> = [];

      mockDb.select.mockReturnValueOnce(
        createRecordingChainMock([
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
            ticketItem: ticketItem({
              id: 'ticket-item-raw-1',
              reservationId: 'reservation-raw-1',
              paymentId: 'payment-raw-1',
              showtimeId: 'showtime-raw-1',
              seatId: '2F:A-1',
              seatKey: '2F:A-1',
              floorKey: '2F',
              floorLabel: '2층',
              tierName: 'VIP',
              row: 'A',
              number: '1',
              price: 99000,
            }),
            payment: {
              method: 'CARD',
              status: 'DONE',
              paidAt: new Date('2026-07-01T03:01:00.000Z'),
            },
          },
        ], exportCalls),
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
      const exportWhere = exportCalls.find((call) => call.method === 'where')?.args[0];
      expect(objectGraphContains(exportWhere, 'CARD')).toBe(true);
      expect(objectGraphContains(exportWhere, '카드')).toBe(true);

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

    it('exports raw reservation CSV as ticket-item rows with status, admission, and refund columns', async () => {
      mockDb.select.mockReturnValueOnce(
        createChainMock([
          {
            reservation: {
              id: 'reservation-raw-1',
              reservationNumber: 'R-RAW-001',
              status: 'CONFIRMED',
              totalAmount: 158000,
              createdAt: new Date('2026-07-01T03:00:00.000Z'),
            },
            user: {
              name: '김예매',
              email: 'buyer@example.com',
              phone: '+821055501234',
              country: 'TH',
            },
            showtime: {
              dateTime: new Date('2026-07-18T10:00:00.000Z'),
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            ticketItem: ticketItem({
              id: 'ticket-item-a2',
              status: 'cancelled',
              admissionState: 'not_entered',
              cancelledAt: new Date('2026-07-02T01:00:00.000Z'),
              cancelReason: '일정 변경',
              serviceFeeRefund: 2000,
              refundableAmount: 79000,
              reopenState: 'available',
            }),
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
        filters: {
          eventId: 'performance-1',
          exportType: 'raw_pii',
          reason: '정산 대조',
        },
      });

      expect(result.rowCount).toBe(1);
      expect(result.csv).toContain('"Audience Region","User Country","Performance Title"');
      expect(result.csv).toContain('"overseas","TH","Girl Rules Fanmeeting"');
      expect(result.csv).toContain('"Ticket Item ID"');
      expect(result.csv).toContain('"Ticket Item Status"');
      expect(result.csv).toContain('"Admission State"');
      expect(result.csv).toContain('"Ticket Price","Service Fee","Item Gross Amount"');
      expect(result.csv).toContain('"Refundable Amount"');
      expect(result.csv).toContain('"ticket-item-a2"');
      expect(result.csv).toContain('"CANCELLED"');
      expect(result.csv).toContain('"NOT_ENTERED"');
      expect(result.csv).toContain('"77000","2000","79000"');
      expect(result.csv).toContain('"79000"');
    });

    it('includes failed reservations without ticket items as reservation-level CSV rows', async () => {
      mockDb.select.mockReturnValueOnce(
        createChainMock([
          {
            reservation: {
              id: 'reservation-failed-no-ticket',
              reservationNumber: 'R-FAILED-NO-TICKET',
              status: 'FAILED',
              totalAmount: 724000,
              createdAt: new Date('2026-06-07T12:14:00.000Z'),
            },
            user: {
              name: 'Wu Tsai Jung',
              email: 'failed-buyer@example.com',
              phone: '+886952228683',
              country: 'TW',
            },
            showtime: {
              dateTime: new Date('2026-07-04T06:00:00.000Z'),
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            ticketItem: null,
            payment: {
              method: null,
              status: null,
              paidAt: null,
            },
          },
        ]),
      );

      const result = await service.exportReservations({
        actorUserId: 'admin-1',
        filters: {
          reservationStatus: 'FAILED',
          exportType: 'raw_pii',
          reason: '실패 고객 안내',
        },
      });

      expect(result.rowCount).toBe(1);
      expect(result.csv).toContain(`"R-FAILED-NO-TICKET","Wu Tsai Jung","failed-buyer@example.com","'+886952228683"`);
      expect(result.csv).toContain('"overseas","TW","Girl Rules Fanmeeting"');
      expect(result.csv).toContain('"724000","FAILED"');
      expect(result.csv).not.toContain('undefined');
      expect(result.csv).not.toContain('null');
    });

    it('filters exports by admin funnel status so expired pending payments appear as payment failed', async () => {
      const exportCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select.mockReturnValueOnce(
        createRecordingChainMock([
          {
            reservation: {
              id: 'reservation-expired-no-ticket',
              reservationNumber: 'R-EXPIRED-NO-TICKET',
              status: 'PENDING_PAYMENT',
              totalAmount: 724000,
              createdAt: new Date('2026-06-07T12:14:00.000Z'),
            },
            user: {
              name: 'Expired Buyer',
              email: 'expired-buyer@example.com',
              phone: '+886900000000',
              country: 'TW',
            },
            showtime: {
              dateTime: new Date('2026-07-04T06:00:00.000Z'),
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            ticketItem: null,
            payment: {
              method: 'CARD',
              status: 'EXPIRED',
              paidAt: null,
            },
          },
        ], exportCalls),
      );

      const result = await service.exportReservations({
        actorUserId: 'admin-1',
        filters: {
          funnelStatus: 'PAYMENT_FAILED',
          exportType: 'raw_pii',
          reason: '만료 고객 안내',
        },
      });

      expect(result.rowCount).toBe(1);
      expect(result.csv).toContain('"R-EXPIRED-NO-TICKET"');
      expect(result.csv).toContain('"CARD","EXPIRED","724000","PENDING_PAYMENT"');
      const exportWhere = exportCalls.find((call) => call.method === 'where')?.args[0];
      expect(objectGraphContains(exportWhere, 'PAYMENT_FAILED')).toBe(true);
      expect(objectGraphContains(exportWhere, 'EXPIRED')).toBe(true);

      const [auditInput] = mockAdminAuditService.write.mock.calls[0]!;
      expect(auditInput).toMatchObject({
        after: {
          filters: {
            funnelStatus: 'PAYMENT_FAILED',
          },
          rowCount: 1,
        },
      });
    });

    it('exports failed, expired, and cancelled contacts as one row per customer and performance', async () => {
      const exportCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select.mockReturnValueOnce(
        createRecordingChainMock([
          {
            user: {
              id: 'user-1',
              name: '=Failed Buyer',
              email: '=failed@example.com',
              phone: '+886900000000',
              country: 'TW',
              marketingConsent: true,
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            reservation: {
              reservationNumber: 'R-EXPIRED-LATEST',
              status: 'PENDING_PAYMENT',
              createdAt: new Date('2026-06-07T12:20:00.000Z'),
            },
            payment: {
              status: 'EXPIRED',
            },
            diagnostic: {
              diagnosticCode: 'PAY_PROCESS_CANCELED',
              diagnosticMessage: '=Formula reason',
              diagnosticSource: 'Webhook',
            },
            cancellation: {
              reason: null,
              revenue: 0,
              source: null,
            },
          },
          {
            user: {
              id: 'user-1',
              name: '=Failed Buyer',
              email: '=failed@example.com',
              phone: '+886900000000',
              country: 'TW',
              marketingConsent: true,
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            reservation: {
              reservationNumber: 'R-FAILED-OLDER',
              status: 'FAILED',
              createdAt: new Date('2026-06-07T12:10:00.000Z'),
            },
            payment: {
              status: null,
            },
            diagnostic: null,
            cancellation: {
              reason: null,
              revenue: 0,
              source: null,
            },
          },
          {
            user: {
              id: 'user-2',
              name: 'Cancelled Buyer',
              email: 'cancelled@example.com',
              phone: '+821055501234',
              country: 'KR',
              marketingConsent: false,
            },
            performance: {
              id: 'performance-1',
              title: 'Girl Rules Fanmeeting',
            },
            reservation: {
              reservationNumber: 'R-CANCELLED',
              status: 'CANCELLED',
              createdAt: new Date('2026-06-06T09:00:00.000Z'),
            },
            payment: {
              status: 'CANCELED',
            },
            diagnostic: null,
            cancellation: {
              reason: '고객 요청',
              revenue: 1000,
              source: 'ticket_item',
            },
          },
        ], exportCalls),
      );

      const result = await service.exportReservations({
        actorUserId: 'admin-1',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
        filters: {
          eventId: 'performance-1',
          audienceRegion: 'overseas',
          paymentMethod: 'CARD',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-30',
          exportType: 'failed_cancelled_contacts',
          reason: '실패 고객 안내',
        },
      });

      expect(result.rowCount).toBe(2);
      expect(result.filename).toContain('reservation-export-failed-cancelled-contacts');
      const header = result.csv.split('\n')[0] ?? '';
      expect(header).toBe(
        '\uFEFF"User Name","User Email","User Phone","Audience Region","User Country","Performance ID","Performance Title","Last Affected Reservation Number","Last Reservation Status","Last Payment Status","Last Affected At","Payment Failed/Expired Count","Cancelled Count","Marketing Consent","Last Failure Code","Last Failure Reason","Diagnostic Source","Last Cancellation Reason","Cancellation Revenue","Cancellation Source","Last Affected Reason"',
      );
      expect(result.csv).toContain(`"'=Failed Buyer","'=failed@example.com","'+886900000000"`);
      expect(result.csv).toContain('"R-EXPIRED-LATEST","PENDING_PAYMENT","EXPIRED"');
      expect(result.csv).toContain('"2","0","Y"');
      expect(result.csv).toContain('"PAY_PROCESS_CANCELED","\'=Formula reason","Webhook"');
      expect(result.csv).toContain(`"Cancelled Buyer","cancelled@example.com","'+821055501234"`);
      expect(result.csv).toContain('"R-CANCELLED","CANCELLED","CANCELED"');
      expect(result.csv).toContain('"고객 요청","1000","ticket_item"');
      expect(result.csv).toContain('"고객 요청"');
      expect(result.csv).toContain('"0","1","N"');

      const exportWhere = exportCalls.find((call) => call.method === 'where')?.args[0];
      const exportWhereText = objectGraphText(exportWhere);
      expect(exportWhereText).toContain('not exists');
      expect(exportWhereText).toContain('active');
      expect(exportWhereText).toContain('FAILED');
      expect(exportWhereText).toContain('PENDING_PAYMENT');
      expect(exportWhereText).toContain('EXPIRED');
      expect(exportWhereText).toContain('CANCELLED');

      const [auditInput] = mockAdminAuditService.write.mock.calls[0]!;
      expect(auditInput).toMatchObject({
        actorUserId: 'admin-1',
        action: 'reservations.export_raw',
        resourceType: 'reservation_export',
        resourceId: 'failed_cancelled_contacts',
        status: 'success',
        reason: '실패 고객 안내',
        after: {
          exportType: 'failed_cancelled_contacts',
          filters: {
            eventId: 'performance-1',
            audienceRegion: 'overseas',
            paymentMethod: 'CARD',
            dateFrom: '2026-06-01',
            dateTo: '2026-06-30',
          },
          rowCount: 2,
        },
      });
      expect(JSON.stringify(auditInput)).not.toContain('failed@example.com');
      expect(JSON.stringify(auditInput)).not.toContain('+886900000000');
      expect(JSON.stringify(auditInput)).not.toContain('R-EXPIRED-LATEST');
      expect(JSON.stringify(auditInput)).not.toContain('PAY_PROCESS_CANCELED');
      expect(JSON.stringify(auditInput)).not.toContain('Formula reason');
    });

    it('keeps active ticket exclusion scoped to the same performance for failed/cancelled contact exports', async () => {
      const exportCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select.mockReturnValueOnce(createRecordingChainMock([], exportCalls));

      await service.exportReservations({
        actorUserId: 'admin-1',
        filters: {
          exportType: 'failed_cancelled_contacts',
          reason: '실패 고객 안내',
        },
      });

      const exportWhere = exportCalls.find((call) => call.method === 'where')?.args[0];
      const exportWhereText = objectGraphText(exportWhere);

      expect(exportWhereText).toContain('active_r.user_id');
      expect(exportWhereText).toContain('active_st.performance_id');
      expect(exportWhereText).toContain('ticket_items');
      expect(exportWhereText).toContain('active');
    });

    it('prefixes raw reservation CSV with a UTF-8 BOM for Excel-compatible Korean names and seat labels', async () => {
      mockDb.select.mockReturnValueOnce(
        createChainMock([
          {
            reservation: {
              id: 'reservation-raw-1',
              reservationNumber: 'R-RAW-001',
              status: 'CONFIRMED',
              totalAmount: 79000,
              createdAt: new Date('2026-07-01T03:00:00.000Z'),
            },
            user: {
              name: '김예매',
              email: 'buyer@example.com',
              phone: '+821055501234',
              country: 'KR',
            },
            showtime: {
              dateTime: new Date('2026-07-18T10:00:00.000Z'),
            },
            performance: {
              id: 'performance-1',
              title: '걸 룰즈',
            },
            ticketItem: ticketItem({
              id: 'ticket-item-a2',
              floorLabel: '1층',
              seatKey: '1F:가-12',
              row: '가',
              number: '12',
              cancelReason: '일정 변경',
            }),
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
        filters: {
          eventId: 'performance-1',
          exportType: 'raw_pii',
          reason: '정산 대조',
        },
      });

      expect(result.csv.charCodeAt(0)).toBe(0xfeff);
      expect(result.csv).toContain('"김예매"');
      expect(result.csv).toContain('"걸 룰즈"');
      expect(result.csv).toContain('"1F:가-12"');
      expect(result.csv).toContain('"일정 변경"');
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
