import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  PerformanceCardData,
  PerformanceListResponse,
  PerformanceWithDetails,
} from '@grabit/shared';

import { BadRequestException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PerformanceController } from './performance.controller.js';
import {
  EMPTY_LIST_CACHE_TTL_SECONDS,
  PerformanceService,
  isHomeBannerLive,
} from './performance.service.js';
import { CacheService } from './cache.service.js';
import { CatalogFreshnessService } from './catalog-freshness.service.js';
import { PerformanceViewCounter } from './performance-view-counter.service.js';

const PHASE23_I18N_SMOKE_PERFORMANCE_ID =
  '00000000-0000-4000-8000-000000000023';

/**
 * Real CacheService over an in-memory Redis double, so read-through,
 * generation tokens and single-flight behave as in production. Starts empty
 * (miss-by-default) so the service falls through to the DB path.
 */
function createFakeRedis() {
  const store = new Map<string, string>();
  const matches = (pattern: string, key: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(key);
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    keys: vi.fn(async (pattern: string) => [...store.keys()].filter((key) => matches(pattern, key))),
  };
}

function createMockCacheService(redis = createFakeRedis()): CacheService {
  const cache = new CacheService(redis as never);
  vi.spyOn(cache, 'get');
  vi.spyOn(cache, 'set');
  return cache;
}

