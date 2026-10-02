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

  describe('getOrLoad()', () => {
    it('returns a cached value without running the loader', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ id: 'cached' }));
      const loader = vi.fn();

      await expect(service.getOrLoad('cache:test:key', loader)).resolves.toEqual({ id: 'cached' });

      expect(loader).not.toHaveBeenCalled();
    });

    it('coalesces concurrent misses for one key into a single loader call', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      let release!: (value: { value: { id: string }; ttlSeconds: number }) => void;
      const loader = vi.fn(() => new Promise<{ value: { id: string }; ttlSeconds: number }>((resolve) => {
        release = resolve;
      }));

      const callers = Array.from({ length: 50 }, () => service.getOrLoad('cache:test:hot', loader));
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
      release({ value: { id: 'fresh' }, ttlSeconds: 30 });

      const results = await Promise.all(callers);
      expect(results.every((result) => result.id === 'fresh')).toBe(true);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledWith('cache:test:hot', JSON.stringify({ id: 'fresh' }), 'EX', 30);
    });

    it('releases the in-flight slot after a failure so the next request retries', async () => {
      mockRedis.get.mockResolvedValue(null);
      const loader = vi.fn()
        .mockRejectedValueOnce(new Error('pool timeout'))
        .mockResolvedValueOnce({ value: 'ok', ttlSeconds: 10 });

      await expect(service.getOrLoad('cache:test:retry', loader)).rejects.toThrow('pool timeout');
      await expect(service.getOrLoad('cache:test:retry', loader)).resolves.toBe('ok');
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('does not cache values returned with a null TTL', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.getOrLoad('cache:test:missing', async () => ({ value: null, ttlSeconds: null })))
        .resolves.toBeNull();

      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('skips Redis entirely when readThrough is false', async () => {
      await expect(service.getOrLoad(
        'cache:test:bypass',
        async () => ({ value: 'db', ttlSeconds: 300 }),
        { readThrough: false },
      )).resolves.toBe('db');

      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('generations', () => {
    it('reads the initial generation when a scope was never bumped', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await expect(service.getGeneration('catalog:list')).resolves.toBe('0');
      expect(mockRedis.get).toHaveBeenCalledWith('cache:generation:catalog:list');
    });

    it('bumps to a fresh token with a TTL longer than any cached payload', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await service.bumpGeneration('catalog:detail:perf-1');
      await service.bumpGeneration('catalog:detail:perf-1');

      const [first, second] = mockRedis.set.mock.calls;
      expect(first?.[0]).toBe('cache:generation:catalog:detail:perf-1');
      expect(first?.[2]).toBe('EX');
      expect(first?.[3]).toBeGreaterThan(300);
      expect(first?.[1]).not.toBe(second?.[1]);
    });

    it('returns null instead of a guessed generation when Redis fails', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});

      await expect(service.getGeneration('catalog:list')).resolves.toBeNull();
    });

    it('swallows bump failures after the DB commit', async () => {
      mockRedis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});

      await expect(service.bumpGeneration('catalog:list')).resolves.toBeUndefined();
    });

    it('keeps generation keys outside every catalog invalidation pattern', () => {
      for (const pattern of [
        /^cache:performances:list:/,
        /^cache:home:/,
        /^cache:performances:detail:/,
      ]) {
        expect(pattern.test('cache:generation:catalog:list')).toBe(false);
      }
    });
  });
});
