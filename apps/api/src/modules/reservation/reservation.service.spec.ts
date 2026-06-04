import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ReservationService } from './reservation.service.js';
import { TossPaymentsClient } from '../payment/toss-payments.client.js';
import { BOOKING_VERIFICATION_REQUIRED_MESSAGE } from '../booking/booking.service.js';
import type { BookingService } from '../booking/booking.service.js';
import type { BookingGateway } from '../booking/booking.gateway.js';
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { TICKET_SERVICE_FEE_KRW, type ConsentCaptureItem, type SeatSelection } from '@grabit/shared';
import type { ConsentService } from '../consent/consent.service.js';
import type { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  payments,
  reservations,
  seatInventories,
  ticketItems,
  tickets,
} from '../../database/schema/index.js';

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

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn().mockResolvedValue(ticketLimitResult()),
    transaction: vi.fn(),
  };
}

function createMockTossClient() {
  return {
    confirmPayment: vi.fn().mockResolvedValue({
      paymentKey: 'pk_test_123',
      orderId: 'GRP-20260403-ABCDE',
      method: '카드',
      totalAmount: 150000,
      status: 'DONE',
      approvedAt: '2026-04-03T10:00:00+09:00',
    }),
    cancelPayment: vi.fn().mockImplementation((
      _paymentKey: string,
      reason: string,
      options?: { cancelAmount?: number; cancelRequestId?: string },
    ) => Promise.resolve({
      paymentKey: 'pk_test_123',
      orderId: 'GRP-20260403-ABCDE',
      method: '카드',
      totalAmount: 150000,
      status: 'CANCELED',
      approvedAt: '2026-04-03T10:00:00+09:00',
      cancels: [{
        cancelAmount: options?.cancelAmount ?? 150000,
        cancelReason: reason,
        canceledAt: '2026-04-03T11:00:00+09:00',
        cancelStatus: 'DONE',
        ...(options?.cancelRequestId ? { cancelRequestId: options.cancelRequestId } : {}),
      }],
    })),
    queryPayment: vi.fn().mockResolvedValue({
      paymentKey: 'pk_test_123',
      orderId: 'GRP-20260403-ABCDE',
      method: '카드',
      totalAmount: 150000,
      status: 'DONE',
      approvedAt: '2026-04-03T10:00:00+09:00',
      cancels: [],
    }),
  };
}

