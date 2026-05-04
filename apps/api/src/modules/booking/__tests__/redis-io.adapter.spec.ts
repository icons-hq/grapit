import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import IORedis, { Cluster } from 'ioredis';
import { RedisIoAdapter } from '../providers/redis-io.adapter.js';

/**
 * RedisIoAdapter wires Socket.IO to the shared ioredis REDIS_CLIENT so that
 * seat-update events broadcast across Cloud Run instances via Valkey pub/sub.
 * These tests cover the branching logic of `connectToRedis()` without booting
 * a real NestJS app or Socket.IO server.
 */
describe('RedisIoAdapter', () => {
  const mockApp = {
    get: vi.fn(),
  } as unknown as INestApplicationContext;

  function createReadySubscriber() {
    return {
      status: 'end',
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue('PONG'),
      disconnect: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the Redis adapter when the duplicated subscriber is ready', async () => {
    const subClient = createReadySubscriber();
    const duplicate = vi.fn().mockReturnValue(subClient);
    const pubClient = { duplicate } as unknown as IORedis;

    const adapter = new RedisIoAdapter(mockApp, pubClient);
    const wired = await adapter.connectToRedis();

    expect(wired).toBe(true);
    expect(duplicate).toHaveBeenCalledTimes(1);
    // @socket.io/redis-adapter requires maxRetriesPerRequest: null + enableReadyCheck: false
    // on the sub client (Phase 07-04 review fix, 07-REVIEWS.md Claude #8, T-07-13).
    expect(duplicate).toHaveBeenCalledWith({
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    expect(subClient.connect).toHaveBeenCalledOnce();
    expect(subClient.ping).toHaveBeenCalledOnce();
  });

  it('duplicates ioredis Cluster subscribers with cluster override options', async () => {
    const cluster = new Cluster([{ host: 'localhost', port: 6379 }], {
      lazyConnect: true,
      redisOptions: {
        password: 'secret',
        maxRetriesPerRequest: 3,
      },
    });
    const subClient = new Cluster([{ host: 'localhost', port: 6379 }], {
      lazyConnect: true,
    });
    const duplicate = vi.spyOn(cluster, 'duplicate').mockReturnValue(subClient);
    const connectSpy = vi.spyOn(subClient, 'connect').mockResolvedValue(undefined);
    const pingSpy = vi.spyOn(subClient, 'ping').mockResolvedValue('PONG');

    try {
      const adapter = new RedisIoAdapter(mockApp, cluster);
      const wired = await adapter.connectToRedis();

      expect(wired).toBe(true);
      expect(duplicate).toHaveBeenCalledWith(undefined, {
        enableReadyCheck: false,
        redisOptions: {
          password: 'secret',
          maxRetriesPerRequest: null,
        },
      });
      expect(connectSpy).toHaveBeenCalledOnce();
      expect(pingSpy).toHaveBeenCalledOnce();
    } finally {
      connectSpy.mockRestore();
      pingSpy.mockRestore();
      duplicate.mockRestore();
      cluster.disconnect();
      subClient.disconnect();
    }
  });

  it('falls back gracefully when the client has no duplicate() method', async () => {
    // Simulates InMemoryRedis: no .duplicate() -> adapter cannot wire pub/sub
    const inMemoryMock = { set: vi.fn(), get: vi.fn() } as unknown as IORedis;
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const adapter = new RedisIoAdapter(mockApp, inMemoryMock);
    const wired = await adapter.connectToRedis();

    expect(wired).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Multi-instance Socket.IO pub/sub DISABLED'),
    );
    warnSpy.mockRestore();
  });

  it('rejects a duplicated subscriber that lacks ioredis readiness methods', async () => {
    const duplicate = vi.fn().mockReturnValue({});
    const pubClient = { duplicate } as unknown as IORedis;
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const adapter = new RedisIoAdapter(mockApp, pubClient);

    await expect(adapter.connectToRedis()).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('duplicated Redis subscriber is missing required ioredis readiness methods'),
    );
    errorSpy.mockRestore();
  });

  it('keeps production bootstrap fail-closed when Redis pub/sub is not wired', () => {
    const mainSource = readFileSync(
      new URL('../../../main.ts', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain('const redisPubSubReady = await redisIoAdapter.connectToRedis()');
    expect(mainSource).toContain('Socket.IO Redis adapter failed to wire in production');
    expect(mainSource).toContain('app.useWebSocketAdapter(redisIoAdapter)');
  });
});
