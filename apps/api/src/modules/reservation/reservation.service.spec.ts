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
import type { ConsentCaptureItem, SeatSelection } from '@grabit/shared';
import type { ConsentService } from '../consent/consent.service.js';

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
    confirmPayment: vi.fn().mockResolvedValue({
      paymentKey: 'pk_test_123',
      orderId: 'GRP-20260403-ABCDE',
      method: '카드',
      totalAmount: 150000,
      status: 'DONE',
      approvedAt: '2026-04-03T10:00:00+09:00',
    }),
    cancelPayment: vi.fn().mockResolvedValue({
      paymentKey: 'pk_test_123',
      orderId: 'GRP-20260403-ABCDE',
      method: '카드',
      totalAmount: 150000,
      status: 'CANCELED',
      approvedAt: '2026-04-03T10:00:00+09:00',
      cancels: [{ cancelAmount: 150000, cancelReason: '단순 변심', canceledAt: '2026-04-03T11:00:00+09:00' }],
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

describe('ReservationService', () => {
  let service: ReservationService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTossClient: ReturnType<typeof createMockTossClient>;
  let mockBookingService: ReturnType<typeof createMockBookingService>;
  let mockBookingGateway: ReturnType<typeof createMockBookingGateway>;
  let mockFeatureFlags: ReturnType<typeof createMockFeatureFlags>;
  let mockConsentService: ReturnType<typeof createMockConsentService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockTossClient = createMockTossClient();
    mockBookingService = createMockBookingService();
    mockBookingGateway = createMockBookingGateway();
    mockFeatureFlags = createMockFeatureFlags(true);
    mockConsentService = createMockConsentService();

    service = new ReservationService(
      mockDb as any,
      mockTossClient as unknown as TossPaymentsClient,
      mockBookingService as unknown as BookingService,
      mockBookingGateway as unknown as BookingGateway,
      mockFeatureFlags as unknown as FeatureFlagsService,
      mockConsentService as unknown as ConsentService,
    );
  });

  function createServiceWithQrTicketService(qrTicketService: {
    ensureIssuedTicketForReservation?: ReturnType<typeof vi.fn>;
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

  function sqlPredicateHasParamValue(predicate: unknown, value: string): boolean {
    const candidate = predicate as {
      constructor?: { name?: string };
      queryChunks?: unknown[];
      value?: unknown;
    };

    if (candidate.constructor?.name === 'Param') {
      return candidate.value === value;
    }

    if (!Array.isArray(candidate.queryChunks)) {
      return false;
    }

    return candidate.queryChunks.some((chunk) => sqlPredicateHasParamValue(chunk, value));
  }

  function setupPrepareBase(dto: {
    showtimeId: string;
    orderId: string;
    seats: SeatSelection[];
    amount: number;
    performanceStatus?: string;
  }) {
    mockDb.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([{
        id: dto.showtimeId,
        performanceId: 'performance-1',
        performanceStatus: dto.performanceStatus ?? 'selling',
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
    const amount = dto.amount ?? seats.length * 50000;
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
      .mockReturnValueOnce(chainResult(seats.map((seatId) => ({ seatId }))));
  }

  function setupReservationDetailMocks(args: {
    reservationId: string;
    userId: string;
    amount: number;
    status?: string;
    paymentStatus?: string;
    seats?: string[];
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
      }]));
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
      expect(result).toBe(280000); // 100000 + 100000 + 80000
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
        .toBe(180000);
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
        .toBe(123000);
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
        amount: 100000,
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

    it('prepareReservation checks active locks before creating a new pending reservation', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-LOCK-PREPARE-SUCCESS',
        seats: [seatSelection('A-1'), seatSelection('A-2')],
        amount: 100000,
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
          amount: 50000,
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

    it('prepareReservation stores canonical tierName and price from seat map config', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-CANONICAL-SEATS',
        seats: [{ seatId: 'A-1', tierName: 'R', price: 1, row: 'client', number: '999' }],
        amount: 100000,
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
        amount: 100000,
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

    it('prepareReservation writes booking consent audit in the pending reservation transaction', async () => {
      const userId = randomUUID();
      const dto = {
        showtimeId: randomUUID(),
        orderId: 'GRP-BOOKING-CONSENT-AUDIT',
        seats: [seatSelection('A-1')],
        amount: 50000,
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
        amount: 50000,
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
        amount: 50000,
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
        amount: 100000,
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
          select: vi.fn().mockReturnValueOnce({
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
          where: vi.fn().mockResolvedValue([
            { seatId: 'A-1' },
            { seatId: 'A-2' },
          ]),
        }),
      });

      // Track all tx operations
      const txOps: { operation: string; args: unknown[] }[] = [];
      const mockTx = {
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
              where: vi.fn().mockResolvedValue([
                { seatId: 'A-1' },
                { seatId: 'A-2' },
              ]),
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
          where: vi.fn().mockResolvedValue([
            { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
            { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
          ]),
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
        }]));

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
        }]));

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
        }]));

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
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith('pk_test_123', '좌석 점유 만료로 인한 자동 취소');
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
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith('pk_test_123', '결제 확인 중복 처리로 인한 자동 취소');
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
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith('pk_test_123', '결제 확인 중복 처리로 인한 자동 취소');
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
      expect(mockTossClient.cancelPayment).toHaveBeenCalledWith('pk_test_123', '결제 확인 상태 검증 실패로 인한 자동 취소');
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
        .mockReturnValueOnce(chainResult([
          { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
        ]))
        .mockReturnValueOnce(chainResult([{ reservationId, tossOrderId: orderId }]));

      const mockTx = {
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
        .mockReturnValueOnce(chainResult([
          { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
        ]));
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
        .mockReturnValueOnce(chainResult([
          { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
          { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
        ]))
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
          .mockReturnValueOnce(chainResult([
            { seatId: 'A-1', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
            { seatId: 'A-2', tierName: 'VIP', price: 50000, row: 'A', number: '2' },
          ]));

        const mockTx = {
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

    it('self-heals a confirmed DONE payment by issuing an active QR ticket on the read path', async () => {
      const qrTicketService = {
        getOrIssueTicketForReservation: vi.fn().mockResolvedValue({
          token: 'signed-qr-token',
          jti: 'qr-jti-1',
          status: 'ACTIVE',
          issuedAt: '2026-07-10T09:00:00.000Z',
          emailScheduledAt: null,
          emailedAt: null,
        }),
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
          },
        });

      expect(qrTicketService.getOrIssueTicketForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId: 'payment-1',
      });
    });

    it('loads reservation detail with used QR ticket after field check-in', async () => {
      const qrTicketService = {
        getOrIssueTicketForReservation: vi.fn().mockResolvedValue({
          token: '',
          jti: '',
          status: 'USED',
          issuedAt: '2026-07-10T09:00:00.000Z',
          emailScheduledAt: null,
          emailedAt: null,
        }),
      };
      const qrAwareService = createServiceWithQrTicketService(qrTicketService);
      setupReservationDetailMocks({ reservationId, userId, amount: 150000 });

      await expect(qrAwareService.getReservationDetail(reservationId, userId))
        .resolves
        .toMatchObject({
          id: reservationId,
          qrTicket: {
            token: '',
            jti: '',
            status: 'USED',
          },
        });

      expect(qrTicketService.getOrIssueTicketForReservation).toHaveBeenCalledWith({
        reservationId,
        paymentId: 'payment-1',
      });
    });

    it('does not expose a false ACTIVE QR state when confirmed reservation has no DONE payment', async () => {
      const qrTicketService = {
        getOrIssueTicketForReservation: vi.fn().mockResolvedValue({
          token: 'signed-qr-token',
          jti: 'qr-jti-1',
          status: 'ACTIVE',
          issuedAt: '2026-07-10T09:00:00.000Z',
          emailScheduledAt: null,
          emailedAt: null,
        }),
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
      expect(qrTicketService.getOrIssueTicketForReservation).not.toHaveBeenCalled();
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
        select: vi.fn().mockReturnValueOnce({
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
        select: vi.fn().mockReturnValueOnce({
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
