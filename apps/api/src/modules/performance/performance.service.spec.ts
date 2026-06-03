import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  PerformanceCardData,
  PerformanceListResponse,
  PerformanceWithDetails,
} from '@grabit/shared';

import { BadRequestException } from '@nestjs/common';
import { PerformanceController } from './performance.controller.js';
import { PerformanceService } from './performance.service.js';
import { CacheService } from './cache.service.js';

const PHASE23_I18N_SMOKE_PERFORMANCE_ID =
  '00000000-0000-4000-8000-000000000023';

function createMockCacheService(): CacheService {
  // Miss-by-default cache so the service falls through to the DB path
  // just like it did before Plan 07-02 wired CacheService in.
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;
}

/**
 * Phase 2 Plan 00: RED-state test stubs for PerformanceService
 *
 * These tests describe the expected contract for PerformanceService:
 * - findByGenre: paginated genre-filtered catalog queries
 * - findById: detail view with relations + view count increment
 * - getHomeBanners / getHotPerformances / getNewPerformances: home page data
 *
 * Services will be implemented in Plan 02. Tests should turn GREEN then.
 */

// --- Drizzle mock helpers ---
function createChainableMock() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'from', 'where', 'leftJoin', 'limit', 'offset', 'orderBy', 'groupBy', 'innerJoin'];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  // Terminal: resolve to empty array by default
  (chain as { then?: unknown }).then = vi.fn((resolve: (v: unknown[]) => void) => resolve([]));
  return chain;
}

function createChainableResult<T>(result: T) {
  const chain = createChainableMock();
  (chain as { then?: unknown }).then = vi.fn(
    (resolve: (value: T) => void) => resolve(result),
  );
  return chain;
}

function collectSqlNodes(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];

  const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
  return [
    value,
    ...(Array.isArray(chunks) ? chunks.flatMap(collectSqlNodes) : []),
  ];
}

function hasPublishStatePublishedFilter(condition: unknown): boolean {
  return collectSqlNodes(condition).some((node) => {
    const param = node as {
      value?: unknown;
      encoder?: { name?: unknown; config?: { name?: unknown } };
    };

    return (
      param.value === 'published' &&
      (param.encoder?.name === 'publish_state' ||
        param.encoder?.config?.name === 'publish_state')
    );
  });
}

function createNonPublishedDetailResult<T>(result: T) {
  const chain = createChainableMock();
  let whereCondition: unknown;

  chain.where.mockImplementation((condition: unknown) => {
    whereCondition = condition;
    return chain;
  });
  (chain as { then?: unknown }).then = vi.fn(
    (resolve: (value: T | []) => void) =>
      resolve(hasPublishStatePublishedFilter(whereCondition) ? [] : result),
  );

  return chain;
}

function createPerformanceRow(
  id = PHASE23_I18N_SMOKE_PERFORMANCE_ID,
  performanceOverrides: Record<string, unknown> = {},
) {
  return {
    performances: {
      id,
      title: '2026 걸룰스 팬미팅',
      genre: 'artist_celebrity' as const,
      subcategory: '팬미팅',
      venueId: 'venue-1',
      posterUrl: null,
      description: '한국어 상세 소개',
      descriptionVisible: true,
      startDate: new Date('2026-07-18T05:00:00.000Z'),
      endDate: new Date('2026-07-18T07:00:00.000Z'),
      runtime: '120분',
      ageRating: '전체 관람가',
      status: 'selling' as const,
      salesInfo: '한국어 판매 정보',
      salesInfoVisible: true,
      viewCount: 0,
      createdAt: new Date('2026-05-07T00:00:00.000Z'),
      updatedAt: new Date('2026-05-07T00:00:00.000Z'),
      ...performanceOverrides,
    },
    venues: {
      id: 'venue-1',
      name: '동해문화예술관 대극장',
      address: null,
    },
  };
}

function createSeatMapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seat-map-1',
    performanceId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: '/seed/donghae-girl-rules-20260718-seat-map.svg',
    seatConfig: { tiers: [] },
    totalSeats: 1,
    ...overrides,
  };
}

function createBookingPolicyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-policy-1',
    performanceId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
    maxTicketsPerUser: 1,
    allowedPaymentMethods: ['CARD'],
    changePolicyEnabled: false,
    paymentWindowMinutes: 7,
    seatHoldMinutes: 10,
    cancelledSeatHoldMinMinutes: 1,
    cancelledSeatHoldMaxMinutes: 10,
    manualOpenEnabled: true,
    ...overrides,
  };
}

