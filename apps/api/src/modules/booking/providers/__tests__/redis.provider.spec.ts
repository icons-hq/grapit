import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import IORedis, { type Cluster } from 'ioredis';
import {
  ASSERT_OWNED_SEAT_LOCKS_LUA,
  CONSUME_OWNED_SEAT_LOCKS_LUA,
  EXTEND_OWNED_SEAT_LOCKS_LUA,
  REFRESH_PAYMENT_CONFIRM_LOCK_LUA,
  RELEASE_PAYMENT_CONFIRM_LOCK_LUA,
} from '../../booking.service.js';
import { redisProvider, REDIS_CLIENT } from '../redis.provider.js';
import { getRedisRuntimeMetadata } from '../redis.provider.js';
import {
  smsAttemptsKey,
  smsOtpKey,
  smsResendKey,
  smsSendCounterKey,
} from '../../../sms/sms.service.js';

const TEST_PHONE = '+821012345678';

/**
 * redisProvider factory tests (Phase 07-04 review fix).
 *
 * Verifies production hard-fail behavior added to prevent silent InMemoryRedis
 * fallback on Cloud Run secret binding misconfig. See 07-REVIEWS.md HIGH concern
 * (Codex + Claude CLI consensus #1) and T-07-10 threat mitigation.
 */

type RedisProviderClient = IORedis | Cluster;
type UseFactory = (config: ConfigService) => RedisProviderClient;

function createMockConfig(values: { url?: string; mode?: string } = {}): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
      const configValues: Record<string, string | undefined> = {
        'redis.url': values.url,
        'redis.mode': values.mode,
      };
      return configValues[key] ?? defaultValue ?? '';
    }),
  } as unknown as ConfigService;
}

function stringifyConsoleCalls(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.flat().map(String).join('\n');
}

function expectNoSensitiveRedisDetails(output: string): void {
  expect(output).not.toContain('redis://');
  expect(output).not.toContain('10.0.0.1');
  expect(output).not.toContain('Authorization');
  expect(output).not.toContain('Cookie');
  expect(output).not.toContain('JWT');
}

