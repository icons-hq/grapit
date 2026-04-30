import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type IORedis from 'ioredis';
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the Redis adapter when the injected client exposes duplicate()', () => {
    const subClient = { on: vi.fn(), subscribe: vi.fn() };
    const duplicate = vi.fn().mockReturnValue(subClient);
    const pubClient = { duplicate } as unknown as IORedis;

    const adapter = new RedisIoAdapter(mockApp, pubClient);
    const wired = adapter.connectToRedis();

    expect(wired).toBe(true);
    expect(duplicate).toHaveBeenCalledTimes(1);
    // @socket.io/redis-adapter requires maxRetriesPerRequest: null + enableReadyCheck: false
    // on the sub client (Phase 07-04 review fix, 07-REVIEWS.md Claude #8, T-07-13).
    expect(duplicate).toHaveBeenCalledWith({
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  });

  it('falls back gracefully when the client has no duplicate() method', () => {
    // Simulates InMemoryRedis: no .duplicate() -> adapter cannot wire pub/sub
    const inMemoryMock = { set: vi.fn(), get: vi.fn() } as unknown as IORedis;
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const adapter = new RedisIoAdapter(mockApp, inMemoryMock);
    const wired = adapter.connectToRedis();

    expect(wired).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Multi-instance Socket.IO pub/sub DISABLED'),
    );
    warnSpy.mockRestore();
  });

  it('does not throw when duplicate is present but returns a minimal sub client', () => {
    const duplicate = vi.fn().mockReturnValue({});
    const pubClient = { duplicate } as unknown as IORedis;
    const adapter = new RedisIoAdapter(mockApp, pubClient);

    expect(() => adapter.connectToRedis()).not.toThrow();
  });

  it('keeps production bootstrap fail-closed when Redis pub/sub is not wired', () => {
    const mainSource = readFileSync(
      new URL('../../../main.ts', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain('const redisPubSubReady = redisIoAdapter.connectToRedis()');
    expect(mainSource).toContain('Socket.IO Redis adapter failed to wire in production');
    expect(mainSource).toContain('app.useWebSocketAdapter(redisIoAdapter)');
  });
});