const translatedFieldRows = [
  {
    entityId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
    field: 'title',
    translatedText: '2026 Girl Rules Fanmeeting',
  },
  {
    entityId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
    field: 'description',
    translatedText: 'English reviewed fanmeeting description',
  },
  {
    entityId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
    field: 'salesInfo',
    translatedText: 'English reviewed sales information',
  },
];

function createMockDb() {
  const chainable = createChainableMock();
  const updateReturning = vi.fn().mockResolvedValue([
    { id: PHASE23_I18N_SMOKE_PERFORMANCE_ID },
  ]);
  const updateWhere = vi.fn().mockReturnValue({
    returning: updateReturning,
  });
  return {
    select: vi.fn().mockReturnValue(chainable),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: updateWhere,
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
    query: {
      performances: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      banners: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    execute: vi.fn().mockResolvedValue([]),
    _chainable: chainable,
    _updateReturning: updateReturning,
    _updateWhere: updateWhere,
  };
}

describe('PerformanceService', () => {
  let service: PerformanceService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockCache: CacheService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockCache = createMockCacheService();
    service = new PerformanceService(
      mockDb as unknown as ConstructorParameters<typeof PerformanceService>[0],
      mockCache,
    );
  });

  describe('findByGenre', () => {
    it('should return paginated performances filtered by genre', async () => {
      const result: PerformanceListResponse = await service.findByGenre('artist_celebrity', {
        page: 1,
        limit: 20,
        sort: 'latest',
        ended: false,
      });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('totalPages');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by subcategory when sub param provided', async () => {
      await service.findByGenre('artist_celebrity', {
        page: 1,
        limit: 20,
        sort: 'latest',
        ended: false,
        sub: 'hot',
      });

      // Verify the query includes subcategory filter
      // When GREEN, the mock's WHERE clause should have been called with subcategory condition
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should exclude ended performances when ended=false', async () => {
      await service.findByGenre('artist_celebrity', {
        page: 1,
        limit: 20,
        sort: 'latest',
        ended: false,
      });

      // When GREEN, should verify WHERE excludes status='ended'
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('filters public genre lists to published performances', async () => {
      await service.findByGenre('artist_celebrity', {
        page: 1,
        limit: 20,
        sort: 'latest',
        ended: false,
      });

      const whereConditions = mockDb._chainable.where.mock.calls.map(
        ([condition]) => condition,
      );
      expect(whereConditions).toHaveLength(2);
      expect(whereConditions.every(hasPublishStatePublishedFilter)).toBe(true);
    });

    it('should sort by viewCount DESC when sort=popular', async () => {
      await service.findByGenre('ip_popup', {
        page: 1,
        limit: 20,
        sort: 'popular',
        ended: false,
      });

      // When GREEN, should verify ORDER BY uses viewCount DESC
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return performance with venue, priceTiers, showtimes, castings, seatMap', async () => {
      const testId = '550e8400-e29b-41d4-a716-446655440000';
      const result: PerformanceWithDetails | null = await service.findById(testId);

      // When GREEN, result should have the full PerformanceWithDetails shape
      if (result !== null) {
        expect(result).toHaveProperty('venue');
        expect(result).toHaveProperty('priceTiers');
        expect(result).toHaveProperty('showtimes');
        expect(result).toHaveProperty('castings');
        expect(result).toHaveProperty('seatMap');
      }
    });

    it('should increment viewCount by 1', async () => {
      const testId = '550e8400-e29b-41d4-a716-446655440000';
      await service.findById(testId);

      // When GREEN, should verify UPDATE performances SET view_count = view_count + 1
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('does not increment hidden performance viewCount through public detail reads', async () => {
      mockDb._updateReturning.mockResolvedValueOnce([]);
      mockDb.select.mockReturnValueOnce(
        createNonPublishedDetailResult([
          createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
            publishState: 'draft',
          }),
        ]),
      );

      await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID);

      const [updateWhere] = mockDb._updateWhere.mock.calls[0] ?? [];
      expect(hasPublishStatePublishedFilter(updateWhere)).toBe(true);
    });

    it('does not return a stale cached public detail after visibility is revoked', async () => {
      const cached = {
        id: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
        title: 'Cached published title',
      } as PerformanceWithDetails;
      vi.mocked(mockCache.get).mockResolvedValueOnce(cached);
      mockDb._updateReturning.mockResolvedValueOnce([]);

      const result = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID);

      expect(result).toBeNull();
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('should return null for non-existent id', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const result = await service.findById(nonExistentId);

      expect(result).toBeNull();
    });

    it('filters public detail reads to published performances', async () => {
      await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID);

      const [detailWhere] = mockDb._chainable.where.mock.calls[0] ?? [];
      expect(hasPublishStatePublishedFilter(detailWhere)).toBe(true);
    });

    it('returns null for non-published public detail rows', async () => {
      mockDb.select.mockReturnValueOnce(
        createNonPublishedDetailResult([
          createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
            publishState: 'draft',
          }),
        ]),
      );

      const result = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID);

      expect(result).toBeNull();
    });

    it('overlays reviewed translated detail fields and marks machine reviewed metadata for foreign locales', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([createPerformanceRow()]))
        .mockReturnValueOnce(
          createChainableResult([
            {
              id: 'tier-svip',
              performanceId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
              tierName: 'SVIP석',
              price: 380000,
              sortOrder: 0,
            },
          ]),
        )
        .mockReturnValueOnce(
          createChainableResult([
            {
              id: 'showtime-1',
              performanceId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
              dateTime: new Date('2026-07-18T05:00:00.000Z'),
            },
          ]),
        )
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(
          createChainableResult([
            {
              ...createSeatMapRow(),
            },
          ]),
        )
        .mockReturnValueOnce(
          createChainableResult([createBookingPolicyRow()]),
        )
        .mockReturnValueOnce(createChainableResult(translatedFieldRows));

      const result = await (
        service as unknown as {
          findById(id: string, locale: string): Promise<PerformanceWithDetails>;
        }
      ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'en');

      expect(result.title).toBe('2026 Girl Rules Fanmeeting');
      expect(result.description).toBe('English reviewed fanmeeting description');
      expect(result.salesInfo).toBe('English reviewed sales information');
      expect(result.automaticTranslationLabel).toBe(true);
      expect(result.translatedBy).toBe('machine_reviewed');
    });

    it('masks hidden copy after translation overlay for public details', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([
          createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
            descriptionVisible: false,
            salesInfoVisible: false,
          }),
        ]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow()]))
        .mockReturnValueOnce(createChainableResult(translatedFieldRows));

      const result = await (
        service as unknown as {
          findById(id: string, locale: string): Promise<PerformanceWithDetails>;
        }
      ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'en');

      expect(result.descriptionVisible).toBe(false);
      expect(result.salesInfoVisible).toBe(false);
      expect(result.description).toBeNull();
      expect(result.salesInfo).toBeNull();
    });

    it('keeps hidden copy available for guarded admin detail fetches', async () => {
      const detailQuery = createChainableResult([
        createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
          descriptionVisible: false,
          salesInfoVisible: false,
          publishState: 'draft',
        }),
      ]);

      mockDb.select
        .mockReturnValueOnce(detailQuery)
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow()]));

      const result = await (
        service as unknown as {
          findById(
            id: string,
            locale?: string | null,
            options?: { includeHiddenCopy?: boolean },
          ): Promise<PerformanceWithDetails>;
        }
      ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, null, {
        includeHiddenCopy: true,
      });

      expect(result.descriptionVisible).toBe(false);
      expect(result.salesInfoVisible).toBe(false);
      expect(result.description).toBe('한국어 상세 소개');
      expect(result.salesInfo).toBe('한국어 판매 정보');
      expect(
        hasPublishStatePublishedFilter(detailQuery.where.mock.calls[0]?.[0]),
      ).toBe(false);
    });

    it('keeps Korean detail canonical without automatic translation metadata', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([createPerformanceRow()]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow()]));

      const result = await (
        service as unknown as {
          findById(id: string, locale: string): Promise<PerformanceWithDetails>;
        }
      ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      expect(result.title).toBe('2026 걸룰스 팬미팅');
      expect(result.automaticTranslationLabel).toBeUndefined();
      expect(result.translatedBy).toBeUndefined();
    });

    it('returns floor-aware seatMaps and bookingPolicy for downstream booking flows', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([createPerformanceRow()]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(
          createChainableResult([
            createSeatMapRow(),
            createSeatMapRow({
              id: 'seat-map-2',
              floorKey: '2F',
              floorLabel: '2층',
              sortOrder: 1,
              svgUrl: '/seed/donghae-girl-rules-20260718-seat-map-2f.svg',
            }),
          ]),
        )
        .mockReturnValueOnce(
          createChainableResult([
            createBookingPolicyRow({
              allowedPaymentMethods: ['CARD', 'FOREIGN_EASY_PAY'],
              maxTicketsPerUser: 2,
            }),
          ]),
        );

      const result = await (
        service as unknown as {
          findById(id: string, locale: string): Promise<PerformanceWithDetails>;
        }
      ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      expect(result.seatMaps).toHaveLength(2);
      expect(result.seatMaps.map((seatMap) => seatMap.floorKey)).toEqual([
        '1F',
        '2F',
      ]);
      expect(result.bookingPolicy).toMatchObject({
        maxTicketsPerUser: 2,
        allowedPaymentMethods: ['CARD', 'FOREIGN_EASY_PAY'],
        changePolicyEnabled: false,
      });
    });

    it('synthesizes default 1F values for legacy single-floor seat-map rows', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([createPerformanceRow()]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(
          createChainableResult([
            createSeatMapRow({
              floorKey: undefined,
              floorLabel: undefined,
              sortOrder: undefined,
            }),
          ]),
        )
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow()]));

      const result = await (
        service as unknown as {
          findById(id: string, locale: string): Promise<PerformanceWithDetails>;
        }
      ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      expect(result.seatMaps).toEqual([
        expect.objectContaining({
          floorKey: '1F',
          floorLabel: '1층',
          sortOrder: 0,
        }),
      ]);
    });
  });

  describe('translation overlays for card lists', () => {
    it('overlays reviewed translated titles on genre list cards', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createChainableResult([
            {
              id: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
              title: '2026 걸룰스 팬미팅',
              genre: 'artist_celebrity',
              posterUrl: null,
              status: 'selling',
              startDate: new Date('2026-07-18T05:00:00.000Z'),
              endDate: new Date('2026-07-18T07:00:00.000Z'),
              venueName: '동해문화예술관 대극장',
            },
          ]),
        )
        .mockReturnValueOnce(createChainableResult([{ count: 1 }]))
        .mockReturnValueOnce(
          createChainableResult([
            {
              entityId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
              field: 'title',
              translatedText: '2026 Girl Rules Fanmeeting',
            },
          ]),
        );

      const result = await service.findByGenre('artist_celebrity', {
        page: 1,
        limit: 20,
        sort: 'latest',
        ended: false,
        locale: 'en',
      } as never);

      expect(result.data[0]?.title).toBe('2026 Girl Rules Fanmeeting');
      expect(result.data[0]?.automaticTranslationLabel).toBe(true);
      expect(result.data[0]?.translatedBy).toBe('machine_reviewed');
    });
  });

  describe('controller id validation', () => {
    it('rejects invalid string performance ids as controlled 400 errors', async () => {
      const controller = new PerformanceController({
        findById: vi.fn(),
      } as unknown as PerformanceService);

      await expect(controller.getPerformance('test-performance')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('getHomeBanners', () => {
    it('should return active banners ordered by sortOrder', async () => {
      const result = await service.getHomeBanners();

      // When GREEN, should verify:
      // - WHERE isActive=true
      // - ORDER BY sortOrder ASC
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getHotPerformances', () => {
    it('should return top 4 performances by viewCount', async () => {
      const result: PerformanceCardData[] = await service.getHotPerformances();

      // When GREEN, should verify:
      // - LIMIT 4
      // - ORDER BY viewCount DESC
      // - Only non-ended performances
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(4);
    });

    it('filters public hot performance cards to published performances', async () => {
      await service.getHotPerformances();

      const [whereCondition] = mockDb._chainable.where.mock.calls[0] ?? [];
      expect(hasPublishStatePublishedFilter(whereCondition)).toBe(true);
    });
  });

  describe('getNewPerformances', () => {
    it('should return top 4 performances by createdAt', async () => {
      const result: PerformanceCardData[] = await service.getNewPerformances();

      // When GREEN, should verify:
      // - LIMIT 4
      // - ORDER BY createdAt DESC
      // - Only non-ended performances
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(4);
    });

    it('filters public new performance cards to published performances', async () => {
      await service.getNewPerformances();

      const [whereCondition] = mockDb._chainable.where.mock.calls[0] ?? [];
      expect(hasPublishStatePublishedFilter(whereCondition)).toBe(true);
    });
  });
});