describe('redisProvider factory', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  let useFactory: UseFactory;

  beforeEach(() => {
    // redisProvider.useFactory is the function we test
    useFactory = redisProvider.useFactory as UseFactory;
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('exposes the REDIS_CLIENT injection symbol', () => {
    expect(redisProvider.provide).toBe(REDIS_CLIENT);
  });

  it('throws when NODE_ENV=production and REDIS_URL is empty (hard-fail guard)', () => {
    process.env['NODE_ENV'] = 'production';
    const config = createMockConfig({ url: '', mode: 'cluster' });

    expect(() => useFactory(config)).toThrowError(/REDIS_URL is required in production/);
  });

  it('throws when NODE_ENV=production and REDIS_URL is set but VALKEY_MODE is missing', () => {
    process.env['NODE_ENV'] = 'production';
    const config = createMockConfig({ url: 'redis://10.0.0.1:6379', mode: '' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => useFactory(config)).toThrowError(/VALKEY_MODE is required in production/);

    const output = `${stringifyConsoleCalls(warnSpy)}\n${stringifyConsoleCalls(errorSpy)}`;
    expectNoSensitiveRedisDetails(output);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('throws when VALKEY_MODE=sentinel because mode must be explicit standalone or cluster', () => {
    process.env['NODE_ENV'] = 'production';
    const config = createMockConfig({ url: 'redis://10.0.0.1:6379', mode: 'sentinel' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => useFactory(config)).toThrowError(/VALKEY_MODE must be one of: standalone, cluster/);

    const output = `${stringifyConsoleCalls(warnSpy)}\n${stringifyConsoleCalls(errorSpy)}`;
    expectNoSensitiveRedisDetails(output);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns InMemoryRedis mock when NODE_ENV=development and REDIS_URL is empty', () => {
    process.env['NODE_ENV'] = 'development';
    const config = createMockConfig({ url: '' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = useFactory(config) as unknown as { set: unknown; get: unknown; eval: unknown };

    expect(typeof client.set).toBe('function');
    expect(typeof client.get).toBe('function');
    expect(typeof client.eval).toBe('function');
    expect(getRedisRuntimeMetadata(client)).toEqual({
      mode: 'in-memory',
      client: 'in-memory',
      configured: false,
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns InMemoryRedis mock when NODE_ENV=test and REDIS_URL is empty', () => {
    process.env['NODE_ENV'] = 'test';
    const config = createMockConfig({ url: '' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = useFactory(config) as unknown as { set: unknown };
    expect(typeof client.set).toBe('function');
    warnSpy.mockRestore();
  });

  it('returns a real ioredis instance when REDIS_URL is set (production)', () => {
    process.env['NODE_ENV'] = 'production';
    const config = createMockConfig({ url: 'redis://localhost:6379', mode: 'standalone' });

    const client = useFactory(config);

    // Real ioredis has duplicate() — InMemoryRedis mock does not
    expect(typeof (client as IORedis).duplicate).toBe('function');
    expect(getRedisRuntimeMetadata(client)).toEqual({
      mode: 'standalone',
      client: 'ioredis-standalone',
      configured: true,
    });

    // Clean up to avoid vitest hanging on open socket
    (client as IORedis).disconnect();
  });

  it('creates an ioredis-cluster client with runtime metadata when VALKEY_MODE=cluster', () => {
    process.env['NODE_ENV'] = 'production';
    const config = createMockConfig({ url: 'redis://localhost:6379', mode: 'cluster' });

    const client = useFactory(config);

    expect(getRedisRuntimeMetadata(client)).toEqual({
      mode: 'cluster',
      client: 'ioredis-cluster',
      configured: true,
    });

    (client as Cluster).disconnect();
  });

  /**
   * Phase 10.1 review (WR-01): SmsService depends on ioredis variadic set(),
   * decr(), pttl(), and pipeline(). The InMemoryRedis mock must cover these
   * so local dev without REDIS_URL doesn't crash the SMS send path.
   */
  describe('InMemoryRedis surface parity with ioredis (Phase 10.1 WR-01)', () => {
    type MemRedis = {
      set: (key: string, value: string, ...args: unknown[]) => Promise<string | null>;
      get: (key: string) => Promise<string | null>;
      del: (...keys: string[]) => Promise<number>;
      decr: (key: string) => Promise<number>;
      ping: () => Promise<string>;
      pttl: (key: string) => Promise<number>;
      ttl: (key: string) => Promise<number>;
      eval: (script: string, numKeys: number, ...keysAndArgs: (string | number)[]) => Promise<unknown>;
      sadd: (key: string, ...members: string[]) => Promise<number>;
      srem: (key: string, ...members: string[]) => Promise<number>;
      smembers: (key: string) => Promise<string[]>;
      pipeline: () => {
        set: (key: string, value: string, ...args: unknown[]) => ReturnType<MemRedis['pipeline']>;
        del: (...keys: string[]) => ReturnType<MemRedis['pipeline']>;
        exec: () => Promise<Array<[Error | null, unknown]>>;
      };
    };

    function createMock(): MemRedis {
      process.env['NODE_ENV'] = 'test';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = useFactory(createMockConfig({ url: '' })) as unknown as MemRedis;
      warnSpy.mockRestore();
      return client;
    }

    it('ping() returns PONG for local health checks', async () => {
      const redis = createMock();

      await expect(redis.ping()).resolves.toBe('PONG');
    });

    it('set(key, value, "PX", ms, "NX") honors NX + TTL (ioredis variadic)', async () => {
      const redis = createMock();
      // [Phase 14 / WR-01] Source the key via sms.service's exported builder so
      // the mock exercises the exact string SmsService produces at runtime.
      const key = smsResendKey(TEST_PHONE);
      const first = await redis.set(key, '1', 'PX', 30_000, 'NX');
      expect(first).toBe('OK');

      // Second NX call must fail while key is live
      const second = await redis.set(key, '1', 'PX', 30_000, 'NX');
      expect(second).toBeNull();

      // pttl returns remaining milliseconds for a key with TTL
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30_000);
    });

    it('set(key, value, "EX", seconds) mirrors CacheService cache-set', async () => {
      const redis = createMock();
      const ok = await redis.set('cache:perf:123', '{"v":1}', 'EX', 300);
      expect(ok).toBe('OK');
      expect(await redis.get('cache:perf:123')).toBe('{"v":1}');
    });

    it('set(key, value) clears a previous TTL like real Redis', async () => {
      const redis = createMock();
      await redis.set('cache:ttl-clear', 'expires', 'EX', 60);
      expect(await redis.pttl('cache:ttl-clear')).toBeGreaterThan(0);

      await redis.set('cache:ttl-clear', 'persistent');

      expect(await redis.get('cache:ttl-clear')).toBe('persistent');
      expect(await redis.pttl('cache:ttl-clear')).toBe(-1);
      expect(await redis.ttl('cache:ttl-clear')).toBe(-1);
    });

    it('decr() decrements and can go below zero (rollback parity with real Redis)', async () => {
      const redis = createMock();
      // [Phase 14 / WR-01] Source the key via sms.service's exported builder so
      // the mock exercises the exact string SmsService produces at runtime.
      const key = smsSendCounterKey(TEST_PHONE);
      await redis.set(key, '3');
      expect(await redis.decr(key)).toBe(2);
      expect(await redis.decr(key)).toBe(1);
    });

    it('pttl returns -2 for missing key, -1 for key without TTL', async () => {
      const redis = createMock();
      expect(await redis.pttl('nope')).toBe(-2);
      await redis.set('bare', '1');
      expect(await redis.pttl('bare')).toBe(-1);
    });

    it('pipeline().set().del().exec() returns ioredis-style [err, res] tuples', async () => {
      const redis = createMock();
      const pipe = redis.pipeline();
      const results = await pipe
        .set(smsOtpKey(TEST_PHONE), '654321', 'PX', 180_000)
        .del(smsAttemptsKey(TEST_PHONE))
        .exec();

      expect(results).toHaveLength(2);
      expect(results[0]?.[0]).toBeNull();
      expect(results[0]?.[1]).toBe('OK');
      expect(results[1]?.[0]).toBeNull();
      expect(typeof results[1]?.[1]).toBe('number');

      // Post-pipeline state: OTP stored with TTL (Phase 14 hash-tag form)
      expect(await redis.get(smsOtpKey(TEST_PHONE))).toBe('654321');
    });

    it('del() deletes string keys, set keys, and returns the number of removed keys', async () => {
      const redis = createMock();
      await redis.set('string:key', 'value', 'EX', 60);
      await redis.sadd('set:key', 'A-1', 'A-2');

      await expect(redis.del('string:key', 'set:key', 'missing:key'))
        .resolves
        .toBe(2);

      expect(await redis.get('string:key')).toBeNull();
      expect(await redis.smembers('set:key')).toEqual([]);
    });

    describe('lock ownership Lua parity', () => {
      const showtimeId = 'showtime-owned';
      const userId = 'user-123';
      const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
      const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
      const seatA1Key = `{${showtimeId}}:seat:A-1`;
      const seatA2Key = `{${showtimeId}}:seat:A-2`;

      it('ASSERT_OWNED_SEAT_LOCKS_LUA returns success tuple when every requested lock is owned', async () => {
        const redis = createMock();
        await redis.set(seatA1Key, userId);
        await redis.set(seatA2Key, userId);

        await expect(redis.eval(
          ASSERT_OWNED_SEAT_LOCKS_LUA,
          2,
          seatA1Key,
          seatA2Key,
          userId,
          'A-1',
          'A-2',
        )).resolves.toEqual([1, 'OK', '2', '']);
      });

      it('ASSERT_OWNED_SEAT_LOCKS_LUA returns MISSING tuple for missing or expired locks', async () => {
        const redis = createMock();
        await redis.set(seatA1Key, userId);

        await expect(redis.eval(
          ASSERT_OWNED_SEAT_LOCKS_LUA,
          2,
          seatA1Key,
          seatA2Key,
          userId,
          'A-1',
          'A-2',
        )).resolves.toEqual([0, 'MISSING', 'A-2', '']);
      });

      it('ASSERT_OWNED_SEAT_LOCKS_LUA returns OTHER_OWNER tuple with current owner', async () => {
        const redis = createMock();
        await redis.set(seatA1Key, userId);
        await redis.set(seatA2Key, 'other-user');

        await expect(redis.eval(
          ASSERT_OWNED_SEAT_LOCKS_LUA,
          2,
          seatA1Key,
          seatA2Key,
          userId,
          'A-1',
          'A-2',
        )).resolves.toEqual([0, 'OTHER_OWNER', 'A-2', 'other-user']);
      });

      it('lock seat cleanup does not count stale user-seat members owned by another user', async () => {
        const redis = createMock();
        const otherSeatKey = `{${showtimeId}}:seat:A-3`;
        const newSeatKey = `{${showtimeId}}:seat:A-4`;
        await redis.set(seatA1Key, userId);
        await redis.set(seatA2Key, userId);
        await redis.set(otherSeatKey, 'other-user');
        await redis.sadd(userSeatsKey, 'A-1', 'A-2', 'A-3');
        await redis.sadd(lockedSeatsKey, 'A-1', 'A-2', 'A-3');

        await expect(redis.eval(
          'lock-seat-lua',
          3,
          userSeatsKey,
          newSeatKey,
          lockedSeatsKey,
          userId,
          '600',
          '3',
          'A-4',
          `{${showtimeId}}:seat:`,
        )).resolves.toEqual([1, newSeatKey, 'A-4']);

        expect(await redis.get(newSeatKey)).toBe(userId);
        expect(await redis.smembers(userSeatsKey)).not.toContain('A-3');
        expect(await redis.smembers(lockedSeatsKey)).toContain('A-3');
      });

      it('CONSUME_OWNED_SEAT_LOCKS_LUA returns success tuple and preserves unrelated same-showtime locks', async () => {
        const redis = createMock();
        const seatA3Key = `{${showtimeId}}:seat:A-3`;
        await redis.set(seatA1Key, userId);
        await redis.set(seatA2Key, userId);
        await redis.set(seatA3Key, userId);
        await redis.sadd(userSeatsKey, 'A-1', 'A-2', 'A-3');
        await redis.sadd(lockedSeatsKey, 'A-1', 'A-2', 'A-3');

        await expect(redis.eval(
          CONSUME_OWNED_SEAT_LOCKS_LUA,
          4,
          userSeatsKey,
          lockedSeatsKey,
          seatA1Key,
          seatA2Key,
          userId,
          'A-1',
          'A-2',
        )).resolves.toEqual([1, 'OK', '2', '']);

        expect(await redis.get(seatA1Key)).toBeNull();
        expect(await redis.get(seatA2Key)).toBeNull();
        expect(await redis.get(seatA3Key)).toBe(userId);
        expect(await redis.smembers(userSeatsKey)).toContain('A-3');
        expect(await redis.smembers(lockedSeatsKey)).toContain('A-3');
      });

      it('EXTEND_OWNED_SEAT_LOCKS_LUA extends owned seat lock TTLs without consuming them', async () => {
        const redis = createMock();
        await redis.set(seatA1Key, userId, 'EX', 10);
        await redis.set(seatA2Key, userId, 'EX', 10);
        await redis.sadd(userSeatsKey, 'A-1', 'A-2');
        await redis.expire(userSeatsKey, 10);

        await expect(redis.eval(
          EXTEND_OWNED_SEAT_LOCKS_LUA,
          3,
          userSeatsKey,
          seatA1Key,
          seatA2Key,
          userId,
          '60',
          'A-1',
          'A-2',
        )).resolves.toEqual([1, 'OK', '2', '']);

        expect(await redis.get(seatA1Key)).toBe(userId);
        expect(await redis.get(seatA2Key)).toBe(userId);
        expect(await redis.smembers(userSeatsKey)).toEqual(['A-1', 'A-2']);
        expect(await redis.ttl(seatA1Key)).toBeGreaterThan(10);
        expect(await redis.ttl(userSeatsKey)).toBeGreaterThan(10);
      });

      it('EXTEND_OWNED_SEAT_LOCKS_LUA does not shorten longer existing TTLs', async () => {
        const redis = createMock();
        await redis.set(seatA1Key, userId, 'EX', 300);
        await redis.sadd(userSeatsKey, 'A-1');
        await redis.expire(userSeatsKey, 300);

        await expect(redis.eval(
          EXTEND_OWNED_SEAT_LOCKS_LUA,
          2,
          userSeatsKey,
          seatA1Key,
          userId,
          '60',
          'A-1',
        )).resolves.toEqual([1, 'OK', '1', '']);

        expect(await redis.ttl(seatA1Key)).toBeGreaterThan(60);
        expect(await redis.ttl(userSeatsKey)).toBeGreaterThan(60);
      });

      it('RELEASE_PAYMENT_CONFIRM_LOCK_LUA deletes only the matching order lock token', async () => {
        const redis = createMock();
        const lockKey = '{payment-confirm}:order-123';
        await redis.set(lockKey, 'token-123', 'EX', 60);

        await expect(redis.eval(
          RELEASE_PAYMENT_CONFIRM_LOCK_LUA,
          1,
          lockKey,
          'wrong-token',
        )).resolves.toBe(0);
        expect(await redis.get(lockKey)).toBe('token-123');

        await expect(redis.eval(
          RELEASE_PAYMENT_CONFIRM_LOCK_LUA,
          1,
          lockKey,
          'token-123',
        )).resolves.toBe(1);
        expect(await redis.get(lockKey)).toBeNull();
      });

      it('REFRESH_PAYMENT_CONFIRM_LOCK_LUA extends only the matching order lock token', async () => {
        const redis = createMock();
        const lockKey = '{payment-confirm}:order-refresh';
        await redis.set(lockKey, 'token-123', 'EX', 10);

        await expect(redis.eval(
          REFRESH_PAYMENT_CONFIRM_LOCK_LUA,
          1,
          lockKey,
          'wrong-token',
          '60',
        )).resolves.toBe(0);
        expect(await redis.ttl(lockKey)).toBeLessThanOrEqual(10);

        await expect(redis.eval(
          REFRESH_PAYMENT_CONFIRM_LOCK_LUA,
          1,
          lockKey,
          'token-123',
          '60',
        )).resolves.toBe(1);
        expect(await redis.ttl(lockKey)).toBeGreaterThan(10);
      });
    });
  });
});
