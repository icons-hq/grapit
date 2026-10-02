import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
  type Mock,
} from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import {
  ADMIN_BOOKING_AGGREGATE_CACHE_TTL_SECONDS,
  ADMIN_BOOKING_QUERY_TIMEOUT_MS,
  AdminBookingService,
} from './admin-booking.service.js';
import * as schema from '../../database/schema/index.js';
import {
  bookingOperationAuditLogs,
  payments,
  reservationPaymentFailureDiagnostics,
  reservationSeats,
  seatInventories,
} from '../../database/schema/index.js';
import { ASYNC_DONE_COMPENSATION_DIAGNOSTIC_CODES } from '../payment/async-done-compensation.js';
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
  const db = {
    select: vi.fn(() => createChainMock([])),
    execute: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  };
  // Bounded admin reads run inside a read-only transaction; by default the
  // transaction hands its callback the same select mock.
  db.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  );
  return db;
}

type CapturedQuery = { text: string; params: unknown[] };

/**
 * Real drizzle query builder over a fake node-postgres client. It renders the
 * exact SQL text the service sends, so FROM/JOIN mistakes that a chain mock
 * hides become visible without a database.
 */
function createSqlCapturingDb(captured: CapturedQuery[]) {
  const client = {
    query: vi.fn(async (config: string | { text: string }, params: unknown[] = []) => {
      captured.push({ text: typeof config === 'string' ? config : config.text, params });
      return { rows: [], rowCount: 0, fields: [] };
    }),
  };
  return drizzle({ client: client as never, schema });
}

/**
 * Every table referenced as "table"."column" must be in a FROM/JOIN of the
 * same statement (PostgreSQL: missing FROM-clause entry for table ...).
 */
function tablesReferencedWithoutFrom(sqlText: string): string[] {
  const referenced = new Set(
    [...sqlText.matchAll(/"([a-z_]+)"\."[a-z_]+"/g)].map((match) => match[1]!),
  );
  return [...referenced].filter(
    (table) => !new RegExp(`(from|join)\\s+"${table}"`, 'i').test(sqlText),
  );
}

const ADMIN_FUNNEL_STATUSES = [
  'SOLD',
  'PAYMENT_PENDING',
  'PAYMENT_PROCESSING',
  'PAYMENT_FAILED',
  'CANCEL_PROCESSING',
  'PARTIAL_CANCELLED',
  'CANCELLED',
] as const;

