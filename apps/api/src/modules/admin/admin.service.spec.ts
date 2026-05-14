import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
import { CacheService } from '../performance/cache.service.js';
import {
  bookingPolicies,
  performanceSeatTiers,
  seatMaps,
  venueLayoutFloors,
  venueLayouts,
  venueLayoutSeats,
} from '../../database/schema/index.js';

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
  (txChain as { then?: unknown }).then = vi.fn((resolve: (v: unknown[]) => void) =>
    resolve([
      { tierName: 'VIP' },
      { tierName: 'R' },
      { tierName: 'S' },
    ]),
  );

  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'existing-id' }]),
        }),
      }),
    }),
    select: vi.fn().mockReturnValue(txChain),
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
  };
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
    select: vi.fn().mockReturnValue(dbSelectChain),
    _tx: mockTx,
  };
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

  beforeEach(() => {
    mockDb = createMockDb();
    mockCache = createMockCacheService();
    service = new AdminService(
      mockDb as unknown as ConstructorParameters<typeof AdminService>[0],
      mockCache,
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
  });
});
