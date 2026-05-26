import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CacheService } from '../cache.service.js';

/**
 * CacheService unit tests (Phase 07-02).
 *
 * Covers:
 * - get() returns null on miss
 * - set() + get() round-trip with JSON serialization
 * - set() uses TTL 300 seconds ('EX', 300) as default (per D-08)
 * - invalidate() deletes provided keys one by one for Valkey Cluster
 * - invalidatePattern() scans matching keys and deletes them one by one
 * - invalidatePattern() no-op when keys array is empty
 * - Graceful degradation: get()/set() swallow redis errors
 */

function createMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  };
}

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    service = new CacheService(mockRedis as never);
  });

  describe('get()', () => {
    it('returns null when key does not exist', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.get<{ id: string }>('cache:test:missing');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('cache:test:missing');
    });

    it('returns parsed object when value exists', async () => {
      const stored = { id: 'abc', title: 'test' };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(stored));

      const result = await service.get<typeof stored>('cache:test:hit');

      expect(result).toEqual(stored);
    });

    it('returns null on redis error (graceful degradation)', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.get<unknown>('cache:test:error');

      expect(result).toBeNull();
    });

    it('returns null when stored value is invalid JSON (graceful degradation)', async () => {
      mockRedis.get.mockResolvedValueOnce('not-json{{');

      const result = await service.get<unknown>('cache:test:bad-json');

      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('stores value with EX 300 TTL by default', async () => {
      const data = { foo: 'bar' };

      await service.set('cache:test:key', data);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'cache:test:key',
        JSON.stringify(data),
        'EX',
        300,
      );
    });

    it('supports custom TTL', async () => {
      await service.set('cache:test:key', { a: 1 }, 60);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'cache:test:key',
        JSON.stringify({ a: 1 }),
        'EX',
        60,
      );
    });

    it('swallows redis errors during set (graceful degradation)', async () => {
      mockRedis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.set('cache:test:key', { a: 1 })).resolves.toBeUndefined();
    });
  });

  describe('invalidate()', () => {
    it('deletes provided keys one by one when at least one key is passed', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.invalidate('cache:a', 'cache:b');

      expect(mockRedis.del).toHaveBeenNthCalledWith(1, 'cache:a');
      expect(mockRedis.del).toHaveBeenNthCalledWith(2, 'cache:b');
    });

    it('does not call redis.del when no keys are passed', async () => {
      await service.invalidate();

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('invalidatePattern()', () => {
    it('falls back to redis.keys when scan is unavailable and deletes matches one by one', async () => {
      mockRedis.keys.mockResolvedValueOnce([
        'cache:performances:list:musical:1:20:latest:false:none',
        'cache:performances:list:musical:2:20:latest:false:none',
      ]);
      mockRedis.del.mockResolvedValue(1);

      await service.invalidatePattern('cache:performances:list:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('cache:performances:list:*');
      expect(mockRedis.del).toHaveBeenNthCalledWith(
        1,
        'cache:performances:list:musical:1:20:latest:false:none',
      );
      expect(mockRedis.del).toHaveBeenNthCalledWith(
        2,
        'cache:performances:list:musical:2:20:latest:false:none',
      );
    });

    it('scans every cluster master and deletes de-duplicated matches one by one', async () => {
      const masterA = {
        scan: vi.fn()
          .mockResolvedValueOnce(['42', ['cache:home:banners']])
          .mockResolvedValueOnce(['0', ['cache:home:hot:ko']]),
      };
      const masterB = {
        scan: vi.fn()
          .mockResolvedValueOnce(['0', ['cache:home:banners', 'cache:home:new:ko']]),
      };
      (mockRedis as unknown as {
        nodes: ReturnType<typeof vi.fn>;
      }).nodes = vi.fn().mockReturnValue([masterA, masterB]);
      mockRedis.del.mockResolvedValue(1);

      await service.invalidatePattern('cache:home:*');

      expect(mockRedis.keys).not.toHaveBeenCalled();
      expect(masterA.scan).toHaveBeenNthCalledWith(
        1,
        '0',
        'MATCH',
        'cache:home:*',
        'COUNT',
        250,
      );
      expect(masterA.scan).toHaveBeenNthCalledWith(
        2,
        '42',
        'MATCH',
        'cache:home:*',
        'COUNT',
        250,
      );
      expect(masterB.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'cache:home:*',
        'COUNT',
        250,
      );
      expect(mockRedis.del).toHaveBeenNthCalledWith(1, 'cache:home:banners');
      expect(mockRedis.del).toHaveBeenNthCalledWith(2, 'cache:home:hot:ko');
      expect(mockRedis.del).toHaveBeenNthCalledWith(3, 'cache:home:new:ko');
    });

    it('does not call redis.del when keys() returns empty array', async () => {
      mockRedis.keys.mockResolvedValueOnce([]);

      await service.invalidatePattern('cache:home:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('cache:home:*');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('invalidate() error handling', () => {
    it('swallows redis errors and logs a warning (does not throw)', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});

      await expect(
        service.invalidate('cache:performances:detail:abc', 'cache:home:banners'),
      ).resolves.toBeUndefined();

      expect(mockRedis.del).toHaveBeenNthCalledWith(1, 'cache:performances:detail:abc');
      expect(mockRedis.del).toHaveBeenNthCalledWith(2, 'cache:home:banners');
      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0] as unknown[];
      const payload = warnCall[0] as { err: string; op: string };
      expect(payload.op).toBe('invalidate');
      expect(payload.err).toBe('ECONNREFUSED');

      warnSpy.mockRestore();
    });
  });

  describe('invalidatePattern() error handling', () => {
    it('swallows redis errors and logs a warning (does not throw)', async () => {
      mockRedis.keys.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});

      await expect(service.invalidatePattern('cache:home:*')).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0] as unknown[];
      const payload = warnCall[0] as { err: string; op: string; pattern: string };
      expect(payload.op).toBe('invalidatePattern');
      expect(payload.err).toBe('ECONNREFUSED');
      expect(payload.pattern).toBe('cache:home:*');

      warnSpy.mockRestore();
    });

    it('swallows redis.del errors after successful keys() lookup', async () => {
      mockRedis.keys.mockResolvedValueOnce(['cache:home:banners', 'cache:home:hot:ko']);
      mockRedis.del
        .mockRejectedValueOnce(new Error('CROSSSLOT Keys in request don\'t hash to the same slot'))
        .mockResolvedValueOnce(1);
      const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});

      await expect(service.invalidatePattern('cache:home:*')).resolves.toBeUndefined();
      expect(mockRedis.del).toHaveBeenNthCalledWith(1, 'cache:home:banners');
      expect(mockRedis.del).toHaveBeenNthCalledWith(2, 'cache:home:hot:ko');
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('round-trip', () => {
    it('set() followed by get() returns the same object', async () => {
      const data = { id: 'perf-1', title: '레미제라블', viewCount: 42 };

      await service.set('cache:performances:detail:perf-1', data);

      // Simulate what redis would return: the JSON string that was set
      const setCall = mockRedis.set.mock.calls[0];
      const storedValue = setCall?.[1] as string;
      mockRedis.get.mockResolvedValueOnce(storedValue);

      const result = await service.get<typeof data>('cache:performances:detail:perf-1');

      expect(result).toEqual(data);
    });
  });
});