function refundResponse(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: 'reservation-1',
    reservationNumber: 'R-001',
    paymentKey: 'payment-key-1',
    refundableAmount: 50000,
    canRequestRefund: false,
    cancelledSeatHoldWindowMinutes: { min: 1, max: 10 },
    refundTimeline: {
      currentState: 'COMPLETED',
      requestedAt: '2026-07-01T03:00:00.000Z',
      customerServiceCtaVisible: false,
    },
    cancellationQuote: null,
    providerRefund: { currency: 'KRW', amountMinor: 50000, amountDecimal: '50000' },
    idempotent: false,
    retryEnqueued: false,
    ...overrides,
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
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
              then: (resolve: (value: unknown) => void) => resolve(undefined),
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
          localDeadlineExpiredCount: 1,
          providerExpiredCount: 0,
          providerAbortedCount: 0,
          buyerCancelledBeforeConfirmCount: 0,
          unreconciledProviderExpiredCount: 0,
          compensatedCancelCount: 0,
          otherPaymentFailureCount: 0,
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
        localDeadlineExpiredCount: 1,
        providerExpiredCount: 0,
        providerAbortedCount: 0,
        buyerCancelledBeforeConfirmCount: 0,
        unreconciledProviderExpiredCount: 0,
        compensatedCancelCount: 0,
        otherPaymentFailureCount: 0,
        cancelledCount: 1,
      });
      expect(result.stats.cancelRate).toBe(25);
      expect(result.total).toBe(4);
      const statsSelect = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(objectGraphContains(statsSelect.expiredPaymentCount, 'PAYMENT_DEADLINE_EXPIRED')).toBe(true);
      expect(objectGraphContains(statsSelect.expiredPaymentCount, 'EXPIRED')).toBe(true);
      expect(objectGraphContains(statsSelect.abortedPaymentCount, 'ABORTED')).toBe(true);
      expect(objectGraphContains(statsSelect.abortedPaymentCount, 'PAYMENT_CANCELED_BEFORE_CONFIRM')).toBe(true);
      expect(objectGraphContains(statsSelect.abortedPaymentCount, 'ASYNC_DONE_SEAT_UNAVAILABLE_CANCELLED')).toBe(true);
      expect(objectGraphText(statsSelect.totalBookings)).toContain('distinct');
      expect(objectGraphContains(statsSelect.unreconciledProviderExpiredCount, 'PAYMENT_DEADLINE_EXPIRED')).toBe(true);
      expect(objectGraphContains(statsSelect.unreconciledProviderExpiredCount, 'payment_webhook_events')).toBe(true);
    });

    it('uses deterministic pagination order', async () => {
      const listCalls: Array<{ method: string; args: unknown[] }> = [];
      const bookingRow = {
        reservation: {
          id: 'reservation-expired-1',
          reservationNumber: 'R-EXP-001',
          tossOrderId: 'GRP-TOSS-EXP-001',
          status: 'FAILED',
          totalAmount: 79000,
          createdAt: new Date('2026-07-01T03:00:00.000Z'),
        },
        user: {
          name: '김중복',
          email: 'duplicate@example.com',
          country: 'KR',
        },
        showtime: {
          dateTime: new Date('2026-07-18T10:00:00.000Z'),
        },
        performance: {
          title: 'Girl Rules Fanmeeting',
        },
        payment: {
          id: 'payment-expired-1',
          status: 'EXPIRED',
          method: 'CARD',
          provider: 'CARD',
          currency: 'KRW',
        },
        refund: {
          status: null,
        },
        diagnostic: {
          diagnosticKind: 'payment_expired',
          diagnosticCode: 'PAYMENT_EXPIRED',
          diagnosticMessage: '결제 유효 시간이 만료되었습니다.',
          diagnosticSource: 'payment_webhook_events',
          recordedAt: new Date('2026-07-01T03:05:00.000Z'),
          providerCheckStatus: 'not_checked',
          providerCheckedAt: null,
          providerCheckMessage: null,
        },
      };

      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 0,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 1,
          expiredPaymentCount: 1,
          abortedPaymentCount: 0,
          localDeadlineExpiredCount: 0,
          providerExpiredCount: 1,
          providerAbortedCount: 0,
          buyerCancelledBeforeConfirmCount: 0,
          unreconciledProviderExpiredCount: 0,
          compensatedCancelCount: 0,
          otherPaymentFailureCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(
          createRecordingChainMock([
            bookingRow,
          ], listCalls),
        )
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookings({});

      const orderByCall = listCalls.find((call) => call.method === 'orderBy');
      expect(orderByCall?.args.length).toBeGreaterThanOrEqual(2);
      expect(result.bookings).toHaveLength(1);
      expect(result.bookings[0]).toMatchObject({
        id: 'reservation-expired-1',
        paymentFailureBucket: 'provider_expired',
      });
    });

    it('keeps webhook-sourced local deadline failures local without a terminal provider expiry signal', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainMock([{
          totalBookings: 1,
          completedRevenue: 0,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 1,
          expiredPaymentCount: 1,
          abortedPaymentCount: 0,
          localDeadlineExpiredCount: 1,
          providerExpiredCount: 0,
          providerAbortedCount: 0,
          buyerCancelledBeforeConfirmCount: 0,
          unreconciledProviderExpiredCount: 0,
          compensatedCancelCount: 0,
          otherPaymentFailureCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
        }]))
        .mockReturnValueOnce(createChainMock([
          {
            reservation: {
              id: 'reservation-local-webhook-source',
              reservationNumber: 'R-LOCAL-WEBHOOK-SOURCE',
              tossOrderId: 'GRP-LOCAL-WEBHOOK-SOURCE',
              status: 'FAILED',
              totalAmount: 79000,
              createdAt: new Date('2026-07-01T03:00:00.000Z'),
            },
            user: {
              name: 'Webhook Source',
              email: 'webhook-source@example.com',
              country: 'KR',
            },
            showtime: {
              dateTime: new Date('2026-07-18T10:00:00.000Z'),
            },
            performance: {
              title: 'Girl Rules Fanmeeting',
            },
            payment: null,
            refund: null,
            diagnostic: {
              diagnosticKind: 'payment_expired',
              diagnosticCode: 'PAYMENT_DEADLINE_EXPIRED',
              diagnosticMessage: '결제 제한 시간이 만료되었습니다.',
              diagnosticSource: 'payment_webhook_events',
              recordedAt: new Date('2026-07-01T03:05:00.000Z'),
              providerCheckStatus: 'not_checked',
              providerCheckedAt: null,
              providerCheckMessage: null,
            },
          },
        ]))
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([]));

      const result = await service.getBookings({});

      expect(result.bookings[0]).toMatchObject({
        paymentFailureBucket: 'local_deadline_expired',
      });
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
        paymentFailureBucket: 'provider_aborted',
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
        paymentFailureBucket: 'local_deadline_expired',
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

    it.each(Object.values(ASYNC_DONE_COMPENSATION_DIAGNOSTIC_CODES))(
      'buckets an async DONE compensation (%s) as a compensated cancel, not a buyer cancellation',
      async (diagnosticCode) => {
        mockDb.select
          .mockReturnValueOnce(createChainMock([{
            totalBookings: 1,
            completedRevenue: 0,
            soldCount: 0,
            pendingPaymentCount: 0,
            paymentProcessingCount: 0,
            failedCount: 1,
            cancelProcessingCount: 0,
            cancelledCount: 0,
            partialCancelledCount: 0,
          }]))
          .mockReturnValueOnce(createChainMock([{
            reservation: {
              id: 'reservation-compensated-1',
              reservationNumber: 'R-COMPENSATED-001',
              tossOrderId: 'GRP-TOSS-COMPENSATED-001',
              status: 'FAILED',
              totalAmount: 79000,
              createdAt: new Date('2026-07-01T03:00:00.000Z'),
            },
            user: { name: '김보상', email: 'compensated@example.com', country: 'KR' },
            showtime: { dateTime: new Date('2026-07-18T10:00:00.000Z') },
            performance: { title: 'Girl Rules Fanmeeting' },
            payment: {
              id: 'payment-compensated-1',
              status: 'CANCELED',
              method: 'FOREIGN_EASY_PAY',
              provider: 'ALIPAY_PLUS',
              currency: 'KRW',
            },
            refund: { status: null },
            diagnostic: {
              diagnosticKind: 'payment_compensated_cancel',
              diagnosticCode,
              diagnosticMessage: '자동 취소',
              diagnosticSource: 'async_done_compensation_recovery',
              recordedAt: new Date('2026-07-01T03:05:00.000Z'),
              providerCheckStatus: 'not_checked',
              providerCheckedAt: null,
              providerCheckMessage: null,
            },
          }]))
          .mockReturnValueOnce(createChainMock([]))
          .mockReturnValueOnce(createChainMock([]));

        const result = await service.getBookings({});

        expect(result.bookings[0]).toMatchObject({ paymentFailureBucket: 'compensated_cancel' });
        const statsSelect = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(objectGraphContains(statsSelect.compensatedCancelCount, diagnosticCode)).toBe(true);
        expect(objectGraphContains(statsSelect.abortedPaymentCount, diagnosticCode)).toBe(true);
      },
    );

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

    it('manual open rejects protected seats without false success audits or broadcasts', async () => {
      const operatorUserId = 'admin-1';
      const reservationId = 'reservation-1';
      const showtimeId = 'showtime-1';
      const reason = '좌석 재오픈 요청 확인';

      const seatInventoryUpdateCalls: Array<{ whereArgs: unknown[] }> = [];
      const insertCalls: Array<{ table: unknown; values: unknown }> = [];

      const tx = {
        update(table: unknown) {
          return {
            set(_values: Record<string, unknown>) {
              return {
                where(...whereArgs: unknown[]) {
                  if (table === seatInventories) {
                    seatInventoryUpdateCalls.push({ whereArgs });
                    return { returning: vi.fn().mockResolvedValue([]) };
                  }
                  return Promise.resolve(undefined);
                },
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
          ]),
        );
      mockDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx),
      );

      await expect((service as any).manualOpen(reservationId, operatorUserId, reason)).rejects.toThrow('현재 다시 판매할 수 있는 취소 좌석이 없습니다.');

      expect(insertCalls).toHaveLength(0);
      expect(mockAdminAuditService.write).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();

      expect(seatInventoryUpdateCalls).toHaveLength(1);
      const renderedWhere = new PgDialect().sqlToQuery(
        seatInventoryUpdateCalls[0]!.whereArgs[0] as SQL,
      ).sql;
      expect(renderedWhere).toContain('not exists');
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
        {},
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
              overrideOptions: {},
            }),
          }),
        }),
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'a completed PG cancel',
        response: refundResponse(),
        outcome: 'completed',
        auditStatus: 'success',
        message: '환불이 완료되었습니다',
      },
      {
        name: 'a PG rejection that restored the buyer rights',
        response: refundResponse({
          canRequestRefund: true,
          refundTimeline: { currentState: 'FAILED', requestedAt: '2026-07-01T03:00:00.000Z', customerServiceCtaVisible: false },
        }),
        outcome: 'rights_restored',
        auditStatus: 'failed',
        message: '결제사가 환불을 거절했습니다',
      },
      {
        name: 'a refund recorded as failed',
        response: refundResponse({
          refundTimeline: { currentState: 'FAILED', requestedAt: '2026-07-01T03:00:00.000Z', customerServiceCtaVisible: true },
        }),
        outcome: 'failed',
        auditStatus: 'failed',
        message: '환불에 실패했습니다',
      },
      {
        name: 'an already failed refund requested again',
        response: refundResponse({
          idempotent: true,
          refundTimeline: { currentState: 'FAILED', requestedAt: '2026-07-01T03:00:00.000Z', customerServiceCtaVisible: true },
        }),
        outcome: 'failed',
        auditStatus: 'failed',
        message: '이미 실패로 기록된 환불입니다',
      },
      {
        name: 'a transient PG failure waiting for automatic retry',
        response: refundResponse({
          retryEnqueued: true,
          refundTimeline: { currentState: 'SENT_TO_PG', requestedAt: '2026-07-01T03:00:00.000Z', customerServiceCtaVisible: false },
        }),
        outcome: 'processing',
        auditStatus: 'success',
        message: '자동으로 다시 확인합니다',
      },
      {
        name: 'a PG cancel still processing',
        response: refundResponse({
          refundTimeline: { currentState: 'PROCESSING_AT_PG', requestedAt: '2026-07-01T03:00:00.000Z', customerServiceCtaVisible: false },
        }),
        outcome: 'processing',
        auditStatus: 'success',
        message: '결제사에서 환불을 처리 중입니다',
      },
    ])('reports $name as $outcome instead of a completed refund', async ({
      response,
      outcome,
      auditStatus,
      message,
    }) => {
      mockRefundService.requestAdminRefund.mockResolvedValueOnce(response);

      const result = await service.refundBooking('reservation-1', 'admin-1', '관리자 환불');

      expect(result).toMatchObject({
        outcome,
        currentState: response.refundTimeline.currentState,
        idempotent: response.idempotent,
        retryEnqueued: response.retryEnqueued,
        refundableAmount: 50000,
      });
      expect(result.message).toContain(message);
      if (outcome !== 'completed') {
        expect(result.message).not.toContain('완료되었습니다');
      }
      expect(mockAdminAuditService.write).toHaveBeenCalledTimes(1);
      expect(mockAdminAuditService.write).toHaveBeenCalledWith(expect.objectContaining({
        action: 'refund.admin_refund',
        status: auditStatus,
        after: {
          refund: expect.objectContaining({
            outcome,
            currentState: response.refundTimeline.currentState,
          }),
        },
      }));
    });

    it('forwards the operator-confirmed preview amounts and records them in the audit', async () => {
      await service.refundBooking('reservation-1', 'admin-1', '수수료 확인 후 환불', {
        fullRefundOverride: false,
        expectedRefundableAmount: 48000,
        expectedProviderRefundAmountMinor: 3536,
      });

      expect(mockRefundService.requestAdminRefund).toHaveBeenCalledWith(
        'reservation-1',
        'admin-1',
        '수수료 확인 후 환불',
        {
          fullRefundOverride: false,
          expectedRefundableAmount: 48000,
          expectedProviderRefundAmountMinor: 3536,
        },
      );
      expect(mockAdminAuditService.write.mock.calls[0]![0].after.refund).toMatchObject({
        overrideOptions: { fullRefundOverride: false },
        expected: {
          expectedRefundableAmount: 48000,
          expectedProviderRefundAmountMinor: 3536,
        },
      });
    });

    it('rejects a stale preview amount with the RefundService conflict and audits the failure', async () => {
      mockRefundService.requestAdminRefund.mockRejectedValueOnce(
        new ConflictException('환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.'),
      );

      await expect(service.refundBooking('reservation-1', 'admin-1', '자정 경계', {
        expectedRefundableAmount: 79000,
      })).rejects.toThrow('환불 금액이 변경되었습니다');
      expect(mockAdminAuditService.write).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        after: { refund: { error: '환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.' } },
      }));
    });

    it('still reports the real refund outcome when the audit write fails after the PG cancel', async () => {
      mockAdminAuditService.write.mockRejectedValueOnce(new Error('audit db down'));

      const result = await service.refundBooking('reservation-1', 'admin-1', '관리자 환불');

      expect(result.outcome).toBe('completed');
      expect(mockAdminAuditService.write).toHaveBeenCalledTimes(1);
    });
  });

  describe('detail', () => {
    it('returns admin booking detail with ticket item status, admission, and refund fields', async () => {
      const detailCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select
        .mockReturnValueOnce(
          createRecordingChainMock([
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
                id: 'payment-1',
                paymentKey: 'payment-key-1',
                tossOrderId: 'GRP-TOSS-DETAIL-001',
                method: 'CARD',
                provider: 'CARD',
                currency: 'KRW',
                amount: 158000,
                status: 'DONE',
                createdAt: new Date('2026-07-01T03:00:30.000Z'),
                paidAt: new Date('2026-07-01T03:01:00.000Z'),
              },
              refund: {
                status: null,
              },
            },
          ], detailCalls),
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
        );

      const result = await service.getBookingDetail('reservation-1');

      expect(mockDb.select).toHaveBeenCalledTimes(2);
      const leftJoinTables = detailCalls
        .filter((call) => call.method === 'leftJoin')
        .map((call) => call.args[0]);
      expect(leftJoinTables).toContain(payments);
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
              payment: null,
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
      expect(leftJoinTables).toContain(payments);
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
      expect(result.paymentStatus).toBeNull();
      expect(result.paymentMethod).toBeNull();
      expect(result.paymentAttemptedAt).toBeNull();
      expect(result.paymentCompletedAt).toBeNull();
      expect(result.paymentInfo).toBeNull();
    });

    it('returns reservation seat fallback in admin detail when ticket items are not issued yet', async () => {
      const fallbackCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select
        .mockReturnValueOnce(
          createChainMock([
            {
              reservation: {
                id: 'reservation-pending-1',
                reservationNumber: 'R-PENDING-DETAIL-001',
                tossOrderId: 'GRP-TOSS-PENDING-DETAIL-001',
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
                id: 'payment-pending-1',
                paymentKey: 'payment-key-pending-1',
                tossOrderId: 'GRP-TOSS-PENDING-DETAIL-001',
                method: 'FOREIGN_EASY_PAY',
                provider: 'PAYPAL',
                currency: 'USD',
                amount: 158000,
                status: 'READY',
                createdAt: new Date('2026-07-01T03:00:30.000Z'),
                paidAt: null,
              },
              refund: {
                status: null,
              },
              diagnostic: null,
              providerExpiryWebhookReceived: false,
            },
          ]),
        )
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(
          createRecordingChainMock([
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
          ], fallbackCalls),
        );

      const result = await service.getBookingDetail('reservation-pending-1');

      expect(mockDb.select).toHaveBeenCalledTimes(3);
      const fallbackFromTables = fallbackCalls
        .filter((call) => call.method === 'from')
        .map((call) => call.args[0]);
      expect(fallbackFromTables).toContain(reservationSeats);
      expect(result.seats).toEqual([
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
      expect(result.ticketItems).toEqual([]);
      expect(result.paymentStatus).toBe('READY');
      expect(result.paymentMethodAttribution).toEqual({
        label: '해외간편결제 / PayPal / USD',
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'USD',
        source: 'DB',
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

    it('exports an active ticket manifest for one showtime with paid active tickets and layout seat ordering before A-1/A-2/A-10 fallback fields', async () => {
      const showtimeId = '11111111-1111-4111-8111-000000000302';
      const exportCalls: Array<{ method: string; args: unknown[] }> = [];
      mockDb.select.mockReturnValueOnce(
        createRecordingChainMock([
          {
            reservation: {
              reservationNumber: 'R-MANIFEST-001',
              status: 'CONFIRMED',
            },
            user: {
              name: '=Buyer',
              email: '=buyer@example.com',
              phone: '+821055501234',
              country: 'KR',
            },
            showtime: {
              dateTime: new Date('2026-07-18T10:00:00.000Z'),
            },
            performance: {
              title: 'Girl Rules Fanmeeting',
            },
            ticketItem: ticketItem({
              id: 'ticket-item-manifest-1',
              showtimeId,
              floorLabel: '1층',
              seatKey: '1F:가-2',
              tierName: 'SVIP',
              row: '가',
              number: '2',
              admissionState: 'entered',
              enteredAt: new Date('2026-07-18T11:00:00.000Z'),
            }),
          },
        ], exportCalls),
      );

      const result = await service.exportReservations({
        actorUserId: 'admin-1',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
        filters: {
          exportType: 'active_ticket_manifest',
          showtimeId,
          reason: '현장 운영 명단',
        },
      });

      expect(result.rowCount).toBe(1);
      expect(result.filename).toContain('reservation-export-active-ticket-manifest');
      expect(result.csv.charCodeAt(0)).toBe(0xfeff);
      expect(result.csv.split('\n')[0]).toBe(
        '\uFEFF"Tier","Seat","Ticket Seat Number","Floor","Row","Number","Reservation Number","Buyer Name","Buyer Phone","Buyer Email","Audience Region","Country","Performance Title","Show DateTime","Ticket Item ID","Admission State","Entered At"',
      );
      expect(result.csv).toContain(
        `"SVIP","1F:가-2","1층 SVIP 가열 2번","1층","가","2","R-MANIFEST-001","'=Buyer","'+821055501234","'=buyer@example.com","domestic","KR","Girl Rules Fanmeeting","2026-07-18T10:00:00.000Z","ticket-item-manifest-1","ENTERED","2026-07-18T11:00:00.000Z"`,
      );

      const exportWhere = exportCalls.find((call) => call.method === 'where')?.args[0];
      expect(objectGraphContains(exportWhere, showtimeId)).toBe(true);
      expect(objectGraphContains(exportWhere, 'CONFIRMED')).toBe(true);
      expect(objectGraphContains(exportWhere, 'active')).toBe(true);
      expect(objectGraphContains(exportWhere, 'DONE')).toBe(true);

      const exportJoinText = objectGraphText(
        exportCalls
          .filter((call) => call.method === 'innerJoin' || call.method === 'leftJoin')
          .map((call) => call.args),
      );
      expect(exportJoinText).toContain('payment_id');
      expect(exportJoinText).toContain('layout_seat_id');
      expect(exportJoinText).toContain('floor_id');

      const exportOrderByText = objectGraphText(
        exportCalls.find((call) => call.method === 'orderBy')?.args,
      );
      expect(exportOrderByText).toContain('sort_order');
      expect(exportOrderByText).toContain('tier_name');
      expect(exportOrderByText).toContain('seat_key');
      expect(exportOrderByText).toContain('number');
      const layoutSortSuffix = exportOrderByText.slice(exportOrderByText.indexOf('is null'));
      expect(layoutSortSuffix).toMatch(/is null[\s\S]*number[\s\S]*seat_key/);

      const [auditInput] = mockAdminAuditService.write.mock.calls[0]!;
      expect(auditInput).toMatchObject({
        actorUserId: 'admin-1',
        action: 'reservations.export_raw',
        resourceType: 'reservation_export',
        resourceId: 'active_ticket_manifest',
        status: 'success',
        reason: '현장 운영 명단',
        after: {
          exportType: 'active_ticket_manifest',
          filters: {
            showtimeId,
          },
          rowCount: 1,
        },
      });
      expect(JSON.stringify(auditInput)).not.toContain('buyer@example.com');
      expect(JSON.stringify(auditInput)).not.toContain('+821055501234');
      expect(JSON.stringify(auditInput)).not.toContain('R-MANIFEST-001');
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

    it.each(ADMIN_FUNNEL_STATUSES)(
      'renders raw export SQL for funnel status %s with every referenced table in FROM/JOIN',
      async (funnelStatus) => {
        const captured: CapturedQuery[] = [];
        const sqlService = new AdminBookingService(
          createSqlCapturingDb(captured) as never,
          mockBookingGateway as never,
          mockRefundService as never,
          mockAdminAuditService,
        );

        const result = await sqlService.exportReservations({
          actorUserId: 'admin-1',
          filters: { funnelStatus, exportType: 'raw_pii', reason: '실패·취소 고객 안내' },
        });

        expect(result.rowCount).toBe(0);
        const exportQuery = captured.find((query) => query.text.includes('"reservation_number"'));
        expect(exportQuery).toBeDefined();
        // Regression: CANCELLED / PAYMENT_FAILED filters reference
        // refunds.status through the cancel-processing CASE branch.
        expect(exportQuery!.text).toContain('"refunds"."status"');
        expect(tablesReferencedWithoutFrom(exportQuery!.text)).toEqual([]);
      },
    );
  });

  describe('list query bounds and aggregate cache', () => {
    function createMockCache(initial: Record<string, unknown> = {}) {
      const store = new Map<string, unknown>(Object.entries(initial));
      return {
        store,
        get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
        set: vi.fn(async (key: string, value: unknown) => {
          store.set(key, JSON.parse(JSON.stringify(value)));
        }),
      };
    }

    function statsRow(totalBookings: number) {
      return {
        totalBookings,
        completedRevenue: 0,
        soldCount: 0,
        pendingPaymentCount: 0,
        paymentProcessingCount: 0,
        failedCount: 0,
        cancelProcessingCount: 0,
        cancelledCount: 0,
        partialCancelledCount: 0,
      };
    }

    it.each(ADMIN_FUNNEL_STATUSES)(
      'renders list, stats and tier SQL for funnel status %s with every referenced table in FROM/JOIN',
      async (funnelStatus) => {
        const captured: CapturedQuery[] = [];
        const sqlService = new AdminBookingService(
          createSqlCapturingDb(captured) as never,
          mockBookingGateway as never,
          mockRefundService as never,
          mockAdminAuditService,
        );

        await sqlService.getBookings({
          funnelStatus,
          showtimeId: '11111111-1111-4111-8111-000000000302',
          search: 'buyer',
        });

        const selects = captured.filter((query) => /^\s*select/i.test(query.text));
        expect(selects.length).toBeGreaterThanOrEqual(3);
        for (const query of selects) {
          expect(tablesReferencedWithoutFrom(query.text)).toEqual([]);
        }
      },
    );

    it('runs list and aggregate reads in a read-only transaction with a statement timeout', async () => {
      const captured: CapturedQuery[] = [];
      const sqlService = new AdminBookingService(
        createSqlCapturingDb(captured) as never,
        mockBookingGateway as never,
        mockRefundService as never,
        mockAdminAuditService,
      );

      await sqlService.getBookings({});

      const statements = captured.map((query) => query.text.trim().toLowerCase());
      expect(statements[0]).toBe('begin read only');
      expect(statements[1]).toBe(`set local statement_timeout = ${ADMIN_BOOKING_QUERY_TIMEOUT_MS}`);
      expect(statements.slice(2).every((statement) => statement.startsWith('select') || statement === 'commit')).toBe(true);
      expect(statements.at(-1)).toBe('commit');
    });

    it('turns a statement timeout into an actionable 503 instead of holding the primary', async () => {
      const timeout = Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
      });
      mockDb.select.mockReturnValueOnce({
        from: () => { throw Object.assign(new Error('Failed query'), { cause: timeout }); },
      } as never);

      await expect(service.getBookings({})).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.getBookings({})).resolves.toBeDefined();
    });

    it('reuses cached stats and tier stats across pages of the same filter instead of re-aggregating', async () => {
      const cache = createMockCache();
      const cachedService = new AdminBookingService(
        mockDb as never,
        mockBookingGateway as never,
        mockRefundService as never,
        mockAdminAuditService,
        cache as never,
      );
      const filters = { performanceId: '11111111-1111-4111-8111-000000000301', funnelStatus: 'SOLD' };

      mockDb.select
        .mockReturnValueOnce(createChainMock([statsRow(41)]))
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([{
          tierName: 'VIP',
          price: 79000,
          soldSeats: 3,
          activeRevenue: 237000,
          cancelProcessingSeats: 0,
          cancelledSeats: 0,
          enteredSeats: 0,
        }]));
      const first = await cachedService.getBookings({ ...filters, page: 1 });

      expect(mockDb.select).toHaveBeenCalledTimes(3);
      expect(cache.set).toHaveBeenCalledTimes(1);
      const [cacheKey, , ttl] = cache.set.mock.calls[0]!;
      expect(ttl).toBe(ADMIN_BOOKING_AGGREGATE_CACHE_TTL_SECONDS);
      expect(cacheKey).toMatch(/^cache:admin:bookings:aggregates:v1:[0-9a-f]{64}$/);
      expect(cacheKey).not.toContain('11111111');

      mockDb.select.mockClear();
      mockDb.select.mockReturnValueOnce(createChainMock([]));
      const second = await cachedService.getBookings({ ...filters, page: 2 });

      // Only the page query ran; stats and tier aggregates came from cache.
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(second.total).toBe(41);
      expect(second.stats).toEqual(first.stats);
      expect(second.tierStats).toEqual(first.tierStats);
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('keys aggregates by every filter so a different filter recomputes them', async () => {
      const cache = createMockCache();
      const cachedService = new AdminBookingService(
        mockDb as never,
        mockBookingGateway as never,
        mockRefundService as never,
        mockAdminAuditService,
        cache as never,
      );

      mockDb.select.mockReturnValueOnce(createChainMock([statsRow(5)]));
      await cachedService.getBookings({ funnelStatus: 'SOLD' });
      mockDb.select.mockReturnValueOnce(createChainMock([statsRow(7)]));
      const other = await cachedService.getBookings({ funnelStatus: 'CANCELLED' });
      mockDb.select.mockReturnValueOnce(createChainMock([statsRow(9)]));
      const searched = await cachedService.getBookings({ funnelStatus: 'SOLD', search: 'buyer' });

      expect(other.total).toBe(7);
      expect(searched.total).toBe(9);
      expect(new Set(cache.set.mock.calls.map(([key]) => key)).size).toBe(3);
    });

    it('ignores a malformed cache entry and recomputes the aggregates', async () => {
      const cache = createMockCache();
      cache.get.mockResolvedValueOnce({ stats: null, tierStats: 'broken' });
      const cachedService = new AdminBookingService(
        mockDb as never,
        mockBookingGateway as never,
        mockRefundService as never,
        mockAdminAuditService,
        cache as never,
      );
      mockDb.select.mockReturnValueOnce(createChainMock([statsRow(3)]));

      const result = await cachedService.getBookings({});

      expect(result.total).toBe(3);
      expect(cache.set).toHaveBeenCalledTimes(1);
    });
  });
});
