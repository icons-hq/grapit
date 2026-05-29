import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type {
  Banner,
  PerformanceWithDetails,
  PerformanceSeatMapInput,
  PerformanceBookingPolicyInput,
} from '@grabit/shared';
import type {
  CreatePerformanceInput,
  UpdatePerformanceInput,
  CreateBannerInput,
  SeatMapConfigInput,
} from '@grabit/shared/schemas/performance.schema';

import { AdminService } from './admin.service.js';
import { AdminBannerController } from './admin-banner.controller.js';
import { AdminPerformanceController } from './admin-performance.controller.js';
import type { AdminAuditService } from './admin-audit.service.js';
import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import { CatalogFreshnessService } from '../performance/catalog-freshness.service.js';
import {
  banners,
  bookingPolicies,
  performances,
  performanceSeatTiers,
  reservations,
  seatMaps,
  showtimes,
  venues,
  venueLayoutFloors,
  venueLayouts,
  venueLayoutSeats,
} from '../../database/schema/index.js';

function createMockCatalogFreshnessService(): CatalogFreshnessService {
  // Admin mutations trigger invalidate* — mocks swallow them so we can
  // still assert the DB-mutation side effects without an ioredis client.
  return {
    invalidatePerformance: vi.fn().mockResolvedValue(undefined),
    invalidateBanners: vi.fn().mockResolvedValue(undefined),
  } as unknown as CatalogFreshnessService;
}

/**
 * Phase 2 Plan 00: RED-state test stubs for AdminService
 *
 * These tests describe the expected contract for AdminService:
 * - createPerformance: transactional creation with venue + child records
 * - updatePerformance: transactional update with priceTiers replace
 * - deletePerformance: cascade delete
 * - banner CRUD: create, update, delete, reorder
 * - saveSeatMap: upsert seat map for performance
 *
 * Services will be implemented in Plan 02. Tests should turn GREEN then.
 */

function createMockTx() {
  const txChain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'returning'];
  for (const method of methods) {
    txChain[method] = vi.fn().mockReturnValue(txChain);
  }
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  (txChain as { then?: unknown }).then = vi.fn((resolve: (v: unknown[]) => void) =>
    resolve([
      { tierName: 'VIP' },
      { tierName: 'R' },
      { tierName: 'S' },
    ]),
  );
  const buildInsertReturningRow = (
    table: unknown,
    values: Record<string, unknown> | Record<string, unknown>[],
  ) => {
    const row = Array.isArray(values) ? (values[0] ?? {}) : values;

    if (table === venues) {
      return {
        id: 'venue-id-1',
        name: row['name'],
        address: row['address'] ?? null,
        accessNotes: row['accessNotes'] ?? null,
        transportSummary: row['transportSummary'] ?? null,
      };
    }

    if (table === performances) {
      return {
        id: 'new-id',
        title: row['title'] ?? 'Hamlet',
        genre: row['genre'] ?? 'artist_celebrity',
        subcategory: row['subcategory'] ?? null,
        venueId: row['venueId'] ?? 'venue-id-1',
        posterUrl: row['posterUrl'] ?? null,
        description: row['description'] ?? null,
        descriptionVisible: row['descriptionVisible'] ?? true,
        detailImages: row['detailImages'] ?? [],
        startDate: row['startDate'] instanceof Date
          ? row['startDate']
          : new Date('2026-04-01T00:00:00.000Z'),
        endDate: row['endDate'] instanceof Date
          ? row['endDate']
          : new Date('2026-06-30T00:00:00.000Z'),
        runtime: row['runtime'] ?? null,
        ageRating: row['ageRating'] ?? '12+',
        status: row['status'] ?? 'upcoming',
        publishState: row['publishState'] ?? 'draft',
        publishReviewRequestedAt: row['publishReviewRequestedAt'] ?? null,
        publishReadyAt: row['publishReadyAt'] ?? null,
        publishedAt: row['publishedAt'] ?? null,
        publishedByUserId: row['publishedByUserId'] ?? null,
        salesInfo: row['salesInfo'] ?? null,
        salesInfoVisible: row['salesInfoVisible'] ?? true,
        viewCount: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
    }

    return { id: 'new-id', ...row };
  };

  return {
    _updates: updates,
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown> | Record<string, unknown>[]) => {
        const row = buildInsertReturningRow(table, values);

        return {
          returning: vi.fn().mockResolvedValue([row]),
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([row]),
          }),
        };
      }),
    })),
    select: vi.fn().mockReturnValue(txChain),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: 'updated-id',
              title: 'Hamlet - Revised',
              genre: 'artist_celebrity',
              subcategory: null,
              venueId: 'venue-id-1',
              posterUrl: null,
              description: 'Updated description',
              startDate: new Date('2026-04-01T00:00:00.000Z'),
              endDate: new Date('2026-06-30T00:00:00.000Z'),
              runtime: '150min',
              ageRating: '12+',
              status: 'upcoming',
              publishState: values['publishState'] ?? 'draft',
              publishReviewRequestedAt: null,
              publishReadyAt: null,
              publishedAt: values['publishedAt'] ?? null,
              publishedByUserId: values['publishedByUserId'] ?? null,
              salesInfo: null,
              descriptionVisible: values['descriptionVisible'] ?? true,
              salesInfoVisible: values['salesInfoVisible'] ?? true,
              viewCount: 0,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: values['updatedAt'] ?? new Date('2026-01-02T00:00:00.000Z'),
            }]),
          }),
        };
      }),
    })),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  };
}

