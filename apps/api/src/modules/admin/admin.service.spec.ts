import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
import type { AdminAuditService } from './admin-audit.service.js';
import { CacheService } from '../performance/cache.service.js';
import { bookingPolicies, performances, seatMaps } from '../../database/schema/index.js';

function createMockCacheService(): CacheService {
  // Admin mutations trigger invalidate* — mocks swallow them so we can
  // still assert the DB-mutation side effects without an ioredis client.
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;
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
  const methods = ['select', 'from', 'where', 'returning'];
  for (const method of methods) {
    txChain[method] = vi.fn().mockReturnValue(txChain);
  }
  (txChain as { then?: unknown }).then = vi.fn((resolve: (v: unknown[]) => void) => resolve([]));
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];

  return {
    _updates: updates,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'existing-id' }]),
        }),
      }),
    }),
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

function createMockDb() {
  const mockTx = createMockTx();
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

describe('AdminService', () => {
  let service: AdminService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockCache: CacheService;
  let mockAudit: AdminAuditService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockCache = createMockCacheService();
    mockAudit = createMockAuditService();
    service = new AdminService(
      mockDb as unknown as ConstructorParameters<typeof AdminService>[0],
      mockCache,
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
  });

  describe('createBanner', () => {
    it('should insert banner and return created record', async () => {
      const bannerInput: CreateBannerInput = {
        imageUrl: 'https://r2.example.com/banners/spring.jpg',
        linkUrl: '/performances/123',
        sortOrder: 0,
        isActive: true,
      };

      const result = await service.createBanner(bannerInput);

      // When GREEN, should verify INSERT into banners and return the created record
      expect(mockDb.insert).toHaveBeenCalled();
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
  });

  describe('reorderBanners', () => {
    it('should update sort_order for each banner id in order within a transaction', async () => {
      const orderedIds = ['banner-3', 'banner-1', 'banner-2'];

      await service.reorderBanners(orderedIds);

      // Verify transaction was used
      expect(mockDb.transaction).toHaveBeenCalled();
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
  });
});