function createMockBookingService() {
  return {
    unlockAllSeats: vi.fn().mockResolvedValue({ unlockedSeats: [] }),
    assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    consumeOwnedSeatLocks: vi.fn().mockResolvedValue({ consumedSeatIds: [] }),
    extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
    refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
    releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockBookingGateway() {
  return {
    broadcastSeatUpdate: vi.fn(),
  };
}

function createMockFeatureFlags(bookingEnabled = true) {
  const mock = {
    getFlags: vi.fn(() => ({ bookingEnabled })),
    assertBookingEnabled: vi.fn((actor?: { id: string; role?: string }) => {
      if (!mock.getFlags().bookingEnabled && actor?.role !== 'admin') {
        throw new ForbiddenException('예매는 추후 오픈 예정입니다');
      }
    }),
  };
  return mock;
}

function makeConsentItems(
  overrides: Partial<Record<ConsentCaptureItem['key'], boolean>> = {},
): ConsentCaptureItem[] {
  return [
    'terms',
    'privacy',
    'pipa_required',
    'marketing',
  ].map((key) => ({
    key: key as ConsentCaptureItem['key'],
    version: '2026-05-01',
    language: 'ko',
    accepted: overrides[key as ConsentCaptureItem['key']] ?? true,
  }));
}

function createMockConsentService() {
  return {
    assertRequiredConsents: vi.fn().mockResolvedValue(undefined),
    captureConsent: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPaymentCancellationFinalizer() {
  return {
    finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
      releaseJobId: 'release-job-1',
      releaseEnqueued: true,
    }),
  };
}

describe('ReservationService', () => {
  let service: ReservationService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTossClient: ReturnType<typeof createMockTossClient>;
  let mockBookingService: ReturnType<typeof createMockBookingService>;
  let mockBookingGateway: ReturnType<typeof createMockBookingGateway>;
  let mockFeatureFlags: ReturnType<typeof createMockFeatureFlags>;
  let mockConsentService: ReturnType<typeof createMockConsentService>;
  let mockPaymentCancellationFinalizer: ReturnType<typeof createMockPaymentCancellationFinalizer>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockTossClient = createMockTossClient();
    mockBookingService = createMockBookingService();
    mockBookingGateway = createMockBookingGateway();
    mockFeatureFlags = createMockFeatureFlags(true);
    mockConsentService = createMockConsentService();
    mockPaymentCancellationFinalizer = createMockPaymentCancellationFinalizer();

    service = new ReservationService(
      mockDb as any,
      mockTossClient as unknown as TossPaymentsClient,
      mockBookingService as unknown as BookingService,
      mockBookingGateway as unknown as BookingGateway,
      mockFeatureFlags as unknown as FeatureFlagsService,
      mockConsentService as unknown as ConsentService,
      undefined,
      undefined,
      undefined,
      mockPaymentCancellationFinalizer as unknown as PaymentCancellationFinalizerService,
    );
  });

  function createServiceWithQrTicketService(qrTicketService: {
    ensureIssuedTicketForReservation?: ReturnType<typeof vi.fn>;
    ensureIssuedTicketsForReservation?: ReturnType<typeof vi.fn>;
    getOrIssueTicketForReservation?: ReturnType<typeof vi.fn>;
  }) {
    return new ReservationService(
      mockDb as any,
      mockTossClient as unknown as TossPaymentsClient,
      mockBookingService as unknown as BookingService,
      mockBookingGateway as unknown as BookingGateway,
      mockFeatureFlags as unknown as FeatureFlagsService,
      mockConsentService as unknown as ConsentService,
      qrTicketService as never,
      undefined,
      undefined,
      mockPaymentCancellationFinalizer as unknown as PaymentCancellationFinalizerService,
    );
  }

  const LOCK_EXPIRED_MESSAGE = '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.';
  const LOCK_OTHER_OWNER_MESSAGE = '이미 다른 사용자가 선택한 좌석입니다.';

  function seatSelection(seatId: string): SeatSelection {
    const [, number = '1'] = seatId.split('-');
    return { seatId, tierName: 'VIP', price: 50000, row: 'A', number };
  }

  function floorAwareSeatSelection(seatKey: string): SeatSelection & {
    floorKey: string;
    floorLabel: string;
    seatKey: string;
  } {
    const [floorKey, seatId] = seatKey.split(':');
    const [, number = '1'] = seatId?.split('-') ?? [];
    return {
      seatId: seatId ?? seatKey,
      tierName: 'VIP',
      price: 50000,
      row: 'A',
      number,
      floorKey: floorKey ?? '1F',
      floorLabel: floorKey === '2F' ? '2층' : '1층',
      seatKey,
    };
  }

  function makeQueueAdmission(baseTime: Date) {
    return {
      queueSessionId: 'queue-session-1',
      admissionToken: 'admission-token-1',
      refreshFamilyId: 'family-1',
      deviceSlotKey: 'device-slot-1',
      admittedAt: baseTime.toISOString(),
      activeUntilAt: new Date(baseTime.getTime() + 10 * 60 * 1000).toISOString(),
      reentryGraceUntilAt: new Date(baseTime.getTime() + 13 * 60 * 1000).toISOString(),
    };
  }

  function seatConfigRowsFor(seats: Array<string | SeatSelection>) {
    return [{
      seatConfig: {
        tiers: [{
          tierName: 'VIP',
          color: '#111111',
          seatIds: seats.map((seat) => (typeof seat === 'string' ? seat : seat.seatId)),
        }],
      },
    }];
  }

  function chainResult<T>(rows: T[]) {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: T[]) => void) => resolve(rows);
        }
        return (..._args: unknown[]) => new Proxy({}, handler);
      },
    };

    return new Proxy({}, handler);
  }

  function reservationSeatRowsForAmount(seats: string[], payableAmount: number) {
    const seatTotal = payableAmount - seats.length * TICKET_SERVICE_FEE_KRW;
    const basePrice = Math.floor(seatTotal / seats.length);

    return seats.map((seatId, index) => {
      const [, localSeatId = seatId] = seatId.includes(':') ? seatId.split(':') : [undefined, seatId];
      const [row = 'A', number = String(index + 1)] = localSeatId.split('-');
      return {
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        seatId,
        tierName: 'VIP',
        price: index === seats.length - 1 ? seatTotal - basePrice * (seats.length - 1) : basePrice,
        row,
        number,
      };
    });
  }

  function ticketItemRowsForReservation(args: {
    reservationId: string;
    paymentId?: string;
    showtimeId?: string;
    seats: string[];
    amount: number;
  }) {
    return reservationSeatRowsForAmount(args.seats, args.amount).map((seat, index) => {
      const floorSeat = seat.seatId.includes(':')
        ? floorAwareSeatSelection(seat.seatId)
        : floorAwareSeatSelection(`1F:${seat.seatId}`);

      return {
        id: `00000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`,
        reservationId: args.reservationId,
        paymentId: args.paymentId ?? 'payment-1',
        showtimeId: args.showtimeId ?? 'showtime-1',
        seatId: floorSeat.seatId,
        seatKey: floorSeat.seatKey,
        floorKey: floorSeat.floorKey,
        floorLabel: floorSeat.floorLabel,
        tierName: seat.tierName,
        row: seat.row,
        number: seat.number,
        price: seat.price,
        serviceFee: TICKET_SERVICE_FEE_KRW,
        status: 'active',
        admissionState: index === 1 ? 'entered' : 'not_entered',
        enteredAt: index === 1 ? new Date('2026-07-10T09:05:00.000Z') : null,
        cancelledAt: null,
        cancelReason: null,
        cancellationFee: 0,
        serviceFeeRefund: 0,
        refundableAmount: 0,
        reopenState: 'not_required',
        reopenHoldUntil: null,
        reopenJobId: null,
      };
    });
  }

  function sqlPredicateHasParamValue(predicate: unknown, value: string): boolean {
    const seen = new Set<unknown>();

    function walk(candidateValue: unknown): boolean {
      if (!candidateValue || typeof candidateValue !== 'object') {
        return candidateValue === value;
      }
      if (seen.has(candidateValue)) {
        return false;
      }
      seen.add(candidateValue);

      if (Array.isArray(candidateValue)) {
        return candidateValue.some((item) => walk(item));
      }

      const candidate = candidateValue as {
        constructor?: { name?: string };
        queryChunks?: unknown[];
        value?: unknown;
      };

      if (candidate.constructor?.name === 'Param') {
        return candidate.value === value;
      }
      if (Array.isArray(candidate.queryChunks)) {
        return candidate.queryChunks.some((chunk) => walk(chunk));
      }

      return Object.values(candidateValue).some((item) => walk(item));
    }

    return walk(predicate);
  }

  function setupPrepareBase(dto: {
    showtimeId: string;
    orderId: string;
    seats: SeatSelection[];
    amount: number;
    performanceStatus?: string;
    bookingStartsAt?: Date | null;
  }) {
    mockDb.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([{
        id: dto.showtimeId,
        performanceId: 'performance-1',
        performanceStatus: dto.performanceStatus ?? 'selling',
        bookingStartsAt: dto.bookingStartsAt ?? null,
        dateTime: new Date(),
        maxTicketsPerUser: 4,
        changePolicyEnabled: false,
        paymentWindowMinutes: 7,
        seatHoldMinutes: 10,
      }]))
      .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 50000 }]))
      .mockReturnValueOnce(chainResult(seatConfigRowsFor(dto.seats)))
      .mockReturnValueOnce(chainResult([{ birthDate: '1995-05-15' }]));

    mockDb.transaction.mockResolvedValue({
      id: 'reservation-created',
      tossOrderId: dto.orderId,
    });
  }

  function setupExistingPendingOrder(dto: {
    showtimeId: string;
    orderId: string;
    userId: string;
    amount?: number;
    status?: string;
    seats?: Array<string | SeatSelection>;
  }) {
    const seats = (dto.seats ?? ['A-1', 'A-2']).map((seat) => (
      typeof seat === 'string' ? seat : seat.seatId
    ));
    const amount = dto.amount ?? seats.length * 52000;
    const seatMapSeatIds = Array.from(new Set([...seats, 'A-1', 'A-2', 'A-3', 'B-1']));
    mockDb.select
      .mockReturnValueOnce(chainResult([{
        id: 'reservation-existing',
        userId: dto.userId,
        tossOrderId: dto.orderId,
        showtimeId: dto.showtimeId,
        status: dto.status ?? 'PENDING_PAYMENT',
        totalAmount: amount,
      }]))
      .mockReturnValueOnce(chainResult([{
        id: dto.showtimeId,
        performanceId: 'performance-1',
        performanceStatus: 'selling',
        dateTime: new Date(),
        maxTicketsPerUser: 4,
        changePolicyEnabled: false,
        paymentWindowMinutes: 7,
        seatHoldMinutes: 10,
      }]))
      .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 50000 }]))
      .mockReturnValueOnce(chainResult(seatConfigRowsFor(seatMapSeatIds)))
      .mockReturnValueOnce(chainResult(seats.map((seatId) => ({
        seatId,
        tierName: 'VIP',
        price: 50000,
        row: seatId.split('-')[0] ?? 'A',
        number: seatId.split('-')[1] ?? '1',
      }))));
  }

  function setupConfirmReservationBase(args: {
    reservationId: string;
    showtimeId: string;
    orderId: string;
    userId: string;
    amount: number;
    seats?: string[];
  }) {
    const seats = args.seats ?? ['A-1', 'A-2'];
    mockDb.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([{
        id: args.reservationId,
        userId: args.userId,
        showtimeId: args.showtimeId,
        tossOrderId: args.orderId,
        status: 'PENDING_PAYMENT',
        totalAmount: args.amount,
      }]))
      .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(seats, args.amount)));
  }

  function setupReservationDetailMocks(args: {
    reservationId: string;
    userId: string;
    amount: number;
    status?: string;
    paymentStatus?: string;
    seats?: string[];
    ticketItems?: Array<Record<string, unknown>>;
    userEmail?: string;
    isEmailVerified?: boolean;
  }) {
    const seats = args.seats ?? ['A-1', 'A-2'];
    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{
                  reservation: {
                    id: args.reservationId,
                    userId: args.userId,
                    reservationNumber: 'GRP-20260429-LOCKS',
                    status: args.status ?? 'CONFIRMED',
                    totalAmount: args.amount,
                    showtimeId: 'showtime-1',
                    cancelDeadline: new Date(),
                    cancelledAt: null,
                    cancelReason: null,
                    createdAt: new Date(),
                  },
                  showtime: { dateTime: new Date() },
                  performance: { title: '락 테스트 공연', posterUrl: null },
                  venue: { name: '락 테스트 극장' },
                }]),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce(chainResult(seats.map((seatId) => ({
        seatId,
        tierName: 'VIP',
        price: 50000,
        row: 'A',
        number: seatId.split('-')[1] ?? '1',
      }))))
      .mockReturnValueOnce(chainResult([{
        paymentKey: 'pk_test_123',
        method: '카드',
        id: 'payment-1',
        status: args.paymentStatus ?? 'DONE',
        paidAt: new Date(),
      }]))
      .mockReturnValueOnce(chainResult(args.ticketItems ?? ticketItemRowsForReservation({
        reservationId: args.reservationId,
        seats,
        amount: args.amount,
      })))
      .mockReturnValueOnce(chainResult([{
        email: args.userEmail ?? 'buyer@example.com',
        isEmailVerified: args.isEmailVerified ?? true,
      }]));
  }

  function setupTicketItemCancelTransaction(args: {
    reservationId: string;
    userId: string;
    ticketItemId: string;
    paymentId?: string;
    paymentKey?: string;
    paymentMethod?: string;
    paymentProvider?: string;
    paymentCurrency?: string;
    paymentAmount?: number;
    providerMetadata?: unknown;
    providerChargeCurrency?: string | null;
    providerChargeAmountMinor?: number | null;
    reservationNumber?: string;
    cancelledSeatHoldMinMinutes?: number | null;
    cancelledSeatHoldMaxMinutes?: number | null;
    showtimeId?: string;
    reservationStatus?: string;
    paymentStatus?: string;
    ticketItemStatus?: string;
    admissionState?: string;
    reservationCreatedAt?: Date;
    showtimeAt?: Date;
    seatId?: string;
    seatKey?: string;
    floorKey?: string;
    price?: number;
    serviceFee?: number;
    cancelledAt?: Date | null;
    cancelReason?: string | null;
    cancellationFee?: number;
    serviceFeeRefund?: number;
    refundableAmount?: number;
    activeRemainingRows?: Array<{
      id: string;
      refundableAmount?: number;
      seatId?: string;
      floorKey?: string;
      seatKey?: string;
    }>;
    reservationSeatRows?: Array<{ seat_id: string }>;
  }) {
    const row = {
      reservation_id: args.reservationId,
      user_id: args.userId,
      showtime_id: args.showtimeId ?? 'showtime-1',
      reservation_number: args.reservationNumber ?? 'GRP-20260508-ITEMS',
      reservation_status: args.reservationStatus ?? 'CONFIRMED',
      reservation_created_at: args.reservationCreatedAt ?? new Date('2026-05-08T01:00:00.000Z'),
      showtime_at: args.showtimeAt ?? new Date('2026-06-30T10:00:00.000Z'),
      payment_id: args.paymentId ?? 'payment-1',
      payment_key: args.paymentKey ?? 'pk_ticket_item_cancel',
      payment_method: args.paymentMethod ?? 'CARD',
      payment_provider: args.paymentProvider ?? 'CARD',
      payment_currency: args.paymentCurrency ?? 'KRW',
      payment_amount: args.paymentAmount ?? 150000,
      provider_metadata: args.providerMetadata ?? null,
      provider_charge_currency: args.providerChargeCurrency ?? null,
      provider_charge_amount_minor: args.providerChargeAmountMinor ?? null,
      payment_status: args.paymentStatus ?? 'DONE',
      cancelled_seat_hold_min_minutes: args.cancelledSeatHoldMinMinutes ?? 1,
      cancelled_seat_hold_max_minutes: args.cancelledSeatHoldMaxMinutes ?? 10,
      ticket_item_id: args.ticketItemId,
      ticket_item_status: args.ticketItemStatus ?? 'active',
      admission_state: args.admissionState ?? 'not_entered',
      seat_id: args.seatId ?? 'A-1',
      seat_key: args.seatKey ?? '1F:A-1',
      floor_key: args.floorKey ?? '1F',
      price: args.price ?? 77000,
      service_fee: args.serviceFee ?? TICKET_SERVICE_FEE_KRW,
      cancelled_at: args.cancelledAt ?? null,
      cancel_reason: args.cancelReason ?? null,
      cancellation_fee: args.cancellationFee ?? 0,
      service_fee_refund: args.serviceFeeRefund ?? 0,
      refundable_amount: args.refundableAmount ?? 0,
    };
    const activeTicketItemRows = [
      {
        id: args.ticketItemId,
        refundable_amount: args.refundableAmount ?? 0,
        seat_id: args.seatId ?? 'A-1',
        seat_key: args.seatKey ?? '1F:A-1',
        floor_key: args.floorKey ?? '1F',
      },
      ...(args.activeRemainingRows ?? [{ id: 'ticket-item-sibling' }]).map((item, index) => ({
        id: item.id,
        refundable_amount: item.refundableAmount ?? 0,
        seat_id: item.seatId ?? `A-${index + 2}`,
        floor_key: item.floorKey ?? '1F',
        seat_key: item.seatKey ?? `1F:A-${index + 2}`,
      })),
    ];
    const reservationSeatRows = args.reservationSeatRows ?? [
      { seat_id: 'A-1' },
      ...((args.activeRemainingRows ?? [{ id: 'ticket-item-sibling' }]).map((_, index) => ({
        seat_id: `A-${index + 2}`,
      }))),
    ];
    const updateCalls: Array<{
      table: unknown;
      values: Record<string, unknown>;
      predicate?: unknown;
    }> = [];
    const selectWhereCalls: unknown[] = [];
    const operationCalls: Array<
      | {
        type: 'select';
        predicate: unknown;
      }
      | {
        type: 'update';
        table: unknown;
        values: Record<string, unknown>;
      }
    > = [];
    const transactionCommitted = vi.fn();
    const selectChain = (() => {
      const rows = args.activeRemainingRows ?? [{ id: 'ticket-item-sibling' }];
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (value: Array<{ id: string }>) => void) => resolve(rows);
          }
          if (prop === 'where') {
            return (predicate: unknown) => {
              selectWhereCalls.push(predicate);
              operationCalls.push({ type: 'select', predicate });
              return Promise.resolve(rows);
            };
          }
          return (..._args: unknown[]) => new Proxy({}, handler);
        },
      };

      return new Proxy({}, handler);
    })();
    const mockTx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: activeTicketItemRows })
        .mockResolvedValueOnce({ rows: reservationSeatRows }),
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          const call = { table, values } as {
            table: unknown;
            values: Record<string, unknown>;
            predicate?: unknown;
          };
          updateCalls.push(call);
          operationCalls.push({ type: 'update', table, values });
          return {
            where: vi.fn((predicate: unknown) => {
              call.predicate = predicate;
              return Promise.resolve([]);
            }),
          };
        }),
      })),
    };

    mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
      const result = await cb(mockTx);
      transactionCommitted();
      return result;
    });

    return { row, mockTx, updateCalls, selectWhereCalls, operationCalls, transactionCommitted };
  }

  function mockTxWhereHasLegacySeatFallback(updateCalls: Array<{
    table: unknown;
    values: Record<string, unknown>;
    predicate?: unknown;
  }>): boolean {
    const seatInventoryUpdate = updateCalls.find((call) => call.table === seatInventories);
    return Boolean(
      seatInventoryUpdate?.predicate &&
      sqlPredicateHasParamValue(seatInventoryUpdate.predicate, '1F:A-1') &&
      sqlPredicateHasParamValue(seatInventoryUpdate.predicate, 'A-1'),
    );
  }

  function mockRootUpdateChain() {
    const where = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where });
    mockDb.update.mockReturnValue({ set });
    return { set, where };
  }

  describe('reservation number', () => {
    it('does not expose API-side payment request creation while booking disabled', () => {
      const clientMethods = Object.getOwnPropertyNames(TossPaymentsClient.prototype);
      const serviceMethods = Object.getOwnPropertyNames(ReservationService.prototype);

      expect(clientMethods).toContain('confirmPayment');
      expect(clientMethods).not.toEqual(expect.arrayContaining([
        'requestPayment',
        'createPayment',
        'paymentRequest',
      ]));
      expect(serviceMethods).not.toEqual(expect.arrayContaining([
        'requestPayment',
        'createPayment',
        'paymentRequest',
      ]));
    });

    it('should generate reservation number matching GRP-YYYYMMDD-XXXXX format', () => {
      const result = service.generateReservationNumber();
      expect(result).toMatch(/^GRP-\d{8}-[A-Z0-9]{5}$/);
    });
  });

  describe('amount calculation', () => {
    it('should sum prices from price_tiers for given seat selections', async () => {
      const performanceId = randomUUID();
      const seats: SeatSelection[] = [
        { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        { seatId: 'A-2', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
        { seatId: 'B-1', tierName: 'R', price: 80000, row: 'B', number: '1' },
      ];

      // Mock: priceTiers query returns VIP=100000, R=80000
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([
              { id: randomUUID(), performanceId, tierName: 'VIP', price: 100000, sortOrder: 0 },
              { id: randomUUID(), performanceId, tierName: 'R', price: 80000, sortOrder: 1 },
            ])
            .mockResolvedValueOnce([{
              seatConfig: {
                tiers: [
                  { tierName: 'VIP', color: '#111111', seatIds: ['A-1', 'A-2'] },
                  { tierName: 'R', color: '#222222', seatIds: ['B-1'] },
                ],
              },
            }]),
        }),
      });

      const result = await service.calculateTotalAmount(seats, performanceId);
      expect(result).toBe(286000); // 100000 + 100000 + 80000 + 3 service fees
    });

    it('should derive tier and price from seat map config when available', async () => {
      const performanceId = randomUUID();
      const seats: SeatSelection[] = [
        { seatId: 'A-1', tierName: 'R', price: 1, row: 'X', number: '999' },
        { seatId: 'B-1', tierName: 'VIP', price: 1, row: 'Y', number: '999' },
      ];

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([
              { id: randomUUID(), performanceId, tierName: 'VIP', price: 100000, sortOrder: 0 },
              { id: randomUUID(), performanceId, tierName: 'R', price: 80000, sortOrder: 1 },
            ])
            .mockResolvedValueOnce([{
              seatConfig: {
                tiers: [
                  { tierName: 'VIP', color: '#111111', seatIds: ['A-1'] },
                  { tierName: 'R', color: '#222222', seatIds: ['B-1'] },
                ],
              },
            }]),
        }),
      });

      await expect(service.calculateTotalAmount(seats, performanceId))
        .resolves
        .toBe(184000);
    });

    it('uses performance seat assignment overlay before legacy seat map config when present', async () => {
      const performanceId = randomUUID();
      const seats: SeatSelection[] = [
        { seatId: 'A-1', tierName: 'R', price: 1, row: 'client', number: '999' },
      ];

      mockDb.select
        .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 50000 }]))
        .mockReturnValueOnce(chainResult([{
          floorKey: '1F',
          floorLabel: '1층',
          venueLayoutId: 'layout-1',
          seatConfig: {
            tiers: [{ tierName: 'VIP', color: '#111111', seatIds: ['A-1'] }],
          },
        }]))
        .mockReturnValueOnce(chainResult([{
          assignmentId: 'assignment-1',
          saleStatus: 'available',
          layoutSeatId: 'layout-seat-1',
          seatKey: '1F:A-1',
          sourceSeatId: 'A-1',
          rowLabel: 'A',
          seatNumber: '1',
          floorKey: '1F',
          floorLabel: '1층',
          tierName: 'VIP',
          price: 123000,
        }]));

      await expect(service.calculateTotalAmount(seats, performanceId))
        .resolves
        .toBe(125000);
    });

    it('should throw BadRequestException for invalid tier ID', async () => {
      const performanceId = randomUUID();
      const seats: SeatSelection[] = [
        { seatId: 'A-1', tierName: 'NONEXISTENT', price: 100000, row: 'A', number: '1' },
      ];

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([
              { id: randomUUID(), performanceId, tierName: 'VIP', price: 100000, sortOrder: 0 },
            ])
            .mockResolvedValueOnce([{
              seatConfig: {
                tiers: [
                  { tierName: 'NONEXISTENT', color: '#111111', seatIds: ['A-1'] },
                ],
              },
            }]),
        }),
      });

      await expect(service.calculateTotalAmount(seats, performanceId))
        .rejects.toThrow(BadRequestException);
    });

    it.each([
      ['missing', []],
      ['null config', [{ seatConfig: null }]],
      ['malformed tiers', [{ seatConfig: { tiers: 'VIP' } }]],
      ['empty tiers', [{ seatConfig: { tiers: [] } }]],
    ])('should fail closed when seat map config is %s', async (_caseName, seatMapRows) => {
      const performanceId = randomUUID();
      const seats: SeatSelection[] = [
        { seatId: 'A-1', tierName: 'VIP', price: 1, row: 'client', number: '999' },
      ];

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([
              { id: randomUUID(), performanceId, tierName: 'VIP', price: 100000, sortOrder: 0 },
            ])
            .mockResolvedValueOnce(seatMapRows),
        }),
      });

      await expect(service.calculateTotalAmount(seats, performanceId))
        .rejects
        .toThrow('좌석 배치 정보가 유효하지 않습니다');
    });

    it('should throw BadRequestException for duplicate seat IDs', async () => {
      const performanceId = randomUUID();
      const seats: SeatSelection[] = [
        { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
      ];

      await expect(service.calculateTotalAmount(seats, performanceId))
        .rejects
        .toThrow('중복된 좌석이 포함되어 있습니다');
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('prepareReservation - lock ownership', () => {
    it('prepareReservation rejects disabled booking before DB transaction', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-DISABLED-PREPARE',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems(),
      };
      mockFeatureFlags.getFlags.mockReturnValue({ bookingEnabled: false });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow(ForbiddenException);
      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('예매는 추후 오픈 예정입니다');

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockConsentService.assertRequiredConsents).not.toHaveBeenCalled();
    });

    it('prepareReservation lets admin actor bypass disabled booking flag and reach consent validation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-ADMIN-PREPARE-BYPASS',
        seats: [seatSelection('A-1')],
        amount: 50000,
      };
      mockFeatureFlags.getFlags.mockReturnValue({ bookingEnabled: false });

      await expect(service.prepareReservation(
        dto,
        { id: userId, role: 'admin', isEmailVerified: true, isPhoneVerified: true },
      ))
        .rejects
        .toThrow('예매 동의 항목이 필요합니다');

      expect(mockFeatureFlags.assertBookingEnabled).toHaveBeenCalledWith({
        id: userId,
        role: 'admin',
        isEmailVerified: true,
        isPhoneVerified: true,
      });
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects unverified actors before consent, seat, or reservation writes', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-VERIFY-PREPARE',
        seats: [seatSelection('A-1')],
        amount: 50000,
      };

      await expect(service.prepareReservation(
        dto,
        { id: userId, isEmailVerified: false, isPhoneVerified: true },
      ))
        .rejects
        .toThrow(BOOKING_VERIFICATION_REQUIRED_MESSAGE);

      await expect(service.prepareReservation(
        dto,
        { id: userId, isEmailVerified: true, isPhoneVerified: false },
      ))
        .rejects
        .toThrow(BOOKING_VERIFICATION_REQUIRED_MESSAGE);

      expect(mockConsentService.assertRequiredConsents).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects refused required booking consent before DB transaction', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-CONSENT-REFUSED',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems({ privacy: false }),
      };
      mockConsentService.assertRequiredConsents.mockRejectedValue(
        new BadRequestException('privacy consent is required'),
      );
      setupPrepareBase(dto);

      await expect(service.prepareReservation(dto, userId)).rejects.toThrow(
        'privacy consent is required',
      );

      expect(mockFeatureFlags.assertBookingEnabled).toHaveBeenCalled();
      expect(mockConsentService.assertRequiredConsents).toHaveBeenCalledWith({
        items: dto.consentItems,
      });
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects omitted booking consent before DB transaction', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-CONSENT-MISSING',
        seats: [seatSelection('A-1')],
        amount: 50000,
      };

      await expect(service.prepareReservation(dto, userId)).rejects.toThrow(
        '예매 동의 항목이 필요합니다',
      );

      expect(mockFeatureFlags.assertBookingEnabled).toHaveBeenCalled();
      expect(mockConsentService.assertRequiredConsents).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects duplicate seat IDs before reading database state', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-DUPLICATE-SEATS',
        seats: [seatSelection('A-1'), seatSelection('A-1')],
        amount: 104000,
        consentItems: makeConsentItems(),
      };

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('중복된 좌석이 포함되어 있습니다');

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects public upcoming performances before lock validation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-UPCOMING-PREPARE',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems(),
        performanceStatus: 'upcoming',
      };
      setupPrepareBase(dto);

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('예매는 추후 오픈 예정입니다');

      expect(mockConsentService.assertRequiredConsents).toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects public users before a scheduled booking start', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T09:59:59.000Z'));
      try {
        const userId = randomUUID();
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-SCHEDULED-PREPARE-BEFORE',
          seats: [seatSelection('A-1')],
          amount: 52000,
          consentItems: makeConsentItems(),
          performanceStatus: 'selling',
          bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
        };
        setupPrepareBase(dto);

        await expect(service.prepareReservation(dto, userId))
          .rejects
          .toThrow('예매는 추후 오픈 예정입니다');

        expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
        expect(mockDb.transaction).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation allows public users after a scheduled booking start while stored status is upcoming', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
      try {
        const userId = randomUUID();
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-SCHEDULED-PREPARE-AFTER',
          seats: [seatSelection('A-1')],
          amount: 52000,
          consentItems: makeConsentItems(),
          performanceStatus: 'upcoming',
          bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
        };
        setupPrepareBase(dto);

        await expect(service.prepareReservation(dto, userId))
          .resolves
          .toEqual(expect.objectContaining({
            reservationId: 'reservation-created',
            orderId: dto.orderId,
          }));

        expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalled();
        expect(mockDb.transaction).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation rejects ended performances before lock validation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-ENDED-PREPARE',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems(),
        performanceStatus: 'ended',
      };
      setupPrepareBase(dto);

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('판매가 종료된 공연입니다');

      expect(mockConsentService.assertRequiredConsents).toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation checks active locks before creating a new pending reservation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-LOCK-PREPARE-SUCCESS',
        seats: [seatSelection('A-1'), seatSelection('A-2')],
        amount: 104000,
        consentItems: makeConsentItems(),
      };
      setupPrepareBase(dto);

      await expect(service.prepareReservation(dto, userId))
        .resolves
        .toEqual(expect.objectContaining({
          reservationId: 'reservation-created',
          orderId: dto.orderId,
        }));

      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, dto.showtimeId, ['1F:A-1', '1F:A-2']);
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(mockBookingService.assertOwnedSeatLocks.mock.invocationCallOrder[0])
        .toBeLessThan(mockDb.transaction.mock.invocationCallOrder[0]!);
    });

    it('prepareReservation accepts amount including 2,000 KRW service fee per seat', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-SERVICE-FEE-PREPARE-SUCCESS',
        seats: [
          { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: 'A-2', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
        ],
        amount: 204000,
        consentItems: makeConsentItems(),
      };

      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{
          id: dto.showtimeId,
          performanceId: 'performance-1',
          performanceStatus: 'selling',
          dateTime: new Date(),
          maxTicketsPerUser: 4,
          changePolicyEnabled: false,
          paymentWindowMinutes: 7,
          seatHoldMinutes: 10,
        }]))
        .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 100000 }]))
        .mockReturnValueOnce(chainResult(seatConfigRowsFor(dto.seats)))
        .mockReturnValueOnce(chainResult([{ birthDate: '1995-05-15' }]));
      mockDb.transaction.mockResolvedValue({
        id: 'reservation-created',
        tossOrderId: dto.orderId,
      });

      await expect(service.prepareReservation(dto, userId))
        .resolves
        .toEqual(expect.objectContaining({
          reservationId: 'reservation-created',
          orderId: dto.orderId,
        }));
    });

    it('prepareReservation rejects seat-only amount when service fee is omitted', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-SERVICE-FEE-PREPARE-REJECT',
        seats: [
          { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: 'A-2', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
        ],
        amount: 200000,
        consentItems: makeConsentItems(),
      };

      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{
          id: dto.showtimeId,
          performanceId: 'performance-1',
          performanceStatus: 'selling',
          dateTime: new Date(),
          maxTicketsPerUser: 4,
          changePolicyEnabled: false,
          paymentWindowMinutes: 7,
          seatHoldMinutes: 10,
        }]))
        .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 100000 }]))
        .mockReturnValueOnce(chainResult(seatConfigRowsFor(dto.seats)))
        .mockReturnValueOnce(chainResult([{ birthDate: '1995-05-15' }]));
      mockDb.transaction.mockResolvedValue({
        id: 'reservation-created',
        tossOrderId: dto.orderId,
      });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('금액이 일치하지 않습니다');
    });

    it('prepareReservation stores server-side paymentDeadlineAt plus admission recovery timestamps', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-08T07:00:00.000Z');
      vi.setSystemTime(now);

      try {
        const userId = randomUUID();
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-SERVER-DEADLINE',
          seats: [floorAwareSeatSelection('1F:A-1')],
          amount: 52000,
          consentItems: makeConsentItems(),
          queueAdmission: makeQueueAdmission(now),
          paymentDeadlineAt: '2099-01-01T00:00:00.000Z',
          bookingPolicy: {
            maxTicketsPerOrder: 1,
            cancellationChangePolicy: 'CANCEL_ONLY' as const,
            sameGradeChangeEnabled: false,
            paymentWindowMinutes: 10,
            seatHoldMinutes: 10,
          },
          paymentMethod: {
            method: 'CARD' as const,
            provider: 'CARD' as const,
            currency: 'KRW',
          },
        };

        const insertedValues: unknown[] = [];
        setupPrepareBase(dto);

        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((values: unknown) => {
              insertedValues.push(values);
              return {
                returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
              };
            }),
          }),
        };
        mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

        const result = await service.prepareReservation(dto, userId);
        const expectedDeadlineAt = new Date(now.getTime() + 7 * 60 * 1000).toISOString();

        expect(result.paymentDeadlineAt).toBe(expectedDeadlineAt);
        expect(insertedValues[0]).toEqual(expect.objectContaining({
          queueSessionId: dto.queueAdmission.queueSessionId,
          admissionToken: dto.queueAdmission.admissionToken,
          refreshFamilyId: dto.queueAdmission.refreshFamilyId,
          deviceSlotKey: dto.queueAdmission.deviceSlotKey,
          admittedAt: new Date(dto.queueAdmission.admittedAt),
          admissionActiveUntilAt: new Date(dto.queueAdmission.activeUntilAt),
          reentryGraceUntilAt: new Date(dto.queueAdmission.reentryGraceUntilAt),
          paymentDeadlineAt: new Date(expectedDeadlineAt),
        }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation stores and returns a PayPal provider charge quote when checkout is enabled', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-29T10:00:00.000Z');
      vi.setSystemTime(now);

      try {
        const userId = randomUUID();
        const providerChargeQuoteService = {
          getPaypalAvailability: vi.fn().mockReturnValue({ enabled: true }),
          createPaypalQuote: vi.fn().mockReturnValue({
            currency: 'USD',
            amountMinor: 7490,
            amountDecimal: '74.90',
            rate: '0.00072',
            quotedAt: now.toISOString(),
          }),
        };
        const paypalService = new ReservationService(
          mockDb as never,
          mockTossClient as unknown as TossPaymentsClient,
          mockBookingService as unknown as BookingService,
          mockBookingGateway as unknown as BookingGateway,
          mockFeatureFlags as unknown as FeatureFlagsService,
          mockConsentService as unknown as ConsentService,
          undefined,
          undefined,
          providerChargeQuoteService as never,
        );
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-PAYPAL-PREPARE',
          seats: [
            { seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' },
            { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
          ],
          amount: 104000,
          consentItems: makeConsentItems(),
          queueAdmission: makeQueueAdmission(now),
          paymentDeadlineAt: now.toISOString(),
          bookingPolicy: {
            maxTicketsPerOrder: 2,
            cancellationChangePolicy: 'CANCEL_ONLY' as const,
            sameGradeChangeEnabled: false,
            paymentWindowMinutes: 7,
            seatHoldMinutes: 10,
          },
          paymentMethod: {
            method: 'FOREIGN_EASY_PAY' as const,
            provider: 'PAYPAL' as const,
            currency: 'USD',
          },
        };
        const insertedValues: unknown[] = [];
        setupPrepareBase(dto);
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((values: unknown) => {
              insertedValues.push(values);
              return {
                returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
              };
            }),
          }),
        };
        mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

        const result = await paypalService.prepareReservation(dto, userId);

        expect(providerChargeQuoteService.createPaypalQuote).toHaveBeenCalledWith({
          reservationPayableAmount: 104000,
          now,
        });
        expect(insertedValues[0]).toEqual(expect.objectContaining({
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 7490,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: now,
        }));
        expect(result).toEqual(expect.objectContaining({
          checkoutEnabled: true,
          providerChargeQuote: {
            currency: 'USD',
            amountMinor: 7490,
            amountDecimal: '74.90',
            rate: '0.00072',
            quotedAt: now.toISOString(),
          },
        }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation does not create a provider charge quote for overseas card', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-29T10:00:00.000Z');
      vi.setSystemTime(now);

      try {
        const userId = randomUUID();
        const providerChargeQuoteService = {
          getPaypalAvailability: vi.fn().mockReturnValue({ enabled: true }),
          createPaypalQuote: vi.fn().mockReturnValue({
            currency: 'USD',
            amountMinor: 7490,
            amountDecimal: '74.90',
            rate: '0.00072',
            quotedAt: now.toISOString(),
          }),
        };
        const overseasCardService = new ReservationService(
          mockDb as never,
          mockTossClient as unknown as TossPaymentsClient,
          mockBookingService as unknown as BookingService,
          mockBookingGateway as unknown as BookingGateway,
          mockFeatureFlags as unknown as FeatureFlagsService,
          mockConsentService as unknown as ConsentService,
          undefined,
          undefined,
          providerChargeQuoteService as never,
        );
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-OVERSEAS-CARD-PREPARE',
          seats: [
            { seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' },
            { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
          ],
          amount: 104000,
          consentItems: makeConsentItems(),
          queueAdmission: makeQueueAdmission(now),
          paymentDeadlineAt: now.toISOString(),
          bookingPolicy: {
            maxTicketsPerOrder: 2,
            cancellationChangePolicy: 'CANCEL_ONLY' as const,
            sameGradeChangeEnabled: false,
            paymentWindowMinutes: 7,
            seatHoldMinutes: 10,
          },
          paymentMethod: {
            method: 'CARD' as const,
            provider: 'CARD' as const,
            currency: 'KRW',
            overseasPaymentConsent: {
              required: true,
              agreed: true,
              agreedAt: now.toISOString(),
            },
          },
        };
        const insertedValues: unknown[] = [];
        setupPrepareBase(dto);
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((values: unknown) => {
              insertedValues.push(values);
              return {
                returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
              };
            }),
          }),
        };
        mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

        const result = await overseasCardService.prepareReservation(dto, userId);

        expect(providerChargeQuoteService.getPaypalAvailability).not.toHaveBeenCalled();
        expect(providerChargeQuoteService.createPaypalQuote).not.toHaveBeenCalled();
        expect(insertedValues[0]).toEqual(expect.not.objectContaining({
          providerChargeCurrency: expect.anything(),
          providerChargeAmountMinor: expect.anything(),
          providerChargeRate: expect.anything(),
          providerChargeQuotedAt: expect.anything(),
        }));
        expect(result).toEqual(expect.not.objectContaining({
          checkoutEnabled: expect.anything(),
          providerChargeQuote: expect.anything(),
        }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation stores and returns an Alipay provider charge quote when checkout is enabled', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-29T10:00:00.000Z');
      vi.setSystemTime(now);

      try {
        const userId = randomUUID();
        const providerChargeQuoteService = {
          getForeignEasyPayAvailability: vi.fn().mockReturnValue({ enabled: true }),
          createForeignEasyPayQuote: vi.fn().mockReturnValue({
            currency: 'USD',
            amountMinor: 7490,
            amountDecimal: '74.90',
            rate: '0.00072',
            quotedAt: now.toISOString(),
          }),
        };
        const alipayService = new ReservationService(
          mockDb as never,
          mockTossClient as unknown as TossPaymentsClient,
          mockBookingService as unknown as BookingService,
          mockBookingGateway as unknown as BookingGateway,
          mockFeatureFlags as unknown as FeatureFlagsService,
          mockConsentService as unknown as ConsentService,
          undefined,
          undefined,
          providerChargeQuoteService as never,
        );
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-ALIPAY-PREPARE',
          seats: [
            { seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' },
            { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
          ],
          amount: 104000,
          consentItems: makeConsentItems(),
          queueAdmission: makeQueueAdmission(now),
          paymentDeadlineAt: now.toISOString(),
          bookingPolicy: {
            maxTicketsPerOrder: 2,
            cancellationChangePolicy: 'CANCEL_ONLY' as const,
            sameGradeChangeEnabled: false,
            paymentWindowMinutes: 7,
            seatHoldMinutes: 10,
          },
          paymentMethod: {
            method: 'FOREIGN_EASY_PAY' as const,
            provider: 'ALIPAY_PLUS' as const,
            currency: 'USD',
            pendingUrlRequired: true,
          },
        };
        const insertedValues: unknown[] = [];
        setupPrepareBase(dto);
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((values: unknown) => {
              insertedValues.push(values);
              return {
                returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
              };
            }),
          }),
        };
        mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

        const result = await alipayService.prepareReservation(dto, userId);

        expect(providerChargeQuoteService.createForeignEasyPayQuote).toHaveBeenCalledWith({
          reservationPayableAmount: 104000,
          now,
        });
        expect(insertedValues[0]).toEqual(expect.objectContaining({
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 7490,
          providerChargeRate: '0.00072',
          providerChargeQuotedAt: now,
        }));
        expect(result).toEqual(expect.objectContaining({
          checkoutEnabled: true,
          providerChargeQuote: {
            currency: 'USD',
            amountMinor: 7490,
            amountDecimal: '74.90',
            rate: '0.00072',
            quotedAt: now.toISOString(),
          },
        }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation keeps Alipay checkout disabled when the Alipay provider flag is off', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-29T10:00:00.000Z');
      vi.setSystemTime(now);

      try {
        const userId = randomUUID();
        const providerChargeQuoteService = {
          getAlipayAvailability: vi.fn().mockReturnValue({
            enabled: false,
            disabledReason: 'ALIPAY_CHECKOUT_DISABLED',
          }),
          getForeignEasyPayAvailability: vi.fn().mockReturnValue({ enabled: true }),
          createForeignEasyPayQuote: vi.fn().mockReturnValue({
            currency: 'USD',
            amountMinor: 7490,
            amountDecimal: '74.90',
            rate: '0.00072',
            quotedAt: now.toISOString(),
          }),
        };
        const alipayService = new ReservationService(
          mockDb as never,
          mockTossClient as unknown as TossPaymentsClient,
          mockBookingService as unknown as BookingService,
          mockBookingGateway as unknown as BookingGateway,
          mockFeatureFlags as unknown as FeatureFlagsService,
          mockConsentService as unknown as ConsentService,
          undefined,
          undefined,
          providerChargeQuoteService as never,
        );
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-ALIPAY-DISABLED-PREPARE',
          seats: [
            { seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' },
            { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
          ],
          amount: 104000,
          consentItems: makeConsentItems(),
          queueAdmission: makeQueueAdmission(now),
          paymentDeadlineAt: now.toISOString(),
          bookingPolicy: {
            maxTicketsPerOrder: 2,
            cancellationChangePolicy: 'CANCEL_ONLY' as const,
            sameGradeChangeEnabled: false,
            paymentWindowMinutes: 7,
            seatHoldMinutes: 10,
          },
          paymentMethod: {
            method: 'FOREIGN_EASY_PAY' as const,
            provider: 'ALIPAY_PLUS' as const,
            currency: 'USD',
            pendingUrlRequired: true,
          },
        };
        const insertedValues: unknown[] = [];
        setupPrepareBase(dto);
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((values: unknown) => {
              insertedValues.push(values);
              return {
                returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
              };
            }),
          }),
        };
        mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

        const result = await alipayService.prepareReservation(dto, userId);

        expect(providerChargeQuoteService.getAlipayAvailability).toHaveBeenCalled();
        expect(providerChargeQuoteService.createForeignEasyPayQuote).not.toHaveBeenCalled();
        expect(insertedValues[0]).not.toEqual(expect.objectContaining({
          providerChargeCurrency: 'USD',
        }));
        expect(result).toEqual(expect.objectContaining({
          checkoutEnabled: false,
          disabledReason: 'ALIPAY_CHECKOUT_DISABLED',
        }));
        expect(result.providerChargeQuote).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('prepareReservation keeps existing PayPal order disabled when its stored quote is missing', async () => {
      const userId = randomUUID();
      const providerChargeQuoteService = {
        getPaypalAvailability: vi.fn().mockReturnValue({ enabled: true }),
        createPaypalQuote: vi.fn(),
      };
      const paypalService = new ReservationService(
        mockDb as never,
        mockTossClient as unknown as TossPaymentsClient,
        mockBookingService as unknown as BookingService,
        mockBookingGateway as unknown as BookingGateway,
        mockFeatureFlags as unknown as FeatureFlagsService,
        mockConsentService as unknown as ConsentService,
        undefined,
        undefined,
        providerChargeQuoteService as never,
      );
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-PAYPAL-EXISTING-NO-QUOTE',
        seats: [seatSelection('A-1')],
        amount: 52000,
        consentItems: makeConsentItems(),
        paymentMethod: {
          method: 'FOREIGN_EASY_PAY' as const,
          provider: 'PAYPAL' as const,
          currency: 'USD',
        },
      };
      setupExistingPendingOrder({ ...dto, userId, seats: dto.seats });

      const result = await paypalService.prepareReservation(dto, userId);

      expect(result).toEqual(expect.objectContaining({
        reservationId: 'reservation-existing',
        checkoutEnabled: false,
        disabledReason: 'PAYPAL_PROVIDER_CHARGE_QUOTE_MISSING',
      }));
      expect(result.providerChargeQuote).toBeUndefined();
      expect(providerChargeQuoteService.createPaypalQuote).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation stores canonical tierName and price from seat map config', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-CANONICAL-SEATS',
        seats: [{ seatId: 'A-1', tierName: 'R', price: 1, row: 'client', number: '999' }],
        amount: 102000,
        consentItems: makeConsentItems(),
      };
      const insertedValues: unknown[] = [];

      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{ id: dto.showtimeId, performanceId: 'performance-1', dateTime: new Date() }]))
        .mockReturnValueOnce(chainResult([
          { tierName: 'VIP', price: 100000 },
          { tierName: 'R', price: 80000 },
        ]))
        .mockReturnValueOnce(chainResult([{
          seatConfig: {
            tiers: [
              { tierName: 'VIP', color: '#111111', seatIds: ['A-1'] },
              { tierName: 'R', color: '#222222', seatIds: ['B-1'] },
            ],
          },
        }]))
        .mockReturnValueOnce(chainResult([{ birthDate: '1995-05-15' }]));

      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn((values: unknown) => {
            insertedValues.push(values);
            return {
              returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
            };
          }),
        }),
      };
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(service.prepareReservation(dto, userId))
        .resolves
        .toEqual(expect.objectContaining({
          reservationId: 'reservation-created',
          orderId: dto.orderId,
        }));

      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, dto.showtimeId, ['1F:A-1']);
      expect(insertedValues[1]).toEqual([
        expect.objectContaining({
          reservationId: 'reservation-created',
          seatId: '1F:A-1',
          tierName: 'VIP',
          price: 100000,
          row: 'A',
          number: '1',
        }),
      ]);
    });

    it('prepareReservation treats same seat labels on different floors as distinct seatKeys', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-FLOOR-AWARE-SEAT-KEYS',
        seats: [floorAwareSeatSelection('1F:A-1'), floorAwareSeatSelection('2F:A-1')],
        amount: 104000,
        consentItems: makeConsentItems(),
      };
      const insertedValues: unknown[] = [];

      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{
          id: dto.showtimeId,
          performanceId: 'performance-1',
          dateTime: new Date(),
          maxTicketsPerUser: 2,
          changePolicyEnabled: false,
          paymentWindowMinutes: 7,
          seatHoldMinutes: 10,
        }]))
        .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 50000 }]))
        .mockReturnValueOnce(chainResult([
          {
            floorKey: '1F',
            floorLabel: '1층',
            seatConfig: {
              tiers: [{ tierName: 'VIP', color: '#111111', seatIds: ['A-1'] }],
            },
          },
          {
            floorKey: '2F',
            floorLabel: '2층',
            seatConfig: {
              tiers: [{ tierName: 'VIP', color: '#222222', seatIds: ['A-1'] }],
            },
          },
        ]))
        .mockReturnValueOnce(chainResult([{ birthDate: '1995-05-15' }]));

      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn((values: unknown) => {
            insertedValues.push(values);
            return {
              returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
            };
          }),
        }),
      };
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(service.prepareReservation(dto, userId))
        .resolves
        .toEqual(expect.objectContaining({
          reservationId: 'reservation-created',
          orderId: dto.orderId,
        }));

      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(
        userId,
        dto.showtimeId,
        ['1F:A-1', '2F:A-1'],
      );
      expect(insertedValues[1]).toEqual([
        expect.objectContaining({ seatId: '1F:A-1', row: 'A', number: '1' }),
        expect.objectContaining({ seatId: '2F:A-1', row: 'A', number: '1' }),
      ]);
    });

    it('prepareReservation rejects seat selections above event maxTicketsPerUser across floors combined', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-POLICY-LIMIT-CROSS-FLOOR',
        seats: [floorAwareSeatSelection('1F:A-1'), floorAwareSeatSelection('2F:B-1')],
        amount: 100000,
        consentItems: makeConsentItems(),
      };

      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{
          id: dto.showtimeId,
          performanceId: 'performance-1',
          dateTime: new Date(),
          maxTicketsPerUser: 1,
          changePolicyEnabled: false,
          paymentWindowMinutes: 7,
          seatHoldMinutes: 10,
        }]))
        .mockReturnValueOnce(chainResult([{ tierName: 'VIP', price: 50000 }]))
        .mockReturnValueOnce(chainResult([
          {
            floorKey: '1F',
            floorLabel: '1층',
            seatConfig: {
              tiers: [{ tierName: 'VIP', color: '#111111', seatIds: ['A-1'] }],
            },
          },
          {
            floorKey: '2F',
            floorLabel: '2층',
            seatConfig: {
              tiers: [{ tierName: 'VIP', color: '#222222', seatIds: ['B-1'] }],
            },
          },
        ]));

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('최대 1석까지 선택할 수 있습니다');

      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects when existing active tickets plus requested seats exceed maxTicketsPerUser', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-POLICY-LIMIT-CUMULATIVE',
        seats: [
          floorAwareSeatSelection('1F:A-1'),
          floorAwareSeatSelection('1F:A-2'),
          floorAwareSeatSelection('1F:A-3'),
        ],
        amount: 156000,
        consentItems: makeConsentItems(),
      };

      setupPrepareBase(dto);
      mockDb.execute.mockResolvedValueOnce({ rows: [{ active_ticket_count: 2 }] });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('이 공연은 1인 최대 4매까지 예매할 수 있습니다');

      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation writes booking consent audit in the pending reservation transaction', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-BOOKING-CONSENT-AUDIT',
        seats: [seatSelection('A-1')],
        amount: 52000,
        consentItems: makeConsentItems(),
      };
      setupPrepareBase(dto);
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'reservation-created', tossOrderId: dto.orderId }]),
          })),
        }),
      };
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
      const requestMeta = {
        ipAddress: '198.51.100.10',
        userAgent: 'Vitest Booking',
      };

      await expect(service.prepareReservation(dto, userId, requestMeta))
        .resolves
        .toEqual(expect.objectContaining({
          reservationId: 'reservation-created',
          orderId: dto.orderId,
        }));

      expect(mockConsentService.captureConsent).toHaveBeenCalledTimes(1);
      expect(mockConsentService.captureConsent).toHaveBeenCalledWith(
        userId,
        {
          birthDate: '1995-05-15',
          items: dto.consentItems,
          sourceFlow: 'booking',
        },
        requestMeta,
        mockTx,
      );
    });

    it('prepareReservation rejects missing active lock before creating pending reservation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-LOCK-PREPARE-MISSING',
        seats: [seatSelection('A-1')],
        amount: 52000,
        consentItems: makeConsentItems(),
      };
      setupPrepareBase(dto);
      mockBookingService.assertOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException(LOCK_EXPIRED_MESSAGE),
      );

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow(LOCK_EXPIRED_MESSAGE);

      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, dto.showtimeId, ['1F:A-1']);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects other-user lock before creating pending reservation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-LOCK-PREPARE-OTHER',
        seats: [seatSelection('A-2')],
        amount: 52000,
        consentItems: makeConsentItems(),
      };
      setupPrepareBase(dto);
      mockBookingService.assertOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException(LOCK_OTHER_OWNER_MESSAGE),
      );

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow(LOCK_OTHER_OWNER_MESSAGE);

      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, dto.showtimeId, ['1F:A-2']);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('Existing pending order cannot bypass active lock ownership', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-LOCK-IDEMPOTENT-PENDING',
        seats: [seatSelection('A-1'), seatSelection('A-2')],
        amount: 104000,
        consentItems: makeConsentItems(),
      };
      setupExistingPendingOrder({ ...dto, userId });
      mockBookingService.assertOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException(LOCK_EXPIRED_MESSAGE),
      );

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow(LOCK_EXPIRED_MESSAGE);

      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, dto.showtimeId, ['1F:A-1', '1F:A-2']);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects reused orderId when existing reservation is not pending', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-IDEMPOTENT-CANCELLED',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems(),
      };
      setupExistingPendingOrder({ ...dto, userId, status: 'CANCELLED', seats: ['A-1'] });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('이미 처리된 주문 ID입니다. 새 주문 ID로 다시 시도해주세요.');

      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects reused orderId when request seats do not match existing pending reservation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-IDEMPOTENT-SEAT-MISMATCH',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems(),
      };
      setupExistingPendingOrder({
        ...dto,
        userId,
        amount: 50000,
        seats: ['A-2'],
      });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');

      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects reused orderId when request amount does not match existing pending reservation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-IDEMPOTENT-AMOUNT-MISMATCH',
        seats: [seatSelection('A-1')],
        amount: 40000,
        consentItems: makeConsentItems(),
      };
      setupExistingPendingOrder({
        ...dto,
        userId,
        amount: 50000,
        seats: ['A-1'],
      });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');

      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation rejects another user existing pending orderId', async () => {
      const userId = randomUUID();
      const otherUserId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-LOCK-IDEMPOTENT-OTHER-USER',
        seats: [seatSelection('A-1')],
        amount: 50000,
        consentItems: makeConsentItems(),
      };
      setupExistingPendingOrder({ ...dto, userId: otherUserId });

      await expect(service.prepareReservation(dto, userId))
        .rejects
        .toThrow('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');

      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('prepareReservation expires pending reservation when the 7-minute payment deadline already passed without handoff', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-08T07:08:00.000Z');
      vi.setSystemTime(now);

      try {
        const userId = randomUUID();
        const dto = {
          showtimeId: randomUUID(),
          orderId: 'GRP-EXPIRED-PENDING',
          seats: [floorAwareSeatSelection('1F:A-1')],
          amount: 50000,
          consentItems: makeConsentItems(),
          queueAdmission: makeQueueAdmission(new Date('2026-05-08T07:00:00.000Z')),
          paymentDeadlineAt: '2026-05-08T07:07:00.000Z',
          bookingPolicy: {
            maxTicketsPerOrder: 1,
            cancellationChangePolicy: 'CANCEL_ONLY' as const,
            sameGradeChangeEnabled: false,
          },
          paymentMethod: {
            method: 'CARD' as const,
            provider: 'CARD' as const,
            currency: 'KRW',
          },
        };

        mockDb.select
          .mockReturnValueOnce(chainResult([{
            id: 'reservation-existing',
            userId,
            tossOrderId: dto.orderId,
            showtimeId: dto.showtimeId,
            status: 'PENDING_PAYMENT',
            totalAmount: 50000,
            paymentDeadlineAt: new Date('2026-05-08T07:07:00.000Z'),
          }]))
          .mockReturnValueOnce(chainResult([]));

        const where = vi.fn().mockResolvedValue([]);
        const set = vi.fn().mockReturnValue({ where });
        mockDb.update.mockReturnValue({ set });

        await expect(service.prepareReservation(dto, userId))
          .rejects
          .toThrow('결제 가능 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');

        expect(mockDb.update).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('list', () => {
    it('should return filtered reservations by status for given userId', async () => {
      const userId = randomUUID();
      const reservationId = randomUUID();

      // Helper: creates a deeply chainable mock that supports any method sequence
      function createChainMock(resolvedValue: unknown) {
        const handler: ProxyHandler<object> = {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => void) => resolve(resolvedValue);
            }
            return (..._args: unknown[]) => new Proxy({}, handler);
          },
        };
        return new Proxy({}, handler);
      }

      let selectCall = 0;
      mockDb.select.mockImplementation(() => {
        selectCall++;
        if (selectCall === 1) {
          // Main query: reservations JOIN showtimes JOIN performances LEFT JOIN venues
          return createChainMock([
            {
              reservation: {
                id: reservationId,
                reservationNumber: 'GRP-20260403-ABCDE',
                status: 'CONFIRMED',
                totalAmount: 150000,
                createdAt: new Date(),
              },
              showtime: { dateTime: new Date() },
              performance: { title: '테스트 공연', posterUrl: null },
              venue: { name: '테스트 극장' },
            },
          ]);
        }
        // Subsequent calls = seats sub-query
        return createChainMock([
          { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
        ]);
      });

      const result = await service.getMyReservations(userId, 'CONFIRMED');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]?.performanceTitle).toBe('테스트 공연');
    });
  });

  describe('cancel', () => {
    it('should succeed when cancelling before deadline with SELECT FOR UPDATE', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const showtimeId = randomUUID();
      const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Mock: transaction with SELECT FOR UPDATE + payment query + updates
      mockDb.transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => Promise<void>) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue({
            rows: [{
              id: reservationId,
              user_id: userId,
              showtime_id: showtimeId,
              status: 'CONFIRMED',
              cancel_deadline: futureDeadline,
            }],
          }),
          select: vi.fn().mockReturnValueOnce(chainResult([])).mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{
                id: randomUUID(),
                paymentKey: 'pk_test_123',
              }]),
            }),
          }).mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return cb(mockTx);
      });

      // Mock: post-transaction select for WS broadcast
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      await expect(service.cancelReservation(reservationId, userId, '단순 변심'))
        .resolves.not.toThrow();

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith('pk_test_123', '단순 변심');
    });

    it('cancels the whole reservation when seat-level ticket items exist', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const showtimeId = randomUUID();
      const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
      const mockTx = {
        execute: vi.fn().mockResolvedValue({
          rows: [{
            id: reservationId,
            user_id: userId,
            showtime_id: showtimeId,
            status: 'CONFIRMED',
            cancel_deadline: futureDeadline,
          }],
        }),
        select: vi.fn()
          .mockReturnValueOnce(chainResult([
            { id: 'ticket-item-1', price: 77000, serviceFee: 2000 },
            { id: 'ticket-item-2', price: 77000, serviceFee: 2000 },
          ]))
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{
                id: randomUUID(),
                paymentKey: 'pk_seat_level_full_cancel',
              }]),
            }),
          })
          .mockReturnValueOnce(chainResult([{ seatId: 'A-1' }, { seatId: 'A-2' }])),
        update: vi.fn((table: unknown) => ({
          set: vi.fn((values: Record<string, unknown>) => {
            updateCalls.push({ table, values });
            return { where: vi.fn().mockResolvedValue([]) };
          }),
        })),
      };
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ seatId: 'A-1' }, { seatId: 'A-2' }]),
        }),
      });

      await expect(service.cancelReservation(reservationId, userId, '단순 변심'))
        .resolves.not.toThrow();

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_seat_level_full_cancel',
        '단순 변심',
      );
      expect(updateCalls.find((call) => call.table === reservations)?.values)
        .toMatchObject({ status: 'CANCELLED', cancelReason: '단순 변심' });
      expect(updateCalls.find((call) => call.table === payments)?.values)
        .toMatchObject({ status: 'CANCELED', cancelReason: '단순 변심' });
      expect(updateCalls.find((call) => call.table === ticketItems)?.values)
        .toMatchObject({
          status: 'cancelled',
          cancelReason: '단순 변심',
          cancellationFee: 0,
          reopenState: 'available',
        });
      expect(updateCalls.find((call) => call.table === tickets)?.values)
        .toMatchObject({ status: 'revoked' });
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(true);
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
        showtimeId,
        'A-1',
        'available',
      );
    });
  });

  describe('cancelTicketItem', () => {
    it('moves the ticket item through pending before partial cancel success reopens only that seat', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-08T14:50:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        const showtimeId = randomUUID();
        vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
          id: reservationId,
          ticketItems: [],
        } as never);
        const { mockTx, updateCalls, transactionCommitted } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          showtimeId,
          reservationCreatedAt: new Date('2026-05-08T01:00:00.000Z'),
          showtimeAt: new Date('2026-06-01T10:00:00.000Z'),
          seatKey: '1F:A-1',
          price: 77000,
          serviceFee: TICKET_SERVICE_FEE_KRW,
          activeRemainingRows: [{ id: randomUUID() }],
        });

        await expect(service.cancelTicketItem(
          reservationId,
          ticketItemId,
          userId,
          '단순 변심',
        )).resolves.toMatchObject({ id: reservationId });

        expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
          'pk_ticket_item_cancel',
          '단순 변심',
          {
            cancelAmount: 79000,
            idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
            secretKeyScope: 'default',
          },
        );
        const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
        expect(ticketItemUpdates[0]?.values).toMatchObject({
          status: 'cancellation_pending',
          cancelReason: '단순 변심',
          cancellationFee: 0,
          serviceFeeRefund: TICKET_SERVICE_FEE_KRW,
          refundableAmount: 79000,
          reopenState: 'held_cancelled',
          reopenHoldUntil: null,
          reopenJobId: null,
        });
        expect(ticketItemUpdates[1]?.values).toMatchObject({
          status: 'cancelled',
          reopenState: 'available',
          reopenHoldUntil: null,
          reopenJobId: null,
        });
        expect(updateCalls.find((call) => call.table === tickets)?.values).toMatchObject({
          status: 'revoked',
        });
        expect(updateCalls.find((call) => call.table === seatInventories)?.values).toMatchObject({
          status: 'available',
          soldAt: null,
          lockedBy: null,
          lockedUntil: null,
          reopenHoldUntil: null,
          reopenJobId: null,
          heldCancelledAt: null,
        });
        expect(updateCalls.some((call) => call.table === reservations)).toBe(false);
        expect(updateCalls.some((call) => call.table === payments)).toBe(false);
        expect(mockTx.update.mock.invocationCallOrder[0]!)
          .toBeLessThan(mockTossClient.cancelPayment.mock.invocationCallOrder[0]!);
        expect(transactionCommitted.mock.invocationCallOrder[0]!)
          .toBeLessThan(mockTossClient.cancelPayment.mock.invocationCallOrder[0]!);
        expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
          showtimeId,
          '1F:A-1',
          'available',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies show-date NOL fee priority and finalizes full payment cancellation for the last ticket item', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-23T03:00:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
          id: reservationId,
          status: 'CANCELLED',
          ticketItems: [],
        } as never);
        const { updateCalls } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          reservationCreatedAt: new Date('2026-05-20T01:00:00.000Z'),
          showtimeAt: new Date('2026-05-30T10:00:00.000Z'),
          price: 77000,
          serviceFee: TICKET_SERVICE_FEE_KRW,
          activeRemainingRows: [],
        });

        await service.cancelTicketItem(reservationId, ticketItemId, userId, '일정 변경');

        expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
          'pk_ticket_item_cancel',
          '일정 변경',
          {
            idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
            secretKeyScope: 'default',
          },
        );
        expect(mockTossClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty('cancelAmount');
        expect(updateCalls.find((call) => call.table === ticketItems)?.values).toMatchObject({
          cancellationFee: 7700,
          serviceFeeRefund: 0,
          refundableAmount: 69300,
        });
        expect(mockPaymentCancellationFinalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith({
          source: 'ticket_item',
          context: expect.objectContaining({
            reservation: expect.objectContaining({
              id: reservationId,
            }),
            payment: expect.objectContaining({
              id: 'payment-1',
              paymentKey: 'pk_ticket_item_cancel',
            }),
          }),
          reason: '일정 변경',
          ticketItemCancellation: {
            ticketItemId,
            cancellationFee: 7700,
            serviceFeeRefund: 0,
            refundableAmount: 69300,
          },
          providerResponse: expect.objectContaining({ status: 'CANCELED' }),
          actor: { kind: 'user' },
        });
        expect(updateCalls.some((call) => call.table === reservations)).toBe(false);
        expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
        expect(updateCalls.some((call) => call.table === payments)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('passes floor-aware seat identity to full cancellation finalization for the last ticket item', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        status: 'CANCELLED',
        ticketItems: [],
      } as never);
      setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        seatId: 'S-118',
        seatKey: '2F:S-118',
        floorKey: '2F',
        activeRemainingRows: [],
      });

      await service.cancelTicketItem(reservationId, ticketItemId, userId, '다른 좌석으로 재예매');

      expect(mockPaymentCancellationFinalizer.finalizeFullPaymentCancellation)
        .toHaveBeenCalledWith(expect.objectContaining({
          context: expect.objectContaining({
            seats: [{
              seatId: 'S-118',
              floorKey: '2F',
              seatKey: '2F:S-118',
            }],
          }),
        }));
    });

    it('rejects account-transfer ticket-item partial cancellation before calling Toss', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        paymentMethod: 'TRANSFER',
        paymentProvider: 'TOSS_TRANSFER',
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '다른 좌석으로 재예매',
      )).rejects.toThrow('계좌이체 결제는 좌석별 부분취소를 지원하지 않습니다');

      expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
      expect(updateCalls).toHaveLength(0);
    });

    it('uses provider-currency PayPal partial cancel options for a non-last ticket item', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        paymentMethod: 'PAYPAL',
        paymentProvider: 'PAYPAL',
        paymentCurrency: 'USD',
        paymentAmount: 150000,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        '단순 변심',
        {
          cancelAmount: 52.56,
          currency: 'USD',
          idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
          secretKeyScope: 'default',
        },
      );
    });

    it('uses foreign-easy-pay scope, provider currency, and cancelRequestId for Alipay partial cancel', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        paymentMethod: 'FOREIGN_EASY_PAY',
        paymentProvider: 'ALIPAY',
        paymentCurrency: 'USD',
        paymentAmount: 150000,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        '단순 변심',
        {
          cancelAmount: 52.56,
          currency: 'USD',
          idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
          secretKeyScope: 'foreign-easy-pay',
          cancelRequestId: `cancel_${ticketItemId}`,
        },
      );
      expect(mockTossClient.queryPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        { secretKeyScope: 'foreign-easy-pay' },
      );
    });

    it('uses overseas-card scope and provider currency for overseas-card partial cancel', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        paymentMethod: 'CARD',
        paymentProvider: 'CARD',
        paymentCurrency: 'USD',
        paymentAmount: 150000,
        providerMetadata: { requestedProvider: 'OVERSEAS_CARD' },
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        '단순 변심',
        {
          cancelAmount: 52.56,
          currency: 'USD',
          idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
          secretKeyScope: 'overseas-card',
        },
      );
      expect(mockTossClient.queryPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        { secretKeyScope: 'overseas-card' },
      );
    });

    it('finalizes last active Alipay ticket item only after Toss full cancel is CANCELED', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      mockTossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pk_ticket_item_cancel',
        orderId: 'GRP-20260403-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 10800,
        status: 'CANCELED',
        approvedAt: '2026-04-03T10:00:00+09:00',
        cancels: [{
          cancelAmount: 108,
          cancelReason: '단순 변심',
          canceledAt: '2026-04-03T11:00:00+09:00',
          cancelStatus: 'DONE',
          cancelRequestId: `cancel_${ticketItemId}`,
        }],
      });
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        paymentMethod: 'FOREIGN_EASY_PAY',
        paymentProvider: 'ALIPAY_PLUS',
        paymentCurrency: 'USD',
        paymentAmount: 150000,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        providerMetadata: { asyncStatus: 'DONE' },
        activeRemainingRows: [],
        reservationSeatRows: [{ seat_id: 'A-1' }, { seat_id: 'A-2' }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        '단순 변심',
        {
          idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
          secretKeyScope: 'foreign-easy-pay',
          cancelRequestId: `cancel_${ticketItemId}`,
        },
      );
      expect(mockTossClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty('cancelAmount');
      expect(mockTossClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty('currency');
      expect(mockPaymentCancellationFinalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith({
        source: 'ticket_item',
        context: expect.objectContaining({
          reservation: expect.objectContaining({
            id: reservationId,
            reservationNumber: 'GRP-20260508-ITEMS',
          }),
          payment: expect.objectContaining({
            id: 'payment-1',
            paymentKey: 'pk_ticket_item_cancel',
            providerMetadata: { asyncStatus: 'DONE' },
          }),
          bookingPolicy: {
            cancelledSeatHoldMinMinutes: 1,
            cancelledSeatHoldMaxMinutes: 10,
          },
          seats: [{ seatId: 'A-1', floorKey: '1F', seatKey: '1F:A-1' }],
        }),
        ticketItemCancellation: {
          ticketItemId,
          cancellationFee: 4000,
          serviceFeeRefund: 0,
          refundableAmount: 73000,
        },
        reason: '단순 변심',
        providerResponse: expect.objectContaining({ status: 'CANCELED' }),
        actor: { kind: 'user' },
      });
      expect(updateCalls.some((call) => call.table === reservations)).toBe(false);
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
    });

    it('keeps last active async full cancel pending when Toss reports IN_PROGRESS', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      mockTossClient.cancelPayment.mockResolvedValueOnce({
        paymentKey: 'pk_ticket_item_cancel',
        orderId: 'GRP-20260403-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 10800,
        status: 'DONE',
        approvedAt: '2026-04-03T10:00:00+09:00',
        cancels: [{
          cancelAmount: 108,
          cancelReason: '단순 변심',
          canceledAt: '2026-04-03T11:00:00+09:00',
          cancelStatus: 'IN_PROGRESS',
          cancelRequestId: `cancel_${ticketItemId}`,
        }],
      });
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        paymentMethod: 'FOREIGN_EASY_PAY',
        paymentProvider: 'ALIPAY',
        paymentCurrency: 'USD',
        paymentAmount: 150000,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10800,
        activeRemainingRows: [],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

      const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
      expect(ticketItemUpdates).toHaveLength(1);
      expect(ticketItemUpdates[0]?.values).toMatchObject({
        status: 'cancellation_pending',
        reopenState: 'held_cancelled',
      });
      expect(mockPaymentCancellationFinalizer.finalizeFullPaymentCancellation).not.toHaveBeenCalled();
      expect(updateCalls.some((call) => call.table === tickets && call.values.status === 'active')).toBe(false);
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
    });

    it('rejects ticket-item cancellation after that seat has entered and does not call Toss', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        admissionState: 'entered',
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('입장 처리된 티켓은 취소할 수 없습니다');

      expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
      expect(updateCalls).toHaveLength(0);
    });

    it('rejects ticket-item cancellation on the show date in Korea and does not call Toss', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-29T15:00:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        const { updateCalls } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          reservationCreatedAt: new Date('2026-05-20T01:00:00.000Z'),
          showtimeAt: new Date('2026-05-30T01:00:00.000Z'),
        });

        await expect(service.cancelTicketItem(
          reservationId,
          ticketItemId,
          userId,
          '단순 변심',
        )).rejects.toThrow('관람일 당일에는 취소할 수 없습니다');

        expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
        expect(updateCalls).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('restores the ticket item and QR when Toss returns a definite partial-cancel failure', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      mockTossClient.cancelPayment.mockRejectedValueOnce(
        Object.assign(new Error('cancel amount exceeds refundable amount'), {
          name: 'TossPaymentError',
          code: 'NOT_ENOUGH_CANCELABLE_AMOUNT',
        }),
      );
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

      const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
      expect(ticketItemUpdates[0]?.values).toMatchObject({
        status: 'cancellation_pending',
        reopenState: 'held_cancelled',
      });
      expect(ticketItemUpdates[1]?.values).toMatchObject({
        status: 'active',
        cancelledAt: null,
        cancelReason: null,
        reopenState: 'not_required',
      });
      const ticketUpdates = updateCalls.filter((call) => call.table === tickets);
      expect(ticketUpdates[0]?.values).toMatchObject({ status: 'revoked' });
      expect(ticketUpdates[1]?.values).toMatchObject({
        status: 'active',
        revokedAt: null,
      });
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('keeps the ticket item pending and the seat closed when Toss partial-cancel outcome is unresolved', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      mockTossClient.cancelPayment.mockRejectedValueOnce(new Error('network timeout'));
      mockTossClient.queryPayment
        .mockRejectedValueOnce(new Error('query timeout'))
        .mockRejectedValueOnce(new Error('query timeout'));
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

      const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
      expect(ticketItemUpdates).toHaveLength(1);
      expect(ticketItemUpdates[0]?.values).toMatchObject({
        status: 'cancellation_pending',
        reopenState: 'held_cancelled',
      });
      expect(updateCalls.find((call) => call.table === tickets)?.values).toMatchObject({
        status: 'revoked',
      });
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      expect(mockTossClient.queryPayment).toHaveBeenCalledWith(
        'pk_ticket_item_cancel',
        { secretKeyScope: 'default' },
      );
    });

    it('keeps domestic lost partial-cancel response ambiguous without cancelRequestId', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-08T14:50:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
          id: reservationId,
          ticketItems: [],
        } as never);
        mockTossClient.cancelPayment.mockRejectedValueOnce(new Error('network timeout'));
        mockTossClient.queryPayment
          .mockResolvedValueOnce({
            paymentKey: 'pk_ticket_item_cancel',
            orderId: 'GRP-20260403-ABCDE',
            method: '카드',
            totalAmount: 150000,
            status: 'DONE',
            approvedAt: '2026-04-03T10:00:00+09:00',
            cancels: [],
          })
          .mockResolvedValueOnce({
            paymentKey: 'pk_ticket_item_cancel',
            orderId: 'GRP-20260403-ABCDE',
            method: '카드',
            totalAmount: 150000,
            status: 'DONE',
            approvedAt: '2026-04-03T10:00:00+09:00',
            cancels: [{
              cancelAmount: 79000,
              cancelReason: '단순 변심',
              canceledAt: '2026-04-03T11:00:00+09:00',
            }],
          });
        const { updateCalls } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          activeRemainingRows: [{ id: randomUUID() }],
        });

        await expect(service.cancelTicketItem(
          reservationId,
          ticketItemId,
          userId,
          '단순 변심',
        )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

        const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
        expect(ticketItemUpdates[0]?.values).toMatchObject({
          status: 'cancellation_pending',
        });
        expect(ticketItemUpdates).toHaveLength(1);
        expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
        expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('continues Alipay cancellation when Toss query confirms the matching cancelRequestId', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-08T14:50:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
          id: reservationId,
          ticketItems: [],
        } as never);
        mockTossClient.cancelPayment.mockRejectedValueOnce(new Error('network timeout'));
        mockTossClient.queryPayment
          .mockResolvedValueOnce({
            paymentKey: 'pk_ticket_item_cancel',
            orderId: 'GRP-20260403-ABCDE',
            method: 'FOREIGN_EASY_PAY',
            totalAmount: 10800,
            status: 'DONE',
            approvedAt: '2026-04-03T10:00:00+09:00',
            cancels: [],
          })
          .mockResolvedValueOnce({
            paymentKey: 'pk_ticket_item_cancel',
            orderId: 'GRP-20260403-ABCDE',
            method: 'FOREIGN_EASY_PAY',
            totalAmount: 10800,
            status: 'DONE',
            approvedAt: '2026-04-03T10:00:00+09:00',
            cancels: [{
              cancelAmount: 52.56,
              cancelReason: '단순 변심',
              canceledAt: '2026-04-03T11:00:00+09:00',
              cancelStatus: 'DONE',
              cancelRequestId: `cancel_${ticketItemId}`,
            }],
          });
        const { updateCalls } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          paymentMethod: 'FOREIGN_EASY_PAY',
          paymentProvider: 'ALIPAY',
          paymentCurrency: 'USD',
          paymentAmount: 150000,
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10800,
          activeRemainingRows: [{ id: randomUUID() }],
        });

        await expect(service.cancelTicketItem(
          reservationId,
          ticketItemId,
          userId,
          '단순 변심',
        )).resolves.toMatchObject({ id: reservationId });

        const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
        expect(ticketItemUpdates[1]?.values).toMatchObject({
          status: 'cancelled',
          reopenState: 'available',
        });
        expect(updateCalls.find((call) => call.table === seatInventories)?.values).toMatchObject({
          status: 'available',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not reconcile a lost Toss response from an older same-amount sibling cancellation', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-08T14:50:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
          id: reservationId,
          ticketItems: [],
        } as never);
        const olderSameAmountCancel = {
          cancelAmount: 79000,
          cancelReason: '단순 변심',
          canceledAt: '2026-05-08T20:00:00+09:00',
        };
        mockTossClient.cancelPayment.mockRejectedValueOnce(new Error('network timeout'));
        mockTossClient.queryPayment
          .mockResolvedValueOnce({
            paymentKey: 'pk_ticket_item_cancel',
            orderId: 'GRP-20260403-ABCDE',
            method: '카드',
            totalAmount: 150000,
            status: 'DONE',
            approvedAt: '2026-04-03T10:00:00+09:00',
            cancels: [olderSameAmountCancel],
          })
          .mockResolvedValueOnce({
            paymentKey: 'pk_ticket_item_cancel',
            orderId: 'GRP-20260403-ABCDE',
            method: '카드',
            totalAmount: 150000,
            status: 'DONE',
            approvedAt: '2026-04-03T10:00:00+09:00',
            cancels: [olderSameAmountCancel],
          });
        const { updateCalls } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          activeRemainingRows: [{ id: randomUUID() }],
        });

        await expect(service.cancelTicketItem(
          reservationId,
          ticketItemId,
          userId,
          '단순 변심',
        )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

        const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
        expect(ticketItemUpdates).toHaveLength(1);
        expect(ticketItemUpdates[0]?.values).toMatchObject({
          status: 'cancellation_pending',
          reopenState: 'held_cancelled',
        });
        expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
        expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('restores a fresh active ticket item on definite Toss failure even when an older sibling cancel matches the snapshot', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      const olderSameAmountCancel = {
        cancelAmount: 79000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T20:00:00+09:00',
      };
      mockTossClient.cancelPayment.mockRejectedValueOnce(
        Object.assign(new Error('cancel amount exceeds refundable amount'), {
          name: 'TossPaymentError',
          code: 'NOT_ENOUGH_CANCELABLE_AMOUNT',
        }),
      );
      mockTossClient.queryPayment
        .mockResolvedValueOnce({
          paymentKey: 'pk_ticket_item_cancel',
          orderId: 'GRP-20260403-ABCDE',
          method: '카드',
          totalAmount: 150000,
          status: 'DONE',
          approvedAt: '2026-04-03T10:00:00+09:00',
          cancels: [olderSameAmountCancel],
        })
        .mockResolvedValueOnce({
          paymentKey: 'pk_ticket_item_cancel',
          orderId: 'GRP-20260403-ABCDE',
          method: '카드',
          totalAmount: 150000,
          status: 'DONE',
          approvedAt: '2026-04-03T10:00:00+09:00',
          cancels: [olderSameAmountCancel],
        });
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

      const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
      expect(ticketItemUpdates[0]?.values).toMatchObject({ status: 'cancellation_pending' });
      expect(ticketItemUpdates[1]?.values).toMatchObject({
        status: 'active',
        cancelledAt: null,
        reopenState: 'not_required',
      });
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('retries an already pending ticket-item cancellation with the same Toss idempotency key', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-08T14:50:00.000Z'));

      try {
        const reservationId = randomUUID();
        const userId = randomUUID();
        const ticketItemId = randomUUID();
        vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
          id: reservationId,
          ticketItems: [],
        } as never);
        const pendingCancelledAt = new Date('2026-05-08T03:00:00.000Z');
        const { updateCalls } = setupTicketItemCancelTransaction({
          reservationId,
          userId,
          ticketItemId,
          ticketItemStatus: 'cancellation_pending',
          cancelledAt: pendingCancelledAt,
          cancelReason: '단순 변심',
          cancellationFee: 5000,
          serviceFeeRefund: 0,
          refundableAmount: 74000,
          activeRemainingRows: [{ id: randomUUID() }],
        });

        await expect(service.cancelTicketItem(
          reservationId,
          ticketItemId,
          userId,
          '다른 좌석으로 재예매',
        )).resolves.toMatchObject({ id: reservationId });

        expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
          'pk_ticket_item_cancel',
          '단순 변심',
          expect.objectContaining({
            cancelAmount: 74000,
            idempotencyKey: `ticket-item-cancel:${ticketItemId}`,
          }),
        );
        const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
        expect(ticketItemUpdates[0]?.values).toMatchObject({
          status: 'cancellation_pending',
          cancelledAt: pendingCancelledAt,
          cancelReason: '단순 변심',
          cancellationFee: 5000,
          serviceFeeRefund: 0,
          refundableAmount: 74000,
        });
        expect(ticketItemUpdates[1]?.values).toMatchObject({
          status: 'cancelled',
          reopenState: 'available',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses the original pending snapshot reason when a pending retry finalizes full cancellation', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      const pendingCancelledAt = new Date('2026-05-08T03:00:00.000Z');
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        ticketItemStatus: 'cancellation_pending',
        cancelledAt: pendingCancelledAt,
        cancelReason: '단순 변심',
        cancellationFee: 5000,
        serviceFeeRefund: 0,
        refundableAmount: 74000,
        activeRemainingRows: [],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '다른 좌석으로 재예매',
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockPaymentCancellationFinalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ticket_item',
          reason: '단순 변심',
        }),
      );
      expect(updateCalls.some((call) => call.table === reservations)).toBe(false);
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
    });

    it('recomputes unresolved ticket-item siblings inside the partial finalization transaction before leaving the parent reservation open', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      const { updateCalls, operationCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      const cancelUpdateIndex = operationCalls.findIndex((call) =>
        call.type === 'update'
        && call.table === ticketItems
        && call.values.status === 'cancelled',
      );
      const finalSiblingCheckIndex = operationCalls.findIndex((call, index) =>
        index > cancelUpdateIndex
        && call.type === 'select'
        && sqlPredicateHasParamValue(call.predicate, 'cancellation_pending'),
      );

      expect(cancelUpdateIndex).toBeGreaterThan(-1);
      expect(finalSiblingCheckIndex).toBeGreaterThan(cancelUpdateIndex);
      expect(updateCalls.some((call) => call.table === reservations)).toBe(false);
    });

    it('keeps the parent reservation open while another ticket item is cancellation_pending', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      const { updateCalls, selectWhereCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      expect(sqlPredicateHasParamValue(selectWhereCalls[0], 'cancellation_pending')).toBe(true);
      expect(sqlPredicateHasParamValue(selectWhereCalls[0], ticketItemId)).toBe(true);
      expect(updateCalls.some((call) => call.table === reservations)).toBe(false);
    });

    it('keeps pending retry unresolved instead of restoring active when Toss already shows a matching cancel snapshot', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      mockTossClient.cancelPayment.mockRejectedValueOnce(
        Object.assign(new Error('already cancelled'), {
          name: 'TossPaymentError',
          code: 'ALREADY_CANCELED',
        }),
      );
      mockTossClient.queryPayment
        .mockResolvedValueOnce({
          paymentKey: 'pk_ticket_item_cancel',
          orderId: 'GRP-20260403-ABCDE',
          method: '카드',
          totalAmount: 150000,
          status: 'DONE',
          approvedAt: '2026-04-03T10:00:00+09:00',
          cancels: [{
            cancelAmount: 74000,
            cancelReason: '단순 변심',
            canceledAt: '2026-04-03T11:00:00+09:00',
          }],
        })
        .mockResolvedValueOnce({
          paymentKey: 'pk_ticket_item_cancel',
          orderId: 'GRP-20260403-ABCDE',
          method: '카드',
          totalAmount: 150000,
          status: 'DONE',
          approvedAt: '2026-04-03T10:00:00+09:00',
          cancels: [{
            cancelAmount: 74000,
            cancelReason: '단순 변심',
            canceledAt: '2026-04-03T11:00:00+09:00',
          }],
        });
      const pendingCancelledAt = new Date('2026-05-08T03:00:00.000Z');
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        ticketItemStatus: 'cancellation_pending',
        cancelledAt: pendingCancelledAt,
        cancelReason: '단순 변심',
        cancellationFee: 5000,
        serviceFeeRefund: 0,
        refundableAmount: 74000,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

      const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
      expect(ticketItemUpdates).toHaveLength(1);
      expect(ticketItemUpdates[0]?.values).toMatchObject({
        status: 'cancellation_pending',
        cancelledAt: pendingCancelledAt,
        reopenState: 'held_cancelled',
        refundableAmount: 74000,
      });
      expect(updateCalls.some((call) => call.table === tickets && call.values.status === 'active')).toBe(false);
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('keeps pending retry unresolved when Toss definite failure cannot be checked against a payment snapshot', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      mockTossClient.cancelPayment.mockRejectedValueOnce(
        Object.assign(new Error('already cancelled'), {
          name: 'TossPaymentError',
          code: 'ALREADY_CANCELED',
        }),
      );
      mockTossClient.queryPayment
        .mockRejectedValueOnce(new Error('query timeout'))
        .mockRejectedValueOnce(new Error('query timeout'));
      const pendingCancelledAt = new Date('2026-05-08T03:00:00.000Z');
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        ticketItemStatus: 'cancellation_pending',
        cancelledAt: pendingCancelledAt,
        cancelReason: '단순 변심',
        cancellationFee: 5000,
        serviceFeeRefund: 0,
        refundableAmount: 74000,
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).rejects.toThrow('취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.');

      const ticketItemUpdates = updateCalls.filter((call) => call.table === ticketItems);
      expect(ticketItemUpdates).toHaveLength(1);
      expect(ticketItemUpdates[0]?.values).toMatchObject({
        status: 'cancellation_pending',
        cancelledAt: pendingCancelledAt,
      });
      expect(updateCalls.some((call) => call.table === tickets && call.values.status === 'active')).toBe(false);
      expect(updateCalls.some((call) => call.table === seatInventories)).toBe(false);
    });

    it('reopens legacy inventory rows where seat_key is null after a successful ticket-item cancel', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const ticketItemId = randomUUID();
      vi.spyOn(service, 'getReservationDetail').mockResolvedValue({
        id: reservationId,
        ticketItems: [],
      } as never);
      const { updateCalls } = setupTicketItemCancelTransaction({
        reservationId,
        userId,
        ticketItemId,
        seatKey: '1F:A-1',
        activeRemainingRows: [{ id: randomUUID() }],
      });

      await expect(service.cancelTicketItem(
        reservationId,
        ticketItemId,
        userId,
        '단순 변심',
      )).resolves.toMatchObject({ id: reservationId });

      const seatInventoryUpdate = updateCalls.find((call) => call.table === seatInventories);
      expect(seatInventoryUpdate?.values).toMatchObject({ status: 'available' });
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
        expect.any(String),
        '1F:A-1',
        'available',
      );
      expect(mockTxWhereHasLegacySeatFallback(updateCalls)).toBe(true);
    });
  });

  describe('deadline', () => {
    it('should reject cancellation after deadline', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);

      mockDb.transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => Promise<void>) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue({
            rows: [{
              id: reservationId,
              user_id: userId,
              showtime_id: randomUUID(),
              status: 'CONFIRMED',
              cancel_deadline: pastDeadline,
            }],
          }),
        };
        return cb(mockTx);
      });

      await expect(service.cancelReservation(reservationId, userId, '단순 변심'))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirmAndCreateReservation - seat sold marking', () => {
    const userId = randomUUID();
    const reservationId = randomUUID();
    const showtimeId = randomUUID();
    const orderId = 'GRP-20260407-ABCDE';

    function setupConfirmMocks() {
      // 1st select: check existing payment (none)
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      // 2nd select: get reservation by orderId + userId
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: reservationId,
            userId,
            showtimeId,
            tossOrderId: orderId,
            status: 'PENDING_PAYMENT',
            totalAmount: 150000,
          }]),
        }),
      });

      // 3rd select: pending reservation seats for ownership assertion/consume
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)),
        }),
      });

      // Track all tx operations
      const txOps: { operation: string; args: unknown[] }[] = [];
      const mockTx = {
        execute: vi.fn().mockResolvedValue(ticketLimitResult()),
        update: vi.fn().mockImplementation((...args: unknown[]) => {
          txOps.push({ operation: 'update', args });
          const updateWhere = vi.fn().mockImplementation((...whereArgs: unknown[]) => {
            txOps.push({ operation: 'where', args: whereArgs });
            return {
              returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
            };
          });
          return {
            set: vi.fn().mockReturnValue({
              where: updateWhere,
            }),
          };
        }),
        insert: vi.fn().mockImplementation((...args: unknown[]) => {
          txOps.push({ operation: 'insert', args });
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
              }),
            }),
          };
        }),
        select: vi.fn().mockImplementation(() => {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)),
            }),
          };
        }),
      };

      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
        return cb(mockTx);
      });

      // getReservationDetail mocks (called at the end of confirm)
      // select reservation join
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{
                  reservation: {
                    id: reservationId,
                    userId,
                    reservationNumber: 'GRP-20260407-ABCDE',
                    status: 'CONFIRMED',
                    totalAmount: 150000,
                    cancelDeadline: new Date(),
                    cancelledAt: null,
                    cancelReason: null,
                    createdAt: new Date(),
                  },
                  showtime: { dateTime: new Date() },
                  performance: { title: '테스트 공연', posterUrl: null },
                  venue: { name: '테스트 극장' },
                }]),
              }),
            }),
          }),
        }),
      });

      // select reservation seats
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)),
        }),
      });

      // select payment
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            paymentKey: 'pk_test_123',
            method: '카드',
            paidAt: new Date(),
          }]),
        }),
      });

      // select ticket items for reservation detail
      mockDb.select.mockReturnValueOnce(chainResult([]));

      // select user email delivery context
      mockDb.select.mockReturnValueOnce(chainResult([{
        email: 'buyer@example.com',
        isEmailVerified: true,
      }]));

      return { mockTx, txOps };
    }

    it('should update seat_inventories to sold within the transaction', async () => {
      const { mockTx } = setupConfirmMocks();

      await service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      );

      // tx.update should be called for reservation status AND seat_inventories (at least 3 calls: 1 for reservation + 2 for seats)
      expect(mockTx.update.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(mockBookingService.assertOwnedSeatLocks.mock.invocationCallOrder[0])
        .toBeLessThan(mockDb.transaction.mock.invocationCallOrder[0]!);
      expect(mockDb.transaction.mock.invocationCallOrder[0])
        .toBeLessThan(mockBookingService.consumeOwnedSeatLocks.mock.invocationCallOrder[0]!);
    });

    it('marks pending seats sold only from available inventory state', async () => {
      const { txOps } = setupConfirmMocks();

      await service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      );

      const availableSeatPredicates = txOps.filter(({ operation, args }) =>
        operation === 'where'
        && args.some((arg) => sqlPredicateHasParamValue(arg, 'available')),
      );
      expect(availableSeatPredicates).toHaveLength(2);
    });

    it('should not call BookingService.unlockAllSeats after confirm success', async () => {
      setupConfirmMocks();

      await service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      );

      expect(mockBookingService.unlockAllSeats).not.toHaveBeenCalledWith(userId, showtimeId);
    });

    it('should call BookingGateway.broadcastSeatUpdate with sold for each seat', async () => {
      setupConfirmMocks();

      await service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      );

      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, '1F:A-1', 'sold', userId);
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, '1F:A-2', 'sold', userId);
    });
  });

  describe('confirmAndCreateReservation - lock ownership', () => {
    const userId = randomUUID();
    const reservationId = randomUUID();
    const showtimeId = randomUUID();
    const orderId = 'GRP-LOCK-CONFIRM-ABCDE';

    it('confirmAndCreateReservation rejects disabled booking before confirm lock and Toss confirm', async () => {
      mockFeatureFlags.getFlags.mockReturnValue({ bookingEnabled: false });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow(ForbiddenException);
      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('예매는 추후 오픈 예정입니다');

      expect(mockBookingService.acquirePaymentConfirmLock).not.toHaveBeenCalled();
      expect(mockBookingService.refreshPaymentConfirmLock).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('confirmAndCreateReservation lets admin actor bypass disabled booking flag and reach confirm lock validation', async () => {
      mockFeatureFlags.getFlags.mockReturnValue({ bookingEnabled: false });
      mockBookingService.acquirePaymentConfirmLock.mockResolvedValueOnce(false);

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        { id: userId, role: 'admin', isEmailVerified: true, isPhoneVerified: true },
      )).rejects.toThrow('결제 확인이 이미 진행 중입니다.');

      expect(mockFeatureFlags.assertBookingEnabled).toHaveBeenCalledWith({
        id: userId,
        role: 'admin',
        isEmailVerified: true,
        isPhoneVerified: true,
      });
      expect(mockBookingService.acquirePaymentConfirmLock).toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('confirmAndCreateReservation rejects unverified actors before confirm lock and Toss confirm', async () => {
      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        { id: userId, isEmailVerified: false, isPhoneVerified: true },
      )).rejects.toThrow(BOOKING_VERIFICATION_REQUIRED_MESSAGE);

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        { id: userId, isEmailVerified: true, isPhoneVerified: false },
      )).rejects.toThrow(BOOKING_VERIFICATION_REQUIRED_MESSAGE);

      expect(mockBookingService.acquirePaymentConfirmLock).not.toHaveBeenCalled();
      expect(mockBookingService.refreshPaymentConfirmLock).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rejects concurrent confirm for the same orderId before reading payment state', async () => {
      mockBookingService.acquirePaymentConfirmLock.mockResolvedValueOnce(false);

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('결제 확인이 이미 진행 중입니다.');

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockBookingService.releasePaymentConfirmLock).not.toHaveBeenCalled();
    });

    it('rejects cancelled reservation instead of treating it as confirmed', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'CANCELLED',
          totalAmount: 150000,
        }]));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow(LOCK_EXPIRED_MESSAGE);

      expect(mockBookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('rejects redirect amount tampering before Toss confirm succeeds', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          paymentDeadlineAt: new Date('2099-05-08T07:07:00.000Z'),
          admissionActiveUntilAt: new Date('2099-05-08T07:10:00.000Z'),
          reentryGraceUntilAt: new Date('2099-05-08T07:13:00.000Z'),
        }]))
        .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 149000 },
        userId,
      )).rejects.toThrow('금액이 일치하지 않습니다');

      expect(mockBookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
    });

    it('rejects pre-existing DONE payment when stored amount does not match the reservation', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([{
          id: 'payment-existing',
          reservationId,
          tossOrderId: orderId,
          paymentKey: 'pay_async_1',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 149000,
          status: 'DONE',
          paidAt: new Date('2026-05-08T07:06:30.000Z'),
        }]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          paymentDeadlineAt: new Date('2099-05-08T07:07:00.000Z'),
          admissionActiveUntilAt: new Date('2099-05-08T07:10:00.000Z'),
          reentryGraceUntilAt: new Date('2099-05-08T07:13:00.000Z'),
        }]))
        .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pay_async_1', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('금액이 일치하지 않습니다');

      expect(mockBookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rejects pre-existing DONE payment when paymentKey does not match the request', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([{
          id: 'payment-existing',
          reservationId,
          tossOrderId: orderId,
          paymentKey: 'other_payment_key',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 150000,
          status: 'DONE',
          paidAt: new Date('2026-05-08T07:06:30.000Z'),
        }]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          paymentDeadlineAt: new Date('2099-05-08T07:07:00.000Z'),
          admissionActiveUntilAt: new Date('2099-05-08T07:10:00.000Z'),
          reentryGraceUntilAt: new Date('2099-05-08T07:13:00.000Z'),
        }]))
        .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pay_async_1', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('결제 정보가 예매와 일치하지 않습니다');

      expect(mockBookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('confirmAndCreateReservation extends locks before Toss confirm and rejects invalid locks', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockBookingService.extendOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException(LOCK_EXPIRED_MESSAGE),
      );
      mockDb.transaction.mockResolvedValue(undefined);
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow(LOCK_EXPIRED_MESSAGE);

      expect(mockBookingService.extendOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2'], 60);
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('cancels Toss and does not mark sold when lock ownership is lost after Toss confirm', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockBookingService.assertOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException(LOCK_EXPIRED_MESSAGE),
      );

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow(LOCK_EXPIRED_MESSAGE);

      expect(mockBookingService.extendOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2'], 60);
      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2']);
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_test_123',
        '좌석 점유 만료로 인한 자동 취소',
        {
          idempotencyKey: 'reservation-finalization-cancel:GRP-20260403-ABCDE',
          secretKeyScope: 'default',
        },
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('cancels Toss and rejects when the order confirm lock is lost after Toss confirm', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockBookingService.refreshPaymentConfirmLock
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('결제 확인이 이미 진행 중입니다.');

      expect(mockBookingService.extendOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2'], 60);
      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_test_123',
        '결제 확인 중복 처리로 인한 자동 취소',
        {
          idempotencyKey: 'reservation-finalization-cancel:GRP-20260403-ABCDE',
          secretKeyScope: 'default',
        },
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('surfaces manual refund error when compensation cancel fails after Toss confirm', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockBookingService.refreshPaymentConfirmLock
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockTossClient.cancelPayment.mockRejectedValueOnce(new Error('Toss cancel failed'));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('결제는 승인되었으나 자동 취소에 실패했습니다. 고객센터에 문의해주세요.');

      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_test_123',
        '결제 확인 중복 처리로 인한 자동 취소',
        {
          idempotencyKey: 'reservation-finalization-cancel:GRP-20260403-ABCDE',
          secretKeyScope: 'default',
        },
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('cancels Toss and rejects when confirm lock refresh throws after Toss confirm', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockBookingService.refreshPaymentConfirmLock
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Redis eval failed'));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow(InternalServerErrorException);

      expect(mockBookingService.extendOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2'], 60);
      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_test_123',
        '결제 확인 상태 검증 실패로 인한 자동 취소',
        {
          idempotencyKey: 'reservation-finalization-cancel:GRP-20260403-ABCDE',
          secretKeyScope: 'default',
        },
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('does not cancel Toss when post-commit lock cleanup fails', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockDb.transaction.mockResolvedValue(undefined);
      mockBookingService.consumeOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException(LOCK_OTHER_OWNER_MESSAGE),
      );
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockBookingService.extendOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2'], 60);
      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2']);
      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(mockBookingService.consumeOwnedSeatLocks).toHaveBeenCalledWith(
        userId,
        showtimeId,
        ['1F:A-1', '1F:A-2'],
        { skipUnavailableCheck: true },
      );
      expect(mockDb.transaction.mock.invocationCallOrder[0])
        .toBeLessThan(mockBookingService.consumeOwnedSeatLocks.mock.invocationCallOrder[0]!);
      expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, '1F:A-1', 'sold', userId);
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, '1F:A-2', 'sold', userId);
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('cancels existing DONE payment and rejects when final sold transition detects an unavailable seat', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([{
          id: 'payment-existing',
          reservationId,
          tossOrderId: orderId,
          paymentKey: 'pay_async_1',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 150000,
          status: 'DONE',
          paidAt: new Date('2026-05-08T07:06:30.000Z'),
        }]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          paymentDeadlineAt: new Date('2099-05-08T07:07:00.000Z'),
          admissionActiveUntilAt: new Date('2099-05-08T07:10:00.000Z'),
          reentryGraceUntilAt: new Date('2099-05-08T07:13:00.000Z'),
        }]))
        .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)))
        .mockReturnValueOnce(chainResult([{ reservationId, tossOrderId: orderId }]));

      const mockTx = {
        execute: vi.fn().mockResolvedValue(ticketLimitResult()),
        update: vi.fn()
          .mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          })
          .mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          })
          .mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
      const rootUpdate = mockRootUpdateChain();
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pay_async_1', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('판매 불가능한 좌석입니다');

      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_async_1',
        expect.stringContaining('판매 불가능'),
        {
          cancelRequestId: 'cancel_payment-existing',
          idempotencyKey: 'reservation-finalization-cancel:GRP-LOCK-CONFIRM-ABCDE',
          secretKeyScope: 'foreign-easy-pay',
        },
      );
      expect(rootUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'CANCELED',
        cancelReason: expect.stringContaining('판매 불가능'),
      }));
      expect(rootUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'FAILED',
      }));
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
    });

    it('cancels existing DONE payment and expires reservation when disabled seats fail before finalization', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([{
          id: 'payment-existing',
          reservationId,
          tossOrderId: orderId,
          paymentKey: 'pay_async_1',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 150000,
          status: 'DONE',
          paidAt: new Date('2026-05-08T07:06:30.000Z'),
        }]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          paymentDeadlineAt: new Date('2099-05-08T07:07:00.000Z'),
          admissionActiveUntilAt: new Date('2099-05-08T07:10:00.000Z'),
          reentryGraceUntilAt: new Date('2099-05-08T07:13:00.000Z'),
        }]))
        .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)));
      mockBookingService.extendOwnedSeatLocks.mockRejectedValueOnce(
        new ConflictException('운영자가 비활성화한 좌석입니다'),
      );
      const rootUpdate = mockRootUpdateChain();

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pay_async_1', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('운영자가 비활성화한 좌석입니다');

      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_async_1',
        expect.stringContaining('판매 불가능'),
        {
          cancelRequestId: 'cancel_payment-existing',
          idempotencyKey: 'reservation-finalization-cancel:GRP-LOCK-CONFIRM-ABCDE',
          secretKeyScope: 'foreign-easy-pay',
        },
      );
      expect(rootUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'CANCELED',
        cancelReason: expect.stringContaining('판매 불가능'),
      }));
      expect(rootUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'FAILED',
      }));
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('cancels Toss and rejects when conditional sold transition detects an already sold seat', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });

      const mockTx = {
        execute: vi.fn().mockResolvedValue(ticketLimitResult()),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
            returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
          }),
        }),
      };
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
      mockDb.select.mockReturnValueOnce(chainResult([]));

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('판매 불가능한 좌석입니다');

      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pk_test_123',
        expect.stringContaining('판매 불가능'),
        {
          idempotencyKey: 'reservation-finalization-cancel:GRP-20260403-ABCDE',
          secretKeyScope: 'default',
        },
      );
      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2']);
      expect(mockBookingService.assertOwnedSeatLocks.mock.invocationCallOrder[0])
        .toBeLessThan(mockDb.transaction.mock.invocationCallOrder[0]!);
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('does not cancel Toss when a duplicate payment insert race already committed the same order', async () => {
      setupConfirmReservationBase({
        reservationId,
        showtimeId,
        orderId,
        userId,
        amount: 150000,
      });
      mockDb.transaction.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
      mockDb.select.mockReturnValueOnce(chainResult([{ reservationId, tossOrderId: orderId }]));
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockTossClient.confirmPayment).toHaveBeenCalledOnce();
      expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2']);
      expect(mockBookingService.assertOwnedSeatLocks.mock.invocationCallOrder[0])
        .toBeLessThan(mockDb.transaction.mock.invocationCallOrder[0]!);
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('cancels existing DONE payment when async recovery transaction fails generically', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([{
          id: 'payment-existing',
          reservationId,
          tossOrderId: orderId,
          paymentKey: 'pay_async_1',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
          amount: 150000,
          status: 'DONE',
          paidAt: new Date('2026-05-08T07:06:30.000Z'),
        }]))
        .mockReturnValueOnce(chainResult([{
          id: reservationId,
          userId,
          showtimeId,
          tossOrderId: orderId,
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          paymentDeadlineAt: new Date('2099-05-08T07:07:00.000Z'),
          admissionActiveUntilAt: new Date('2099-05-08T07:10:00.000Z'),
          reentryGraceUntilAt: new Date('2099-05-08T07:13:00.000Z'),
        }]))
        .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)))
        .mockReturnValueOnce(chainResult([{ reservationId, tossOrderId: orderId }]));
      mockDb.transaction.mockRejectedValueOnce(new Error('db write failed after captured payment'));
      const rootUpdate = mockRootUpdateChain();
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pay_async_1', orderId, amount: 150000 },
        userId,
      )).rejects.toThrow('결제는 승인되었으나 처리 중 오류가 발생했습니다');

      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith(
        'pay_async_1',
        '서버 오류로 인한 자동 취소',
        {
          cancelRequestId: 'cancel_payment-existing',
          idempotencyKey: 'reservation-finalization-cancel:GRP-LOCK-CONFIRM-ABCDE',
          secretKeyScope: 'foreign-easy-pay',
        },
      );
      expect(rootUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'CANCELED',
        cancelReason: '서버 오류로 인한 자동 취소',
      }));
      expect(rootUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'FAILED',
      }));
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('existing payment idempotency returns detail without active lock ownership check', async () => {
      mockDb.select
        .mockReturnValueOnce(chainResult([{ reservationId, tossOrderId: orderId }]));
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(service.confirmAndCreateReservation(
        { paymentKey: 'pk_test_123', orderId, amount: 150000 },
        userId,
      )).resolves.toMatchObject({ id: reservationId });

      expect(mockBookingService.extendOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingService.assertOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockBookingService.consumeOwnedSeatLocks).not.toHaveBeenCalled();
      expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
      const lockToken = mockBookingService.acquirePaymentConfirmLock.mock.calls[0]?.[1];
      expect(mockBookingService.refreshPaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
      expect(mockBookingService.releasePaymentConfirmLock).toHaveBeenCalledWith(orderId, lockToken);
    });

    it('completes reservation from async DONE payment after 7-minute deadline but before 10-minute admission expiry', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-08T07:08:00.000Z');
      vi.setSystemTime(now);

      try {
        mockDb.select
          .mockReturnValueOnce(chainResult([{
            id: 'payment-existing',
            reservationId,
            tossOrderId: orderId,
            paymentKey: 'pay_async_1',
            method: 'FOREIGN_EASY_PAY',
            provider: 'ALIPAY_PLUS',
            currency: 'USD',
            amount: 150000,
            status: 'DONE',
            paidAt: new Date('2026-05-08T07:06:30.000Z'),
          }]))
          .mockReturnValueOnce(chainResult([{
            id: reservationId,
            userId,
            showtimeId,
            tossOrderId: orderId,
            status: 'PENDING_PAYMENT',
            totalAmount: 150000,
            paymentDeadlineAt: new Date('2026-05-08T07:07:00.000Z'),
            admissionActiveUntilAt: new Date('2026-05-08T07:10:00.000Z'),
            reentryGraceUntilAt: new Date('2026-05-08T07:13:00.000Z'),
          }]))
          .mockReturnValueOnce(chainResult(reservationSeatRowsForAmount(['A-1', 'A-2'], 150000)));

        const mockTx = {
          execute: vi.fn().mockResolvedValue(ticketLimitResult()),
          update: vi.fn().mockImplementation(() => ({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
              }),
            }),
          })),
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
              }),
            }),
          })),
        };
        mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
        setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

        await expect(service.confirmAndCreateReservation(
          { paymentKey: 'pay_async_1', orderId, amount: 150000 },
          userId,
        )).resolves.toMatchObject({ id: reservationId });

        expect(mockTossClient.confirmPayment).not.toHaveBeenCalled();
        expect(mockBookingService.extendOwnedSeatLocks).toHaveBeenCalledWith(userId, showtimeId, ['1F:A-1', '1F:A-2'], 60);
        expect(mockDb.transaction).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getReservationDetail - QR cutover contract', () => {
    const userId = randomUUID();
    const reservationId = randomUUID();

    it('self-heals a confirmed DONE payment by issuing active QR tickets for every ticket item on the read path', async () => {
      const qrTicketService = {
        ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000201',
            ticketItemId: '00000000-0000-4000-8000-000000000101',
            token: 'signed-qr-token-a1',
            jti: 'qr-jti-a1',
            status: 'ACTIVE',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-07-10T09:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
          {
            id: '00000000-0000-4000-8000-000000000202',
            ticketItemId: '00000000-0000-4000-8000-000000000102',
            token: 'signed-qr-token-a2',
            jti: 'qr-jti-a2',
            status: 'ACTIVE',
            entryStatus: 'ENTERED',
            enteredAt: '2026-07-10T09:05:00.000Z',
            issuedAt: '2026-07-10T09:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        ]),
      };
      const qrAwareService = createServiceWithQrTicketService(qrTicketService);
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(qrAwareService.getReservationDetail(reservationId, userId))
        .resolves
        .toMatchObject({
          id: reservationId,
          qrTicket: {
            token: 'signed-qr-token-a1',
            jti: 'qr-jti-a1',
            status: 'ACTIVE',
          },
          ticketItems: [
            {
              id: '00000000-0000-4000-8000-000000000101',
              seatKey: '1F:A-1',
              admissionState: 'NOT_ENTERED',
              qrCredential: {
                id: '00000000-0000-4000-8000-000000000201',
                token: 'signed-qr-token-a1',
                jti: 'qr-jti-a1',
                status: 'ACTIVE',
              },
            },
            {
              id: '00000000-0000-4000-8000-000000000102',
              seatKey: '1F:A-2',
              admissionState: 'ENTERED',
              enteredAt: '2026-07-10T09:05:00.000Z',
              qrCredential: {
                id: '00000000-0000-4000-8000-000000000202',
                token: 'signed-qr-token-a2',
                jti: 'qr-jti-a2',
                status: 'ACTIVE',
              },
            },
          ],
        });

      expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId: 'payment-1',
      });
    });

    it('marks social placeholder emails as verification-required for ticket email delivery', async () => {
      const qrTicketService = {
        ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000201',
            ticketItemId: '00000000-0000-4000-8000-000000000101',
            token: 'signed-qr-token-a1',
            jti: 'qr-jti-a1',
            status: 'ACTIVE',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-07-10T09:00:00.000Z',
            emailScheduledAt: '2026-07-17T10:00:00.000Z',
            emailedAt: null,
          },
        ]),
      };
      const qrAwareService = createServiceWithQrTicketService(qrTicketService);
      setupReservationDetailMocks({
        reservationId,
        userId,
        amount: 150000,
        userEmail: 'kakao_123@social.grabit.com',
        isEmailVerified: true,
      });

      const detail = await qrAwareService.getReservationDetail(reservationId, userId);

      expect(detail.ticketEmailDelivery).toEqual({
        email: 'kakao_123@social.grabit.com',
        isEmailVerified: true,
        isPlaceholderEmail: true,
        canSend: false,
        status: 'verification_required',
        scheduledAt: '2026-07-17T10:00:00.000Z',
        lastSentAt: null,
      });
    });

    it('maps cancellation-pending ticket items without issuing or exposing QR credentials', async () => {
      const qrTicketService = {
        ensureIssuedTicketsForReservation: vi.fn(),
      };
      const qrAwareService = createServiceWithQrTicketService(qrTicketService);
      setupReservationDetailMocks({
        reservationId,
        userId,
        amount: 79000,
        seats: ['1F:A-1'],
        ticketItems: [{
          ...ticketItemRowsForReservation({
            reservationId,
            seats: ['1F:A-1'],
            amount: 79000,
          })[0]!,
          status: 'cancellation_pending',
          cancelledAt: new Date('2026-05-22T06:10:00.000Z'),
          cancelReason: '단순 변심',
          cancellationFee: 0,
          serviceFeeRefund: TICKET_SERVICE_FEE_KRW,
          refundableAmount: 79000,
          reopenState: 'held_cancelled',
        }],
      });

      await expect(qrAwareService.getReservationDetail(reservationId, userId))
        .resolves
        .toMatchObject({
          qrTicket: {
            status: 'REVOKED',
            token: '',
          },
          ticketItems: [
            {
              status: 'CANCELLATION_PENDING',
              qrCredential: null,
              cancellation: {
                refundStatus: 'PROCESSING_AT_PG',
                reopenState: 'HELD_CANCELLED',
              },
            },
          ],
        });

      expect(qrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('loads reservation detail with entered QR ticket after field check-in', async () => {
      const qrTicketService = {
        ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000201',
            ticketItemId: '00000000-0000-4000-8000-000000000101',
            token: 'signed-qr-token',
            jti: 'qr-jti-1',
            status: 'ACTIVE',
            entryStatus: 'ENTERED',
            enteredAt: '2026-07-10T09:05:00.000Z',
            issuedAt: '2026-07-10T09:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        ]),
      };
      const qrAwareService = createServiceWithQrTicketService(qrTicketService);
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(qrAwareService.getReservationDetail(reservationId, userId))
        .resolves
        .toMatchObject({
          id: reservationId,
          qrTicket: {
            token: 'signed-qr-token',
            jti: 'qr-jti-1',
            status: 'ACTIVE',
            entryStatus: 'ENTERED',
            enteredAt: '2026-07-10T09:05:00.000Z',
          },
        });

      expect(qrTicketService.ensureIssuedTicketsForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId: 'payment-1',
      });
    });

    it('does not expose a false ACTIVE QR state when confirmed reservation has no DONE payment', async () => {
      const qrTicketService = {
        ensureIssuedTicketsForReservation: vi.fn().mockResolvedValue([{
          id: '00000000-0000-4000-8000-000000000201',
          ticketItemId: '00000000-0000-4000-8000-000000000101',
          token: 'signed-qr-token',
          jti: 'qr-jti-1',
          status: 'ACTIVE',
          issuedAt: '2026-07-10T09:00:00.000Z',
          emailScheduledAt: null,
          emailedAt: null,
        }]),
      };
      const qrAwareService = createServiceWithQrTicketService(qrTicketService);
      setupReservationDetailMocks({
        reservationId,
        userId,
        amount: 150000,
        paymentStatus: 'IN_PROGRESS',
      });

      const detail = await qrAwareService.getReservationDetail(reservationId, userId);

      expect(detail.qrTicket).toMatchObject({
        token: '',
        jti: '',
        status: 'REVOKED',
      });
      expect(qrTicketService.ensureIssuedTicketsForReservation).not.toHaveBeenCalled();
    });

    it('keeps confirmed reservation detail in a blocking non-active QR state when QR runtime wiring is unavailable', async () => {
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      const detail = await service.getReservationDetail(reservationId, userId);

      expect(detail.qrTicket).toMatchObject({
        token: '',
        jti: '',
        status: 'REVOKED',
      });
    });
  });

  describe('cancelReservation - seat available restoration', () => {
    it('should update seat_inventories to available within cancel transaction', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const showtimeId = randomUUID();
      const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Track tx operations
      const mockTx = {
        execute: vi.fn().mockResolvedValue({
          rows: [{
            id: reservationId,
            user_id: userId,
            showtime_id: showtimeId,
            status: 'CONFIRMED',
            cancel_deadline: futureDeadline,
          }],
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        select: vi.fn().mockReturnValueOnce(chainResult([])).mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{
              id: randomUUID(),
              paymentKey: 'pk_test_123',
            }]),
          }),
        }).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { seatId: 'A-1' },
              { seatId: 'A-2' },
            ]),
          }),
        }),
      };

      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
        return cb(mockTx);
      });

      // After-transaction select for WS broadcast
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { seatId: 'A-1' },
            { seatId: 'A-2' },
          ]),
        }),
      });

      await service.cancelReservation(reservationId, userId, '단순 변심');

      // tx.execute should have been called for SELECT FOR UPDATE
      expect(mockTx.execute).toHaveBeenCalled();
      // tx.update should be called for reservation, payment, AND seat_inventories (at least 4: reservation + payment + 2 seats)
      expect(mockTx.update.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should call BookingGateway.broadcastSeatUpdate with available for each cancelled seat', async () => {
      const reservationId = randomUUID();
      const userId = randomUUID();
      const showtimeId = randomUUID();
      const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const mockTx = {
        execute: vi.fn().mockResolvedValue({
          rows: [{
            id: reservationId,
            user_id: userId,
            showtime_id: showtimeId,
            status: 'CONFIRMED',
            cancel_deadline: futureDeadline,
          }],
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        select: vi.fn().mockReturnValueOnce(chainResult([])).mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{
              id: randomUUID(),
              paymentKey: 'pk_test_123',
            }]),
          }),
        }).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { seatId: 'B-1' },
              { seatId: 'B-2' },
            ]),
          }),
        }),
      };

      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
        return cb(mockTx);
      });

      // After-transaction select for WS broadcast
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { seatId: 'B-1' },
            { seatId: 'B-2' },
          ]),
        }),
      });

      await service.cancelReservation(reservationId, userId, '단순 변심');

      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, 'B-1', 'available');
      expect(mockBookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, 'B-2', 'available');
    });
  });
});