type SelectResultChain<T> = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
};

function createSelectResultChain<T>(result: T[]): SelectResultChain<T> {
  const chain = {} as SelectResultChain<T>;
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockResolvedValue(result);
  chain.limit = vi.fn().mockResolvedValue(result);
  chain.then = vi.fn((resolve: (value: T[]) => void) => resolve(result));
  return chain;
}

function createMockDb() {
  const mockTx = createMockTx();
  const dbSelectChain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['from', 'where']) {
    dbSelectChain[method] = vi.fn().mockReturnValue(dbSelectChain);
  }
  (dbSelectChain as { then?: unknown }).then = vi.fn((resolve: (v: unknown[]) => void) =>
    resolve([
      { tierName: 'VIP' },
      { tierName: 'R' },
      { tierName: 'S' },
    ]),
  );

  return {
    transaction: vi.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'existing-id' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'updated-id' }]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
    execute: vi.fn().mockResolvedValue({
      rows: [{
        performance_count: 1,
        reservations_count: 0,
        ticket_scan_events_count: 0,
        seat_operation_history_count: 0,
      }],
    }),
    select: vi.fn().mockReturnValue(dbSelectChain),
    _tx: mockTx,
  };
}

function createMockAuditService() {
  return {
    write: vi.fn().mockResolvedValue({ id: 'audit-id-25-08' }),
  } as unknown as AdminAuditService;
}

function findInsertCallIndex(
  tx: ReturnType<typeof createMockTx>,
  table: unknown,
) {
  return tx.insert.mock.calls.findIndex(([arg]) => arg === table);
}

const sampleSeatMaps: PerformanceSeatMapInput[] = [
  {
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: 'https://r2.example.com/seatmaps/1f.svg',
    seatConfig: {
      tiers: [
        { tierName: 'VIP', color: '#FFD700', seatIds: ['A1', 'A2'] },
      ],
    },
    totalSeats: 2,
  },
  {
    floorKey: '2F',
    floorLabel: '2층',
    sortOrder: 1,
    svgUrl: 'https://r2.example.com/seatmaps/2f.svg',
    seatConfig: {
      tiers: [
        { tierName: 'R', color: '#4169E1', seatIds: ['B1'] },
      ],
    },
    totalSeats: 1,
  },
];

const sampleBookingPolicy: PerformanceBookingPolicyInput = {
  maxTicketsPerUser: 1,
  allowedPaymentMethods: ['CARD', 'FOREIGN_EASY_PAY'],
  changePolicyEnabled: false,
  paymentWindowMinutes: 7,
  seatHoldMinutes: 10,
  cancelledSeatHoldMinMinutes: 1,
  cancelledSeatHoldMaxMinutes: 10,
  manualOpenEnabled: true,
};

const adminMutationContext = {
  actorUserId: '11111111-1111-4111-8111-111111111111',
  ipAddress: '198.51.100.10',
  userAgent: 'Vitest Admin Console',
  requestId: 'req-25-08',
};

const bannerMutationContext = {
  actorUserId: '22222222-2222-4222-8222-222222222222',
  ipAddress: '203.0.113.25',
  userAgent: 'Vitest Banner Console',
  requestId: 'req-25-13',
};

const publishReadyContentChecklist = {
  ko: { title: true, description: true },
  en: { title: true, description: true },
};

