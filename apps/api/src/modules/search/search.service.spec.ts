import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SearchResponse } from '@grabit/shared';

import { SearchService } from './search.service.js';

const PHASE23_I18N_SMOKE_PERFORMANCE_ID =
  '00000000-0000-4000-8000-000000000023';

/**
 * Phase 2 Plan 00: RED-state test stubs for SearchService
 *
 * These tests describe the expected contract for SearchService:
 * - search: full-text search using tsvector with ILIKE fallback
 * - genre filter, ended filter, pagination
 *
 * Services will be implemented in Plan 02. Tests should turn GREEN then.
 */

function createChainableMock() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'from',
    'where',
    'leftJoin',
    'innerJoin',
    'limit',
    'offset',
    'orderBy',
    'groupBy',
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
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

function createMockDb() {
  const chainable = createChainableMock();
  return {
    select: vi.fn().mockReturnValue(chainable),
    execute: vi.fn().mockResolvedValue([]),
    _chainable: chainable,
  };
}

describe('SearchService', () => {
  let service: SearchService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new SearchService(mockDb as unknown as ConstructorParameters<typeof SearchService>[0]);
  });

  describe('search', () => {
    it('should search using tsvector when query provided', async () => {
      const result: SearchResponse = await service.search({
        q: 'hamlet',
        page: 1,
        limit: 20,
      });

      // When GREEN, should verify SQL contains search_vector @@ plainto_tsquery
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('query');
      expect(result.query).toBe('hamlet');
    });

    it('should fall back to ILIKE when tsvector returns no results', async () => {
      // First call (tsvector) returns empty, second call (ILIKE) returns results
      const result: SearchResponse = await service.search({
        q: 'partial keyword',
        page: 1,
        limit: 20,
      });

      // When GREEN, should verify ILIKE pattern used as fallback
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('query');
    });

    it('should filter by genre when genre param provided', async () => {
      const result: SearchResponse = await service.search({
        q: 'concert',
        genre: 'concert',
        page: 1,
        limit: 20,
      });

      // When GREEN, should verify WHERE genre = 'concert'
      expect(result).toHaveProperty('data');
    });

    it('should exclude ended performances when ended=false', async () => {
      const result: SearchResponse = await service.search({
        q: 'test',
        ended: false,
        page: 1,
        limit: 20,
      });

      // When GREEN, should verify WHERE status != 'ended'
      expect(result).toHaveProperty('data');
    });

    it('should return paginated SearchResponse with query field', async () => {
      const result: SearchResponse = await service.search({
        q: 'musical theater',
        page: 2,
        limit: 10,
      });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('totalPages');
      expect(result).toHaveProperty('query');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.query).toBe('musical theater');
    });

    it('overlays reviewed translated titles on foreign-locale search results', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createChainableResult([
            {
              id: PHASE23_I18N_SMOKE_PERFORMANCE_ID,
              title: '2026 걸룰스 팬미팅',
              genre: 'concert',
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

      const result = await service.search({
        q: 'girl',
        genre: 'concert',
        page: 1,
        limit: 20,
        locale: 'en',
      } as never);

      expect(result.data[0]?.title).toBe('2026 Girl Rules Fanmeeting');
      expect(result.data[0]?.automaticTranslationLabel).toBe(true);
      expect(result.data[0]?.translatedBy).toBe('machine_reviewed');
    });
  });
});