function createViewCounter(db: unknown = {}) {
  return new PerformanceViewCounter(db as never);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
    bookingStartsAt: null,
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
  let mockRedis: ReturnType<typeof createFakeRedis>;
  let mockCache: CacheService;
  let viewCounter: PerformanceViewCounter;

  beforeEach(() => {
    mockDb = createMockDb();
    mockRedis = createFakeRedis();
    mockCache = createMockCacheService(mockRedis);
    viewCounter = createViewCounter(mockDb);
    service = new PerformanceService(
      mockDb as unknown as ConstructorParameters<typeof PerformanceService>[0],
      mockCache,
      viewCounter,
    );
  });

  describe('findByGenre', () => {
    it('expires an empty selling page at the next opening outside its filtered rows', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
      try {
        mockDb.select.mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([{ count: 0, nextBookingStartsAt: new Date('2026-09-21T10:00:05Z') }]));
        await service.findByGenre('artist_celebrity', { status: 'selling', page: 1, limit: 12, sort: 'latest', ended: true });
        expect(mockCache.set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ total: 0 }), 5);
      } finally { vi.useRealTimers(); }
    });

    it('caches empty pages only briefly so arbitrary filters cannot pin Valkey keys', async () => {
      mockDb.select.mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([{ count: 0, nextBookingStartsAt: null }]));

      await service.findByGenre('artist_celebrity', {
        page: 1, limit: 20, sort: 'latest', ended: false, sub: 'random-bot-subcategory',
      });

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ total: 0, data: [] }),
        EMPTY_LIST_CACHE_TTL_SECONDS,
      );
    });

    it('keeps the normal TTL for non-empty pages', async () => {
      mockDb.select.mockReturnValueOnce(createChainableResult([{
        id: PHASE23_I18N_SMOKE_PERFORMANCE_ID, title: '팬미팅', genre: 'artist_celebrity', posterUrl: null,
        status: 'selling', startDate: new Date('2026-07-18T05:00:00.000Z'),
        endDate: new Date('2026-07-18T07:00:00.000Z'), venueName: null, bookingStartsAt: null,
      }])).mockReturnValueOnce(createChainableResult([{ count: 1, nextBookingStartsAt: null }]));

      await service.findByGenre('artist_celebrity', { page: 1, limit: 20, sort: 'latest', ended: false });

      expect(mockCache.set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ total: 1 }), 300);
    });

    it('never embeds raw subcategory input in the cache key', async () => {
      const sub = `팬미팅:${'x'.repeat(90)}*`;

      await service.findByGenre('artist_celebrity', { page: 1, limit: 20, sort: 'latest', ended: false, sub });

      const [key] = vi.mocked(mockCache.set).mock.calls[0] ?? [];
      expect(key).toEqual(expect.any(String));
      expect(key).not.toContain(sub);
      expect(key).not.toContain('x'.repeat(20));
      expect((key as string).length).toBeLessThan(200);
      expect(key).toMatch(/:sub-[A-Za-z0-9_-]{22}:all$/);
    });

    it('runs one DB rebuild per instance when a hot list key expires under load', async () => {
      const rows = deferred<unknown[]>();
      const listQuery = createChainableMock();
      (listQuery as { then?: unknown }).then = vi.fn(
        (resolve: (value: unknown[]) => void) => rows.promise.then(resolve),
      );
      mockDb.select.mockReturnValueOnce(listQuery)
        .mockReturnValueOnce(createChainableResult([{ count: 0, nextBookingStartsAt: null }]));

      const burst = Array.from({ length: 25 }, () => service.findByGenre('artist_celebrity', {
        page: 1, limit: 20, sort: 'latest', ended: false,
      }));
      await vi.waitFor(() => expect(mockDb.select).toHaveBeenCalledTimes(2));
      rows.resolve([]);
      const results = await Promise.all(burst);

      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(new Set(results).size).toBe(1);
      expect(mockCache.set).toHaveBeenCalledTimes(1);
    });

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

    function mockPublishedDetail(
      performanceOverrides: Record<string, unknown> = {},
      bookingPolicyOverrides: Record<string, unknown> = {},
    ) {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([
          createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, performanceOverrides),
        ]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([createSeatMapRow()]))
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow(bookingPolicyOverrides)]));
    }

    it('counts public detail views without writing the performances row on the request path', async () => {
      mockPublishedDetail();

      const first = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');
      const second = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      expect(first?.id).toBe(PHASE23_I18N_SMOKE_PERFORMANCE_ID);
      expect(second).toEqual(first);
      // The second read is a cache hit; both still count as views.
      expect(viewCounter.pendingCount(PHASE23_I18N_SMOKE_PERFORMANCE_ID)).toBe(2);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('serves an opening-time refresh storm with one detail rebuild and no row-lock writes', async () => {
      const performanceRow = deferred<unknown[]>();
      const detailQuery = createChainableMock();
      (detailQuery as { then?: unknown }).then = vi.fn(
        (resolve: (value: unknown[]) => void) => performanceRow.promise.then(resolve),
      );
      mockDb.select
        .mockReturnValueOnce(detailQuery)
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([createSeatMapRow()]))
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow()]));

      const storm = Array.from({ length: 100 }, () =>
        service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko'));
      await vi.waitFor(() => expect(mockDb.select).toHaveBeenCalledTimes(1));
      performanceRow.resolve([createPerformanceRow()]);
      const results = await Promise.all(storm);

      expect(results.every((result) => result?.id === PHASE23_I18N_SMOKE_PERFORMANCE_ID)).toBe(true);
      expect(mockDb.select).toHaveBeenCalledTimes(6);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(viewCounter.pendingCount(PHASE23_I18N_SMOKE_PERFORMANCE_ID)).toBe(100);
    });

    it('serves warm public detail reads with one Valkey read per request, not two', async () => {
      // Freeze the clock inside one generation memo window.
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        mockPublishedDetail();
        await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');
        mockRedis.get.mockClear();

        for (let i = 0; i < 50; i += 1) {
          await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');
        }

        // Payload GETs only; the generation token is memoized in process.
        expect(mockRedis.get).toHaveBeenCalledTimes(50);
        expect(mockRedis.get.mock.calls.some(([key]) => key.startsWith('cache:generation:'))).toBe(false);
        expect(mockDb.select).toHaveBeenCalledTimes(6);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not count views for hidden or missing performances', async () => {
      mockDb.select.mockReturnValueOnce(
        createNonPublishedDetailResult([
          createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
            publishState: 'draft',
          }),
        ]),
      );

      await expect(service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID)).resolves.toBeNull();

      expect(viewCounter.pendingCount(PHASE23_I18N_SMOKE_PERFORMANCE_ID)).toBe(0);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('does not count guarded admin detail fetches as public views', async () => {
      mockPublishedDetail();

      await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, null, { includeHiddenCopy: true });

      expect(viewCounter.pendingCount(PHASE23_I18N_SMOKE_PERFORMANCE_ID)).toBe(0);
      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('does not let a load that raced an admin commit republish stale detail after invalidation', async () => {
      const freshness = new CatalogFreshnessService(mockCache);
      const staleRow = deferred<unknown[]>();
      const staleDetailQuery = createChainableMock();
      (staleDetailQuery as { then?: unknown }).then = vi.fn(
        (resolve: (value: unknown[]) => void) => staleRow.promise.then(resolve),
      );
      mockDb.select
        .mockReturnValueOnce(staleDetailQuery)
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([]))
        .mockReturnValueOnce(createChainableResult([createSeatMapRow()]))
        .mockReturnValueOnce(createChainableResult([createBookingPolicyRow()]));

      // R: cache miss, reads the pre-commit row...
      const racingRead = service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');
      await vi.waitFor(() => expect(mockDb.select).toHaveBeenCalledTimes(1));
      // ...meanwhile the operator commits a new title and invalidates.
      await freshness.invalidatePerformance(PHASE23_I18N_SMOKE_PERFORMANCE_ID);
      // R finishes after the DEL and writes its stale result.
      staleRow.resolve([createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, { title: '수정 전 제목' })]);
      expect((await racingRead)?.title).toBe('수정 전 제목');
      expect(mockCache.set).toHaveBeenCalledTimes(1);

      mockPublishedDetail({ title: '수정 후 제목' });
      const next = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      expect(next?.title).toBe('수정 후 제목');
    });

    it('stops serving a cached public detail once visibility is revoked and invalidated', async () => {
      const freshness = new CatalogFreshnessService(mockCache);
      mockPublishedDetail();
      await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      mockDb.select.mockReturnValueOnce(
        createNonPublishedDetailResult([
          createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, { publishState: 'draft' }),
        ]),
      );
      await freshness.invalidatePerformance(PHASE23_I18N_SMOKE_PERFORMANCE_ID);

      await expect(service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko')).resolves.toBeNull();
    });

    it('bypasses the shared cache when the generation cannot be read', async () => {
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));
      mockPublishedDetail();

      const result = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

      expect(result?.id).toBe(PHASE23_I18N_SMOKE_PERFORMANCE_ID);
      expect(mockRedis.set).not.toHaveBeenCalled();
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

    it('returns effective selling status after a scheduled booking start even when stored status is upcoming', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
      try {
        mockDb.select
          .mockReturnValueOnce(createChainableResult([
            createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
              status: 'upcoming',
            }),
          ]))
          .mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([createSeatMapRow()]))
          .mockReturnValueOnce(createChainableResult([
            createBookingPolicyRow({
              bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
            }),
          ]));

        const result = await (
          service as unknown as {
            findById(id: string, locale: string): Promise<PerformanceWithDetails>;
          }
        ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

        expect(result.status).toBe('selling');
        expect(result.bookingPolicy.bookingStartsAt).toBe('2026-06-04T10:00:00.000Z');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns the stored status to guarded admin reads so an edit does not persist the derived selling status', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T10:10:00.000Z'));
      try {
        mockPublishedDetail(
          { status: 'upcoming', publishState: 'published' },
          { bookingStartsAt: new Date('2026-06-04T10:00:00.000Z') },
        );
        const adminDetail = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, null, {
          includeHiddenCopy: true,
        });

        mockPublishedDetail(
          { status: 'upcoming', publishState: 'published' },
          { bookingStartsAt: new Date('2026-06-04T10:00:00.000Z') },
        );
        const publicDetail = await service.findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

        expect(adminDetail?.status).toBe('upcoming');
        expect(publicDetail?.status).toBe('selling');
      } finally {
        vi.useRealTimers();
      }
    });

    it('caps public detail cache TTL at the next scheduled booking start', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T09:59:30.000Z'));
      try {
        mockDb.select
          .mockReturnValueOnce(createChainableResult([
            createPerformanceRow(PHASE23_I18N_SMOKE_PERFORMANCE_ID, {
              status: 'upcoming',
            }),
          ]))
          .mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([]))
          .mockReturnValueOnce(createChainableResult([createSeatMapRow()]))
          .mockReturnValueOnce(createChainableResult([
            createBookingPolicyRow({
              bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
            }),
          ]));

        await (
          service as unknown as {
            findById(id: string, locale: string): Promise<PerformanceWithDetails>;
          }
        ).findById(PHASE23_I18N_SMOKE_PERFORMANCE_ID, 'ko');

        expect(mockCache.set).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Object),
          30,
        );
      } finally {
        vi.useRealTimers();
      }
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

    it('falls back to the Korean title instead of a published draft that still carries the manual-review marker', async () => {
      mockDb.select
        .mockReturnValueOnce(createChainableResult([{
          id: PHASE23_I18N_SMOKE_PERFORMANCE_ID, title: '2026 걸룰스 팬미팅', genre: 'artist_celebrity',
          posterUrl: null, status: 'selling', startDate: new Date('2026-07-18T05:00:00.000Z'),
          endDate: new Date('2026-07-18T07:00:00.000Z'), venueName: null,
        }]))
        .mockReturnValueOnce(createChainableResult([{ count: 1 }]))
        .mockReturnValueOnce(createChainableResult([{
          entityId: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
          field: 'title',
          translatedText: '[manual-review:deepl-unavailable] 2026 걸룰스 팬미팅',
        }]));

      const result = await service.findByGenre('artist_celebrity', {
        page: 1, limit: 20, sort: 'latest', ended: false, locale: 'en',
      });

      expect(result.data[0]?.title).toBe('2026 걸룰스 팬미팅');
      expect(result.data[0]?.automaticTranslationLabel).not.toBe(true);
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
    function bannerRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'banner-1',
        imageUrl: 'https://cdn.example.com/banner.jpg',
        linkUrl: null,
        placement: 'home_hero',
        deviceTarget: 'all',
        startsAt: null,
        endsAt: null,
        status: 'active',
        sortOrder: 0,
        isActive: true,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        ...overrides,
      };
    }

    it('should return active banners ordered by sortOrder', async () => {
      const result = await service.getHomeBanners();

      expect(Array.isArray(result)).toBe(true);
      expect(mockDb._chainable.orderBy).toHaveBeenCalled();
    });

    it('filters the DB query by publication status, home placement and end time, not isActive alone', async () => {
      await service.getHomeBanners();

      const [condition] = mockDb._chainable.where.mock.calls[0] ?? [];
      const rendered = new PgDialect().sqlToQuery(condition);
      expect(rendered.sql).toContain('"banners"."is_active"');
      expect(rendered.sql).toContain('"banners"."status" in');
      expect(rendered.sql).toContain('"banners"."placement" in');
      expect(rendered.sql).toContain('"banners"."ends_at" is null');
      expect(rendered.params).toEqual(expect.arrayContaining([
        true, 'active', 'scheduled', 'home_hero', 'home_secondary',
      ]));
      expect(rendered.params).not.toContain('paused');
      expect(rendered.params).not.toContain('operations_notice');
    });

    it('hides paused, draft, expired, off-home and out-of-window banners and expires at the next boundary', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
      try {
        mockDb.select.mockReturnValueOnce(createChainableResult([
          bannerRow({ id: 'live' }),
          bannerRow({ id: 'scheduled-later', status: 'scheduled', startsAt: new Date('2026-09-30T10:00:40.000Z') }),
          bannerRow({ id: 'scheduled-now', status: 'scheduled', startsAt: new Date('2026-09-30T09:00:00.000Z') }),
          bannerRow({ id: 'active-later', startsAt: new Date('2026-09-30T11:00:00.000Z') }),
          bannerRow({ id: 'ending-soon', endsAt: new Date('2026-09-30T10:01:00.000Z') }),
        ]));

        const result = await service.getHomeBanners();

        expect(result.map((banner) => banner.id)).toEqual(['live', 'scheduled-now', 'ending-soon']);
        expect(mockCache.set).toHaveBeenCalledWith(expect.any(String), result, 40);
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies the public banner visibility rule', () => {
      const now = new Date('2026-09-30T10:00:00.000Z');
      const base = bannerRow() as unknown as Parameters<typeof isHomeBannerLive>[0];

      expect(isHomeBannerLive(base, now)).toBe(true);
      expect(isHomeBannerLive({ ...base, status: 'paused' }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, status: 'draft' }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, status: 'expired' }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, isActive: false }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, placement: 'operations_notice' }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, placement: 'performance_detail' }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, placement: 'home_secondary' }, now)).toBe(true);
      expect(isHomeBannerLive({ ...base, status: 'scheduled' }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, status: 'scheduled', startsAt: new Date('2026-09-30T10:00:01.000Z') }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, status: 'scheduled', startsAt: now }, now)).toBe(true);
      expect(isHomeBannerLive({ ...base, startsAt: new Date('2026-10-01T00:00:00.000Z') }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, endsAt: now }, now)).toBe(false);
      expect(isHomeBannerLive({ ...base, endsAt: new Date('2026-09-30T10:00:01.000Z') }, now)).toBe(true);
    });

    it('stops serving a paused banner as soon as the banner mutation invalidates the cache', async () => {
      const freshness = new CatalogFreshnessService(mockCache);
      mockDb.select.mockReturnValueOnce(createChainableResult([bannerRow({ id: 'wrong-opening-time' })]));
      expect((await service.getHomeBanners()).map((banner) => banner.id)).toEqual(['wrong-opening-time']);

      // Operator pauses the banner: the paused row no longer matches the query.
      mockDb.select.mockReturnValueOnce(createChainableResult([]));
      await freshness.invalidateBanners();

      await expect(service.getHomeBanners()).resolves.toEqual([]);
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