const sampleCreateInput: CreatePerformanceInput = {
  title: 'Hamlet',
  genre: 'artist_celebrity',
  venueName: 'National Theater',
  venueAddress: 'Seoul, Korea',
  posterUrl: 'https://r2.example.com/posters/hamlet.jpg',
  description: 'Shakespeare classic',
  startDate: '2026-04-01',
  endDate: '2026-06-30',
  runtime: '150min',
  ageRating: '12+',
  priceTiers: [
    { tierName: 'VIP', price: 150000, sortOrder: 0 },
    { tierName: 'R', price: 120000, sortOrder: 1 },
    { tierName: 'S', price: 90000, sortOrder: 2 },
  ],
  showtimes: [
    { dateTime: '2026-04-01T19:00:00Z' },
    { dateTime: '2026-04-02T14:00:00Z' },
  ],
  castings: [
    { actorName: 'Actor A', roleName: 'Hamlet', sortOrder: 0 },
    { actorName: 'Actor B', roleName: 'Ophelia', sortOrder: 1 },
  ],
  seatMaps: [],
  bookingPolicy: {
    maxTicketsPerUser: 1,
    allowedPaymentMethods: ['CARD'],
    changePolicyEnabled: false,
    paymentWindowMinutes: 7,
    seatHoldMinutes: 10,
    cancelledSeatHoldMinMinutes: 1,
    cancelledSeatHoldMaxMinutes: 10,
    manualOpenEnabled: true,
  },
};

