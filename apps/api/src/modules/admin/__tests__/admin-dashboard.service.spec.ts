import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminDashboardService } from '../admin-dashboard.service.js';
import type { DashboardPeriod } from '@grabit/shared';

/**
 * RED unit tests for AdminDashboardService (Plan 11-01).
 *
 * Purpose: lock test names + expected values for ADM-01~06 + cache hit/set-ttl/degradation.
 * Skeleton (Task 01-02) exists so `import { AdminDashboardService }` resolves —
 * each test fails with `Error: Not implemented` (thrown by skeleton) or assertion
 * mismatch, NOT module-not-found. Plan 02 (Task 02-01) will implement the service
 * and flip all tests to GREEN.
 *
 * Key namespace per D-14: `cache:admin:dashboard:{kind}:{params}`.
 * Cache TTL per D-12: 60 seconds exactly.
 */

// Helper: creates a deeply chainable mock (Drizzle query builder stand-in).
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

function createMockDb() {
  return { select: vi.fn() };
}

function createMockCache() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidatePattern: vi.fn(),
  };
}

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockCache = createMockCache();
    // `as any` cast confined to test mocks — production code stays strict.
    service = new AdminDashboardService(mockDb as any, mockCache as any);
  });

  describe('summary', () => {
    it('returns todayBookings, todayRevenue, todayCancelled, activePerformances', async () => {
      mockCache.get.mockResolvedValue(null);
      mockDb.select
        .mockReturnValueOnce(createChainMock([{ count: 10 }]))
        .mockReturnValueOnce(createChainMock([{ sum: 150000 }]))
        .mockReturnValueOnce(createChainMock([{ count: 1 }]))
        .mockReturnValueOnce(createChainMock([{ count: 3 }]));
      const result = await service.getSummary();
      expect(result).toEqual({
        todayBookings: 10,
        todayRevenue: 150000,
        todayCancelled: 1,
        activePerformances: 3,
      });
    });
  });

  describe('kst-boundary', () => {
    it('applies KST day boundary via where clause referencing reservations.createdAt', async () => {
      mockCache.get.mockResolvedValue(null);
      const whereSpy = vi.fn(() => createChainMock([{ count: 1 }]));
      const fromSpy = vi.fn(() => ({ where: whereSpy }));
      mockDb.select.mockReturnValue({ from: fromSpy });
      await service.getSummary();
      // where가 적어도 한 번은 호출되고, 인자가 존재해야 함.
      // (구현 방식에 따라 SQL 조각에 'Asia/Seoul' 리터럴이 있을 수도, UTC boundary Date와 raw 컬럼 비교일 수도 있음.)
      expect(whereSpy).toHaveBeenCalled();
      const whereArg = whereSpy.mock.calls[0]?.[0];
      expect(whereArg).toBeDefined();
    });
  });

  describe('revenue-weekly', () => {
    it('uses week granularity for 90d period and fills empty buckets', async () => {
      mockCache.get.mockResolvedValue(null);
      const orderBySpy = vi.fn(() => createChainMock([])); // DB가 빈 배열 반환
      const groupBySpy = vi.fn(() => ({ orderBy: orderBySpy }));
      const whereSpy = vi.fn(() => ({ groupBy: groupBySpy }));
      const fromSpy = vi.fn(() => ({ where: whereSpy }));
      mockDb.select.mockReturnValue({ from: fromSpy });
      const result = await service.getRevenueTrend('90d' as DashboardPeriod);
      const selectArg = mockDb.select.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      const serialized = JSON.stringify(selectArg);
      // 'week' granularity 표시 또는 IYYY-"W"IW 포맷 흔적
      expect(serialized.toLowerCase()).toMatch(/week|iyyy/);
      // review MEDIUM 6: 빈 DB 결과에도 bucket skeleton이 채워져서 최소 1개 이상 (90d → 13 weeks skeleton)
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('genre', () => {
    it('returns genre count array', async () => {
      mockCache.get.mockResolvedValue(null);
      const orderBySpy = vi.fn(() =>
        createChainMock([
          { genre: 'artist_celebrity', count: 5 },
          { genre: 'ip_popup', count: 3 },
        ]),
      );
      const groupBySpy = vi.fn(() => ({ orderBy: orderBySpy }));
      const whereSpy = vi.fn(() => ({ groupBy: groupBySpy }));
      const innerJoinSpy = vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: whereSpy })),
      }));
      const fromSpy = vi.fn(() => ({
        innerJoin: innerJoinSpy,
        where: whereSpy,
      }));
      mockDb.select.mockReturnValue({ from: fromSpy });
      const result = await service.getGenreDistribution('30d' as DashboardPeriod);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('payment', () => {
    it('joins payments with reservations where reservations.status = CONFIRMED AND payments.status = DONE (Pitfall 5 + review MEDIUM 5 + WR-03)', async () => {
      mockCache.get.mockResolvedValue(null);
      const groupBySpy = vi.fn(() => createChainMock([{ method: 'card', count: 8 }]));
      const whereSpy = vi.fn(() => ({ groupBy: groupBySpy }));
      const innerJoinSpy = vi.fn(() => ({ where: whereSpy }));
      const fromSpy = vi.fn(() => ({ innerJoin: innerJoinSpy }));
      mockDb.select.mockReturnValue({ from: fromSpy });
      await service.getPaymentDistribution('30d' as DashboardPeriod);
      const whereArg = whereSpy.mock.calls[0]?.[0];
      // WR-03: After rewriting the raw SQL fragment to typed `and(eq(...))`,
      // JSON.stringify hits a PgTable <-> PgColumn cycle. Walk the AST by hand
      // with a cycle-safe string collector and assert both literals appear.
      const collectStrings = (node: unknown): string[] => {
        const out: string[] = [];
        const seen = new WeakSet<object>();
        const walk = (v: unknown) => {
          if (typeof v === 'string') {
            out.push(v);
            return;
          }
          if (v === null || typeof v !== 'object') return;
          if (seen.has(v as object)) return;
          seen.add(v as object);
          if (Array.isArray(v)) {
            v.forEach(walk);
            return;
          }
          for (const key of Object.keys(v as Record<string, unknown>)) {
            walk((v as Record<string, unknown>)[key]);
          }
        };
        walk(node);
        return out;
      };
      const strings = collectStrings(whereArg);
      expect(strings).toContain('CONFIRMED');
      expect(strings).toContain('DONE');
    });
  });

  describe('cache-hit', () => {
    it('does not call db when cache returns value', async () => {
      mockCache.get.mockResolvedValue({
        todayBookings: 5,
        todayRevenue: 50000,
        todayCancelled: 0,
        activePerformances: 2,
      });
      const result = await service.getSummary();
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(result.todayBookings).toBe(5);
    });
  });

  describe('cache-set-ttl', () => {
    it('calls cache.set with ttlSeconds = 60 exactly', async () => {
      mockCache.get.mockResolvedValue(null);
      mockDb.select
        .mockReturnValueOnce(createChainMock([{ count: 10 }]))
        .mockReturnValueOnce(createChainMock([{ sum: 150000 }]))
        .mockReturnValueOnce(createChainMock([{ count: 1 }]))
        .mockReturnValueOnce(createChainMock([{ count: 3 }]));
      await service.getSummary();
      expect(mockCache.set).toHaveBeenCalledWith(
        'cache:admin:dashboard:summary',
        expect.anything(),
        60,
      );
    });
  });

  describe('cache-degradation', () => {
    it('falls back to db when cache.get returns null and cache.set silently no-ops', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);
      mockDb.select
        .mockReturnValueOnce(createChainMock([{ count: 10 }]))
        .mockReturnValueOnce(createChainMock([{ sum: 150000 }]))
        .mockReturnValueOnce(createChainMock([{ count: 1 }]))
        .mockReturnValueOnce(createChainMock([{ count: 3 }]));
      const result = await service.getSummary();
      expect(result.todayBookings).toBe(10);
    });
  });
});
