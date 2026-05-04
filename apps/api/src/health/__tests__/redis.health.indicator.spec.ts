import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisHealthIndicator } from '../redis.health.indicator.js';
import type { RedisRuntimeMetadata } from '../../modules/booking/providers/redis.provider.js';

const redisProviderMock = vi.hoisted(() => ({
  getRedisRuntimeMetadata: vi.fn((redis: unknown): RedisRuntimeMetadata => {
    return (redis as { __testRedisRuntimeMetadata?: RedisRuntimeMetadata })
      .__testRedisRuntimeMetadata ?? {
      mode: 'in-memory',
      client: 'in-memory',
      configured: false,
    };
  }),
}));

vi.mock('../../modules/booking/providers/redis.provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/booking/providers/redis.provider.js')>();
  return {
    ...actual,
    getRedisRuntimeMetadata: redisProviderMock.getRedisRuntimeMetadata,
  };
});

/**
 * RedisHealthIndicator unit tests (Phase 07-05 review fix).
 *
 * Verifies ping-based up/down reporting using Terminus 11's
 * HealthIndicatorService.check(key) API. We mock both the Terminus
 * session and the injected ioredis client so these tests stay fast
 * and deterministic; the real Valkey roundtrip is covered by the
 * sibling integration spec under booking/__tests__.
 */

type IndicatorResult = {
  [key: string]: {
    status: 'up' | 'down';
    message?: string;
    mode?: RedisRuntimeMetadata['mode'];
    client?: RedisRuntimeMetadata['client'];
    configured?: boolean;
  };
};

function withRedisMetadata<T extends object>(
  redis: T,
  metadata: RedisRuntimeMetadata,
): T {
  return Object.assign(redis, {
    __testRedisRuntimeMetadata: metadata,
  });
}

function createMockHealthService() {
  return {
    check: vi.fn((key: string) => ({
      up: vi.fn((data?: unknown) => ({
        [key]: { status: 'up' as const, ...(data as Record<string, unknown> | undefined) },
      })),
      down: vi.fn((data?: unknown) => ({
        [key]: { status: 'down' as const, ...(data as Record<string, unknown> | undefined) },
      })),
    })),
  };
}

function createMockRedis() {
  return withRedisMetadata({ ping: vi.fn() }, {
    mode: 'cluster',
    client: 'ioredis-cluster',
    configured: true,
  });
}

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockHealth: ReturnType<typeof createMockHealthService>;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockHealth = createMockHealthService();
    mockRedis = createMockRedis();
    indicator = new RedisHealthIndicator(mockHealth as never, mockRedis as never);
  });

  it('reports up when redis.ping() returns PONG', async () => {
    mockRedis.ping.mockResolvedValueOnce('PONG');

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;

    expect(mockRedis.ping).toHaveBeenCalledOnce();
    expect(result['redis']?.status).toBe('up');
    expect(result['redis']?.mode).toBe('cluster');
    expect(result['redis']?.client).toBe('ioredis-cluster');
    expect(result['redis']?.configured).toBe(true);
  });

  it('reports up when redis client has no ping method (local in-memory fallback)', async () => {
    const redisWithoutPing = withRedisMetadata({ get: vi.fn() }, {
      mode: 'in-memory',
      client: 'in-memory',
      configured: false,
    });
    indicator = new RedisHealthIndicator(mockHealth as never, redisWithoutPing as never);

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;

    expect(result['redis']?.status).toBe('up');
    expect(result['redis']?.mode).toBe('in-memory');
    expect(result['redis']?.client).toBe('in-memory');
    expect(result['redis']?.configured).toBe(false);
    expect(result['redis']?.message).toContain('ping unavailable');
  });

  it('reports down when a configured redis client has no ping method', async () => {
    const malformedRedis = withRedisMetadata({ get: vi.fn() }, {
      mode: 'cluster',
      client: 'ioredis-cluster',
      configured: true,
    });
    indicator = new RedisHealthIndicator(mockHealth as never, malformedRedis as never);

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;

    expect(result['redis']?.status).toBe('down');
    expect(result['redis']?.mode).toBe('cluster');
    expect(result['redis']?.client).toBe('ioredis-cluster');
    expect(result['redis']?.configured).toBe(true);
    expect(result['redis']?.message).toBe('redis ping unavailable');
  });

  it('reports down when redis.ping() rejects with error', async () => {
    mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;

    expect(result['redis']?.status).toBe('down');
    expect(result['redis']?.mode).toBe('cluster');
    expect(result['redis']?.client).toBe('ioredis-cluster');
    expect(result['redis']?.configured).toBe(true);
    expect(result['redis']?.message).toContain('ECONNREFUSED');
  });

  it('reports down when redis.ping() rejects with a non-Error value', async () => {
    mockRedis.ping.mockRejectedValueOnce('ECONNRESET');

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;

    expect(result['redis']?.status).toBe('down');
    expect(result['redis']?.mode).toBe('cluster');
    expect(result['redis']?.message).toContain('ECONNRESET');
  });

  it('redacts redis:// and rediss:// URLs from down messages', async () => {
    mockRedis.ping.mockRejectedValueOnce(new Error(
      'failed redis://:secret@10.0.0.1:6379 and rediss://default:secret@10.0.0.2:6380 '
      + 'Authorization: Bearer super-secret-bearer Cookie: session=topsecret '
      + 'JWT: header.payload.signature token=secret',
    ));

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;
    const serialized = JSON.stringify(result);

    expect(result['redis']?.status).toBe('down');
    expect(result['redis']?.message).toContain('[redacted redis url]');
    expect(serialized).not.toContain('redis://');
    expect(serialized).not.toContain('rediss://');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('super-secret-bearer');
    expect(serialized).not.toContain('session=topsecret');
    expect(serialized).not.toContain('header.payload.signature');
  });

  it('reports down when redis.ping() returns unexpected value', async () => {
    mockRedis.ping.mockResolvedValueOnce('NOT_PONG');

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;

    expect(result['redis']?.status).toBe('down');
    expect(result['redis']?.message).toContain('NOT_PONG');
  });

  it('does not expose Redis URLs, auth headers, JWTs, phone numbers, or payment data in health output', async () => {
    const sensitiveRedis = withRedisMetadata({
      ping: vi.fn().mockResolvedValueOnce('PONG'),
      url: 'redis://:secret@example.internal:6379',
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
      },
      JWT: 'header.payload.signature',
      phone: '+821012345678',
      paymentKey: 'paymentKey=secret',
    }, {
      mode: 'cluster',
      client: 'ioredis-cluster',
      configured: true,
    });
    indicator = new RedisHealthIndicator(mockHealth as never, sensitiveRedis as never);

    const result = (await indicator.isHealthy('redis')) as IndicatorResult;
    const serialized = JSON.stringify(result);

    expect(result['redis']?.status).toBe('up');
    expect(result['redis']?.client).toBe('ioredis-cluster');
    expect(serialized).not.toContain('redis://');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Cookie');
    expect(serialized).not.toContain('JWT');
    expect(serialized).not.toContain('+821012345678');
    expect(serialized).not.toContain('paymentKey=secret');
  });
});