function createBannerRow(
  overrides: Partial<{
    id: string;
    imageUrl: string;
    linkUrl: string | null;
    placement: Banner['placement'];
    deviceTarget: Banner['deviceTarget'];
    status: Banner['status'];
    startsAt: Date | null;
    endsAt: Date | null;
    sortOrder: number;
    isActive: boolean;
  }> = {},
) {
  return {
    id: 'banner-id-123',
    imageUrl: 'https://r2.example.com/banners/spring.jpg',
    linkUrl: 'https://www.heygrabit.com/performances/123',
    placement: 'home_hero' as const,
    deviceTarget: 'all' as const,
    status: 'active' as const,
    startsAt: null,
    endsAt: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminService', () => {
  let service: AdminService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockCatalogFreshness: CatalogFreshnessService;
  let mockAudit: AdminAuditService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockCatalogFreshness = createMockCatalogFreshnessService();
    mockAudit = createMockAuditService();
    service = new AdminService(
      mockDb as unknown as ConstructorParameters<typeof AdminService>[0],
      mockCatalogFreshness,
      mockAudit,
    );
  });

  describe('createPerformance', () => {
    it('should create performance with venue in a transaction', async () => {
      await service.createPerformance(sampleCreateInput);

      // When GREEN, should verify db.transaction was called
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should insert priceTiers, showtimes, and castings within transaction', async () => {
      await service.createPerformance(sampleCreateInput);

      const tx = mockDb._tx;
      // When GREEN, should verify INSERT calls for priceTiers, showtimes, castings
      // tx.insert should have been called multiple times (once for each child table)
      expect(tx.insert).toHaveBeenCalled();
    });

    it('should insert-or-find venue by name', async () => {
      await service.createPerformance(sampleCreateInput);

      const tx = mockDb._tx;
      // When GREEN, should verify venues INSERT ON CONFLICT or SELECT by name
      expect(tx.insert).toHaveBeenCalled();
    });

    it('persists floor-aware seatMaps and bookingPolicy in the same transaction', async () => {
      await service.createPerformance({
        ...sampleCreateInput,
        seatMaps: sampleSeatMaps,
        bookingPolicy: sampleBookingPolicy,
      });

      const tx = mockDb._tx;
      expect(findInsertCallIndex(tx, seatMaps)).toBeGreaterThanOrEqual(0);
      expect(findInsertCallIndex(tx, bookingPolicies)).toBeGreaterThanOrEqual(0);
    });

    it('mirrors legacy floor-aware seatMaps into venue layout template and overlay tables', async () => {
      await service.createPerformance({
        ...sampleCreateInput,
        seatMaps: sampleSeatMaps,
      });

      const tx = mockDb._tx;
      expect(findInsertCallIndex(tx, venueLayouts)).toBeGreaterThanOrEqual(0);
      expect(findInsertCallIndex(tx, venueLayoutFloors)).toBeGreaterThanOrEqual(0);
      expect(findInsertCallIndex(tx, venueLayoutSeats)).toBeGreaterThanOrEqual(0);
      expect(findInsertCallIndex(tx, performanceSeatTiers)).toBeGreaterThanOrEqual(0);
    });

    it('persists and returns copy visibility flags independently from copy text', async () => {
      const result = await service.createPerformance({
        ...sampleCreateInput,
        description: '공개하지 않을 상세정보 원문',
        descriptionVisible: false,
        salesInfo: '공개 판매정보',
        salesInfoVisible: true,
      });

      const tx = mockDb._tx;
      const performanceInsertIndex = findInsertCallIndex(tx, performances);
      const insertResult = tx.insert.mock.results[performanceInsertIndex]?.value as {
        values: ReturnType<typeof vi.fn>;
      };

      expect(insertResult.values).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '공개하지 않을 상세정보 원문',
          descriptionVisible: false,
          salesInfo: '공개 판매정보',
          salesInfoVisible: true,
        }),
      );
      expect(result.description).toBe('공개하지 않을 상세정보 원문');
      expect(result.descriptionVisible).toBe(false);
      expect(result.salesInfo).toBe('공개 판매정보');
      expect(result.salesInfoVisible).toBe(true);
    });
  });

  describe('updatePerformance', () => {
    it('should update performance fields in a transaction', async () => {
      const updateInput: UpdatePerformanceInput = {
        title: 'Hamlet - Revised',
        description: 'Updated description',
      };

      await service.updatePerformance('perf-id-123', updateInput);

      // When GREEN, should verify db.transaction called with UPDATE performances
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should replace priceTiers when provided (delete + insert)', async () => {
      const updateInput: UpdatePerformanceInput = {
        priceTiers: [
          { tierName: 'VIP', price: 160000, sortOrder: 0 },
          { tierName: 'R', price: 130000, sortOrder: 1 },
        ],
      };

      await service.updatePerformance('perf-id-123', updateInput);

      const tx = mockDb._tx;
      // When GREEN, should verify DELETE price_tiers WHERE performanceId + INSERT new tiers
      expect(tx.delete).toHaveBeenCalled();
      expect(tx.insert).toHaveBeenCalled();
    });

    it('updates existing showtimes in place when showtimeId is preserved', async () => {
      const tx = mockDb._tx;
      const showtimeId = '11111111-1111-4111-8111-111111111111';
      tx.select.mockReturnValueOnce(
        createSelectResultChain([
          {
            id: showtimeId,
            dateTime: new Date('2026-04-01T10:00:00.000Z'),
          },
        ]),
      );

      await service.updatePerformance('perf-id-123', {
        showtimes: [
          {
            showtimeId,
            dateTime: '2026-04-01T20:00:00',
          },
        ],
      });

      expect(tx.update).toHaveBeenCalledWith(showtimes);
      expect(tx.delete).not.toHaveBeenCalledWith(showtimes);
    });

    it('keeps existing showtime rows for legacy payloads without showtimeId', async () => {
      const tx = mockDb._tx;
      tx.select.mockReturnValueOnce(
        createSelectResultChain([
          {
            id: '22222222-2222-4222-8222-222222222222',
            dateTime: new Date('2026-04-01T10:00:00.000Z'),
          },
        ]),
      );

      await service.updatePerformance('perf-id-123', {
        showtimes: [
          {
            dateTime: '2026-04-01T20:00:00',
          },
        ],
      });

      expect(tx.update).toHaveBeenCalledWith(showtimes);
      expect(tx.delete).not.toHaveBeenCalledWith(showtimes);
    });

    it('rejects removing a showtime that already has reservations', async () => {
      const tx = mockDb._tx;
      tx.select
        .mockReturnValueOnce(
          createSelectResultChain([
            {
              id: '33333333-3333-4333-8333-333333333333',
              dateTime: new Date('2026-04-01T10:00:00.000Z'),
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              dateTime: new Date('2026-04-02T10:00:00.000Z'),
            },
          ]),
        )
        .mockReturnValueOnce(
          createSelectResultChain([
            {
              showtimeId: '44444444-4444-4444-8444-444444444444',
            },
          ]),
        );

      await expect(
        service.updatePerformance('perf-id-123', {
          showtimes: [
            {
              showtimeId: '33333333-3333-4333-8333-333333333333',
              dateTime: '2026-04-01T19:00:00',
            },
          ],
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(tx.select).toHaveBeenCalledWith({
        showtimeId: reservations.showtimeId,
      });
      expect(tx.delete).not.toHaveBeenCalledWith(showtimes);
    });

    it('replaces seatMaps and upserts bookingPolicy without assuming a single floor', async () => {
      const updateInput: UpdatePerformanceInput = {
        seatMaps: sampleSeatMaps,
        bookingPolicy: sampleBookingPolicy,
      };

      await service.updatePerformance('perf-id-123', updateInput);

      const tx = mockDb._tx;
      expect(findInsertCallIndex(tx, seatMaps)).toBeGreaterThanOrEqual(0);
      expect(findInsertCallIndex(tx, bookingPolicies)).toBeGreaterThanOrEqual(0);
      expect(tx.delete).toHaveBeenCalled();
    });

    it('persists deleting all seatMaps and invalidates locale-scoped detail caches', async () => {
      const result = await service.updatePerformance('perf-id-123', {
        seatMaps: [],
      });

      const tx = mockDb._tx;
      expect(tx.delete).toHaveBeenCalled();
      expect(findInsertCallIndex(tx, seatMaps)).toBe(-1);
      expect(result.seatMaps).toEqual([]);
      expect(result.seatMap).toBeNull();
      expect(mockCatalogFreshness.invalidatePerformance).toHaveBeenCalledWith(
        'perf-id-123',
      );
    });

    it('writes event.update audit with safe venue and transport changed fields', async () => {
      const updateInput: UpdatePerformanceInput = {
        venueName: '동해문화예술관 대극장',
        venueAddress: '서울 성북구 화랑로13길 60',
        venueAccessNotes: '휠체어석은 B 게이트에서 안내',
        transportSummary: '6호선 고려대역 하차 후 도보 10분',
      };

      await service.updatePerformance('perf-id-123', updateInput, {
        ...adminMutationContext,
        reason: '공연장 및 교통 안내 보강',
      });

      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: adminMutationContext.actorUserId,
          action: 'event.update',
          resourceType: 'performance',
          resourceId: 'perf-id-123',
          status: 'success',
          reason: '공연장 및 교통 안내 보강',
          changedFields: expect.arrayContaining([
            'venueName',
            'venueAddress',
            'venueAccessNotes',
            'transportSummary',
          ]),
          after: expect.objectContaining({
            venueName: '동해문화예술관 대극장',
            venueAddress: '서울 성북구 화랑로13길 60',
            venueAccessNotes: '휠체어석은 B 게이트에서 안내',
            transportSummary: '6호선 고려대역 하차 후 도보 10분',
          }),
          ipAddress: adminMutationContext.ipAddress,
          userAgent: adminMutationContext.userAgent,
          requestId: adminMutationContext.requestId,
        }),
        mockDb._tx,
      );
    });

    it('persists copy visibility updates without touching showtime preservation behavior', async () => {
      const result = await service.updatePerformance('perf-id-123', {
        description: '저장된 상세정보',
        descriptionVisible: false,
        salesInfo: '저장된 판매정보',
        salesInfoVisible: false,
      });

      const performanceUpdate = mockDb._tx._updates.find(
        (entry) => entry.table === performances,
      );

      expect(performanceUpdate?.values).toEqual(
        expect.objectContaining({
          description: '저장된 상세정보',
          descriptionVisible: false,
          salesInfo: '저장된 판매정보',
          salesInfoVisible: false,
        }),
      );
      expect(mockDb._tx.delete).not.toHaveBeenCalledWith(showtimes);
      expect(result.description).toBe('Updated description');
      expect(result.descriptionVisible).toBe(false);
      expect(result.salesInfoVisible).toBe(false);
    });
  });

  describe('publishPerformance', () => {
    it('publishes an event through the admin-led flow and writes event.publish audit', async () => {
      await service.publishPerformance(
        'perf-id-123',
        {
          reason: '광고 오픈 전 게시 승인',
          confirmed: true,
          confirmedChangedFields: [
            'title',
            'venueName',
            'transportSummary',
            'salesInfo',
          ],
          contentChecklist: publishReadyContentChecklist,
        },
        adminMutationContext,
      );

      const publishUpdate = mockDb._tx._updates.find(
        (entry) => entry.table === performances,
      );

      expect(publishUpdate?.values).toEqual(
        expect.objectContaining({
          publishState: 'published',
          publishedByUserId: adminMutationContext.actorUserId,
        }),
      );
      expect(publishUpdate?.values).not.toHaveProperty('status');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: adminMutationContext.actorUserId,
          action: 'event.publish',
          resourceType: 'performance',
          resourceId: 'perf-id-123',
          status: 'success',
          reason: '광고 오픈 전 게시 승인',
          changedFields: [
            'title',
            'venueName',
            'transportSummary',
            'salesInfo',
          ],
          after: expect.objectContaining({
            publishState: 'published',
            publishedByUserId: adminMutationContext.actorUserId,
          }),
        }),
        mockDb._tx,
      );
    });

    it('blocks publish without public status mutation when Korean or English content is missing', async () => {
      await expect(
        service.publishPerformance(
          'perf-id-123',
          {
            reason: '영문 설명 누락 검수',
            confirmed: true,
            confirmedChangedFields: ['description'],
            contentChecklist: {
              ko: { title: true, description: true },
              en: { title: true, description: false },
            },
          },
          adminMutationContext,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDb._tx.update).not.toHaveBeenCalled();
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'event.publish',
          resourceType: 'performance',
          resourceId: 'perf-id-123',
          status: 'failed',
          reason: '영문 설명 누락 검수',
          changedFields: ['description'],
          after: expect.objectContaining({
            missingRequiredContent: ['en.description'],
          }),
        }),
        mockDb._tx,
      );
    });
  });

  describe('deletePerformance', () => {
    it('should delete performance by id (cascade handles children)', async () => {
      await service.deletePerformance('perf-id-123');

      // When GREEN, should verify DELETE FROM performances WHERE id = 'perf-id-123'
      // Cascade will handle child tables (priceTiers, showtimes, castings, seatMaps)
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('blocks delete when booking or field operation history is linked', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{
          performance_count: 1,
          reservations_count: 1,
          ticket_scan_events_count: 1,
          seat_operation_history_count: 0,
        }],
      });

      await expect(service.deletePerformance('perf-id-123')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('returns not found when deleting a missing performance', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{
          performance_count: 0,
          reservations_count: 0,
          ticket_scan_events_count: 0,
          seat_operation_history_count: 0,
        }],
      });

      await expect(service.deletePerformance('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  describe('createBanner', () => {
    it('should insert banner and return created record', async () => {
      const bannerInput: CreateBannerInput = {
        imageUrl: 'https://r2.example.com/banners/spring.jpg',
        linkUrl: 'https://www.heygrabit.com/performances/123',
        sortOrder: 0,
        isActive: true,
      };

      const result = await service.createBanner(bannerInput);

      // When GREEN, should verify INSERT into banners and return the created record
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('persists expanded banner fields and writes banner.manage audit', async () => {
      const startsAt = '2026-05-15T00:00:00.000Z';
      const endsAt = '2026-05-31T23:59:59.000Z';
      const bannerInput: CreateBannerInput = {
        imageUrl: 'https://r2.example.com/banners/may.jpg',
        linkUrl: 'https://www.heygrabit.com/performances/may-fanmeet',
        placement: 'home_secondary',
        deviceTarget: 'mobile',
        startsAt,
        endsAt,
        status: 'scheduled',
        sortOrder: 3,
        isActive: true,
      };
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          createBannerRow({
            id: 'banner-id-25-13',
            ...bannerInput,
            startsAt: new Date(startsAt),
            endsAt: new Date(endsAt),
          }),
        ]),
      });
      mockDb.insert = vi.fn().mockReturnValue({ values });

      const result = await service.createBanner(
        bannerInput,
        bannerMutationContext,
      );

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          imageUrl: bannerInput.imageUrl,
          linkUrl: bannerInput.linkUrl,
          placement: 'home_secondary',
          deviceTarget: 'mobile',
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          status: 'scheduled',
          sortOrder: 3,
          isActive: true,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: 'banner-id-25-13',
          placement: 'home_secondary',
          deviceTarget: 'mobile',
          status: 'scheduled',
          startsAt,
          endsAt,
          sortOrder: 3,
        }),
      );
      expect(mockCatalogFreshness.invalidateBanners).toHaveBeenCalled();
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: bannerMutationContext.actorUserId,
          action: 'banner.manage',
          resourceType: 'banner',
          resourceId: 'banner-id-25-13',
          status: 'success',
          reason: 'create',
          changedFields: expect.arrayContaining([
            'imageUrl',
            'linkUrl',
            'placement',
            'deviceTarget',
            'startsAt',
            'endsAt',
            'status',
            'sortOrder',
            'isActive',
          ]),
          after: expect.objectContaining({
            placement: 'home_secondary',
            deviceTarget: 'mobile',
            startsAt,
            endsAt,
            status: 'scheduled',
          }),
          ipAddress: bannerMutationContext.ipAddress,
          userAgent: bannerMutationContext.userAgent,
          requestId: bannerMutationContext.requestId,
        }),
      );
    });
  });

  describe('updateBanner', () => {
    it('should update banner fields by id', async () => {
      await service.updateBanner('banner-id-123', {
        imageUrl: 'https://r2.example.com/banners/updated.jpg',
        isActive: false,
      });

      // When GREEN, should verify UPDATE banners SET ... WHERE id = 'banner-id-123'
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('writes banner.manage audit for expanded banner field updates', async () => {
      const startsAt = '2026-06-01T00:00:00.000Z';
      const endsAt = '2026-06-30T23:59:59.000Z';
      const updateValues = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            createBannerRow({
              id: 'banner-id-123',
              imageUrl: 'https://r2.example.com/banners/june.jpg',
              linkUrl: 'https://www.heygrabit.com/performances/june',
              placement: 'performance_detail',
              deviceTarget: 'desktop',
              startsAt: new Date(startsAt),
              endsAt: new Date(endsAt),
              status: 'active',
              sortOrder: 6,
              isActive: true,
            }),
          ]),
        }),
      });
      mockDb.update = vi.fn().mockReturnValue({
        set: updateValues,
      });

      await service.updateBanner(
        'banner-id-123',
        {
          imageUrl: 'https://r2.example.com/banners/june.jpg',
          linkUrl: 'https://www.heygrabit.com/performances/june',
          placement: 'performance_detail',
          deviceTarget: 'desktop',
          startsAt,
          endsAt,
          status: 'active',
          sortOrder: 6,
          isActive: true,
        },
        bannerMutationContext,
      );

      expect(updateValues).toHaveBeenCalledWith(
        expect.objectContaining({
          placement: 'performance_detail',
          deviceTarget: 'desktop',
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          status: 'active',
          sortOrder: 6,
        }),
      );
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'banner.manage',
          resourceType: 'banner',
          resourceId: 'banner-id-123',
          status: 'success',
          reason: 'update',
          changedFields: expect.arrayContaining([
            'imageUrl',
            'linkUrl',
            'placement',
            'deviceTarget',
            'startsAt',
            'endsAt',
            'status',
            'sortOrder',
            'isActive',
          ]),
          after: expect.objectContaining({
            placement: 'performance_detail',
            deviceTarget: 'desktop',
            startsAt,
            endsAt,
            status: 'active',
          }),
        }),
      );
    });

    it('rejects banner schedule windows where endsAt is before startsAt', async () => {
      await expect(
        service.updateBanner('banner-id-123', {
          startsAt: '2026-07-02T00:00:00.000Z',
          endsAt: '2026-07-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when banner does not exist', async () => {
      // Override returning to return empty array (no matching banner)
      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.updateBanner('nonexistent-id', {
          imageUrl: 'https://r2.example.com/banners/updated.jpg',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteBanner', () => {
    it('should delete banner by id', async () => {
      await service.deleteBanner('banner-id-123');

      // When GREEN, should verify DELETE FROM banners WHERE id = 'banner-id-123'
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('writes banner.manage audit after delete', async () => {
      await service.deleteBanner('banner-id-123', bannerMutationContext);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockCatalogFreshness.invalidateBanners).toHaveBeenCalled();
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: bannerMutationContext.actorUserId,
          action: 'banner.manage',
          resourceType: 'banner',
          resourceId: 'banner-id-123',
          status: 'success',
          reason: 'delete',
          changedFields: ['deleted'],
          after: { deleted: true },
        }),
      );
    });
  });

  describe('reorderBanners', () => {
    it('should update sort_order for each banner id in order within a transaction', async () => {
      const orderedIds = ['banner-3', 'banner-1', 'banner-2'];

      await service.reorderBanners(orderedIds);

      // Verify transaction was used
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('rejects empty reorder payloads before persistence', async () => {
      await expect(service.reorderBanners([])).rejects.toThrow(BadRequestException);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('writes banner.manage audit after reorder and invalidates public banners', async () => {
      const orderedIds = ['banner-3', 'banner-1', 'banner-2'];

      await service.reorderBanners(orderedIds, bannerMutationContext);

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockCatalogFreshness.invalidateBanners).toHaveBeenCalled();
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'banner.manage',
          resourceType: 'banner',
          resourceId: 'bulk-reorder',
          status: 'success',
          reason: 'reorder',
          changedFields: ['sortOrder'],
          after: { orderedIds },
        }),
      );
    });
  });

  describe('AdminBannerController route contract', () => {
    it('keeps banners/reorder before banners/:id and requires banner.manage for mutations', () => {
      const prototype = AdminBannerController.prototype;
      const routes = Object.getOwnPropertyNames(prototype)
        .filter((propertyName) => propertyName !== 'constructor')
        .map((propertyName) => ({
          propertyName,
          path: Reflect.getMetadata(
            PATH_METADATA,
            prototype[propertyName as keyof typeof prototype],
          ) as string | undefined,
        }))
        .filter((route) => route.path);

      expect(routes.findIndex((route) => route.path === 'banners/reorder'))
        .toBeLessThan(routes.findIndex((route) => route.path === 'banners/:id'));
      for (const methodName of [
        'createBanner',
        'updateBanner',
        'deleteBanner',
        'reorderBanners',
      ] as const) {
        expect(
          Reflect.getMetadata(
            ADMIN_CAPABILITIES_KEY,
            prototype[methodName],
          ),
        ).toEqual(['banner.manage']);
      }
    });
  });

  describe('saveSeatMap', () => {
    it('persists multi-floor payloads and returns floor-aware seat maps', async () => {
      const result = await service.saveSeatMap('perf-id-123', {
        seatMaps: sampleSeatMaps,
        bookingPolicy: sampleBookingPolicy,
      });

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(result.seatMaps.map((seatMap) => seatMap.floorKey)).toEqual([
        '1F',
        '2F',
      ]);
      expect(result.bookingPolicy.allowedPaymentMethods).toEqual([
        'CARD',
        'FOREIGN_EASY_PAY',
      ]);
    });

    it('rejects duplicate floorKey values before persistence', async () => {
      await expect(
        service.saveSeatMap('perf-id-123', {
          seatMaps: [
            sampleSeatMaps[0]!,
            {
              ...sampleSeatMaps[0]!,
              floorLabel: '1층 복제',
            },
          ],
          bookingPolicy: sampleBookingPolicy,
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicate seat assignments inside a floor before persistence', async () => {
      await expect(
        service.saveSeatMap('perf-id-123', {
          seatMaps: [
            {
              ...sampleSeatMaps[0]!,
              seatConfig: {
                tiers: [
                  { tierName: 'VIP', color: '#FFD700', seatIds: ['A1'] },
                  { tierName: 'R', color: '#4169E1', seatIds: ['A1'] },
                ],
              },
            },
          ],
          bookingPolicy: sampleBookingPolicy,
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rejects seat tiers that are not registered as price tiers', async () => {
      await expect(
        service.saveSeatMap('perf-id-123', {
          seatMaps: [
            {
              ...sampleSeatMaps[0]!,
              seatConfig: {
                tiers: [
                  { tierName: 'UNREGISTERED', color: '#111111', seatIds: ['A1'] },
                ],
              },
            },
          ],
          bookingPolicy: sampleBookingPolicy,
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rejects detected SVG seats that are not assigned to any tier', async () => {
      await expect(
        service.saveSeatMap('perf-id-123', {
          seatMaps: [
            {
              ...sampleSeatMaps[0]!,
              totalSeats: 3,
            },
          ],
          bookingPolicy: sampleBookingPolicy,
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('keeps legacy single-seat-map saves compatible with default 1F floor data', async () => {
      const seatMapConfig: SeatMapConfigInput = {
        tiers: [
          { tierName: 'VIP', color: '#FFD700', seatIds: ['A1', 'A2', 'A3'] },
          { tierName: 'R', color: '#4169E1', seatIds: ['B1', 'B2', 'B3', 'B4'] },
        ],
      };

      const result = await service.saveSeatMap('perf-id-123', {
        svgUrl: 'https://r2.example.com/seatmaps/venue1.svg',
        seatConfig: seatMapConfig,
        totalSeats: 7,
      });

      expect(result.seatMap?.floorKey).toBe('1F');
      expect(result.seatMaps[0]?.floorLabel).toBe('1층');
    });

    it('invalidates locale-scoped detail caches after direct seat-map saves', async () => {
      await service.saveSeatMap('perf-id-123', {
        seatMaps: sampleSeatMaps,
        bookingPolicy: sampleBookingPolicy,
      });

      expect(mockCatalogFreshness.invalidatePerformance).toHaveBeenCalledWith(
        'perf-id-123',
      );
    });
  });
});

describe('AdminPerformanceController', () => {
  it('loads guarded admin detail through the include-hidden copy path', async () => {
    const performanceService = {
      findById: vi.fn().mockResolvedValue(null),
    };
    const controller = new AdminPerformanceController(
      {} as ConstructorParameters<typeof AdminPerformanceController>[0],
      {} as ConstructorParameters<typeof AdminPerformanceController>[1],
      performanceService as unknown as ConstructorParameters<
        typeof AdminPerformanceController
      >[2],
    );

    await controller.getPerformance('perf-id-123');

    expect(performanceService.findById).toHaveBeenCalledWith(
      'perf-id-123',
      undefined,
      { includeHiddenCopy: true },
    );
  });
});
