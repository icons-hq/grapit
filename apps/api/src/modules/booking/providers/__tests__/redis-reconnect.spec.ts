import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import type { Cluster } from 'ioredis';
import {
  REDIS_RECONNECT_MAX_DELAY_MS,
  redisProvider,
  redisReconnectDelay,
  registerRedisEndRecovery,
} from '../redis.provider.js';

/**
 * Audit #7: a Valkey outage longer than the old retry budget (about 7.5s)
 * moved ioredis to the terminal `end` state, so the instance never recovered.
 * These tests exercise the provider-built clients against a real TCP port.
 */

type UseFactory = (config: ConfigService) => IORedis | Cluster;

function createConfig(url: string, mode: 'standalone' | 'cluster'): ConfigService {
  return {
    get: vi.fn((key: string, defaultValue?: string) => {
      if (key === 'redis.url') return url;
      if (key === 'redis.mode') return mode;
      return defaultValue ?? '';
    }),
  } as unknown as ConfigService;
}

async function reserveClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Minimal RESP responder: enough for the ioredis handshake and PING. */
function parseCommandNames(buffer: string): { names: string[]; rest: string } {
  const names: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const header = buffer.indexOf('\r\n', cursor);
    if (header < 0 || buffer[cursor] !== '*') break;
    const count = Number(buffer.slice(cursor + 1, header));
    let position = header + 2;
    const parts: string[] = [];
    let complete = true;
    for (let i = 0; i < count; i++) {
      const lengthEnd = buffer.indexOf('\r\n', position);
      if (lengthEnd < 0) {
        complete = false;
        break;
      }
      const length = Number(buffer.slice(position + 1, lengthEnd));
      const valueStart = lengthEnd + 2;
      if (buffer.length < valueStart + length + 2) {
        complete = false;
        break;
      }
      parts.push(buffer.slice(valueStart, valueStart + length));
      position = valueStart + length + 2;
    }
    if (!complete) break;
    names.push((parts[0] ?? '').toLowerCase());
    cursor = position;
  }
  return { names, rest: buffer.slice(cursor) };
}

async function startRespStub(port: number): Promise<{ server: Server; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      const { names, rest } = parseCommandNames(pending);
      pending = rest;
      for (const name of names) {
        if (name === 'info') {
          const body = '# Server\r\nloading:0\r\n';
          socket.write(`$${Buffer.byteLength(body)}\r\n${body}\r\n`);
        } else if (name === 'ping') {
          socket.write('+PONG\r\n');
        } else {
          socket.write('+OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, sockets };
}

async function stopRespStub(stub: { server: Server; sockets: Set<Socket> }): Promise<void> {
  for (const socket of stub.sockets) socket.destroy();
  await new Promise<void>((resolve) => stub.server.close(() => resolve()));
}

function nextEvent<T = unknown>(emitter: EventEmitter, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (value: T) => resolve(value)));
}

/** Resolves with the next reconnect delay; rejects if the client gives up. */
function nextReconnect(client: EventEmitter): Promise<number> {
  return new Promise((resolve, reject) => {
    const onReconnecting = (delay: number) => {
      client.off('end', onEnd);
      resolve(delay);
    };
    const onEnd = () => {
      client.off('reconnecting', onReconnecting);
      reject(new Error('Redis client reached the terminal end state'));
    };
    client.once('reconnecting', onReconnecting);
    client.once('end', onEnd);
  });
}

describe('redisReconnectDelay', () => {
  it('keeps returning a bounded numeric delay well past the old five-attempt budget', () => {
    for (const attempt of [1, 2, 5, 6, 7, 50, 10_000]) {
      const delay = redisReconnectDelay(attempt);
      expect(typeof delay).toBe('number');
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(REDIS_RECONNECT_MAX_DELAY_MS);
    }
  });

  it('is wired into both the standalone and cluster provider clients and their duplicates', () => {
    const useFactory = redisProvider.useFactory as UseFactory;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const standalone = useFactory(createConfig('redis://127.0.0.1:1', 'standalone')) as IORedis;
    const cluster = useFactory(createConfig('redis://127.0.0.1:1', 'cluster')) as Cluster;
    // Same override shape as the Socket.IO subscriber in redis-io.adapter.ts.
    const standaloneSubscriber = standalone.duplicate({
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    const clusterSubscriber = cluster.duplicate(undefined, {
      enableReadyCheck: false,
      lazyConnect: true,
    });

    try {
      for (const attempt of [6, 1_000]) {
        expect(typeof standalone.options.retryStrategy?.(attempt)).toBe('number');
        expect(typeof cluster.options.clusterRetryStrategy?.(attempt)).toBe('number');
        expect(standalone.options.retryStrategy?.(attempt)).toBe(redisReconnectDelay(attempt));
        expect(standaloneSubscriber.options.retryStrategy?.(attempt)).toBe(redisReconnectDelay(attempt));
        expect(cluster.options.clusterRetryStrategy?.(attempt)).toBe(redisReconnectDelay(attempt));
        expect(clusterSubscriber.options.clusterRetryStrategy?.(attempt))
          .toBe(redisReconnectDelay(attempt));
      }
    } finally {
      standalone.disconnect();
      cluster.disconnect();
      standaloneSubscriber.disconnect();
      clusterSubscriber.disconnect();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('provider client recovery after a long Valkey outage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps reconnecting past the old retry budget and serves commands once Valkey returns', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = redisProvider.useFactory as UseFactory;
    const endListener = vi.fn();
    let client: IORedis | undefined;
    let stub: Awaited<ReturnType<typeof startRespStub>> | undefined;

    try {
      // The provider starts connecting immediately; the port refuses connections.
      const reconnecting = nextReconnect(
        (client = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'standalone')) as IORedis),
      );
      client.on('end', endListener);

      let delay = await reconnecting;
      const outageAttempts = 8; // old strategy ended the client after attempt 5
      for (let attempt = 1; attempt < outageAttempts; attempt++) {
        const next = nextReconnect(client);
        await vi.advanceTimersByTimeAsync(delay);
        delay = await next;
      }

      expect(client.status).toBe('reconnecting');
      expect(endListener).not.toHaveBeenCalled();
      expect(delay).toBe(REDIS_RECONNECT_MAX_DELAY_MS);

      stub = await startRespStub(port);
      const ready = nextEvent(client, 'ready');
      await vi.advanceTimersByTimeAsync(delay);
      await ready;

      vi.useRealTimers();
      await expect(client.ping()).resolves.toBe('PONG');
      expect(endListener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      client?.disconnect();
      if (stub) await stopRespStub(stub);
    }
  });
});

describe('registerRedisEndRecovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createFakeClient() {
    const emitter = new EventEmitter();
    const connect = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn().mockResolvedValue('OK');
    const disconnect = vi.fn();
    const client = Object.assign(emitter, { connect, quit, disconnect });
    return { client, connect, quit, disconnect };
  }

  it('reconnects a client that reaches end without a shutdown call', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, connect } = createFakeClient();
    registerRedisEndRecovery(client, 'test client', 500);

    client.emit('end');
    expect(connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    expect(connect).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('test client connection ended unexpectedly'),
    );
  });

  it('does not reconnect after quit() or disconnect() shutdowns', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const quitting = createFakeClient();
    registerRedisEndRecovery(quitting.client, 'quitting client', 500);
    await quitting.client.quit();
    quitting.client.emit('end');

    const disconnecting = createFakeClient();
    registerRedisEndRecovery(disconnecting.client, 'disconnecting client', 500);
    disconnecting.client.disconnect();
    disconnecting.client.emit('end');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(quitting.quit).toHaveBeenCalledOnce();
    expect(quitting.connect).not.toHaveBeenCalled();
    expect(disconnecting.disconnect).toHaveBeenCalledOnce();
    expect(disconnecting.connect).not.toHaveBeenCalled();
  });

  it('treats disconnect(true) as a reconnecting drop and re-arms once the client is ready again', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, connect, disconnect } = createFakeClient();
    registerRedisEndRecovery(client, 'test client', 500);

    client.disconnect(true);
    expect(disconnect).toHaveBeenCalledWith(true);
    client.emit('end');
    await vi.advanceTimersByTimeAsync(500);
    expect(connect).toHaveBeenCalledTimes(1);

    client.disconnect();
    client.emit('end');
    await vi.advanceTimersByTimeAsync(500);
    expect(connect).toHaveBeenCalledTimes(1);

    // Someone reconnected it explicitly; later unexpected ends recover again.
    client.emit('ready');
    client.emit('end');
    await vi.advanceTimersByTimeAsync(500);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('registers the recovery only once per client', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, connect } = createFakeClient();
    registerRedisEndRecovery(client, 'test client', 500);
    registerRedisEndRecovery(client, 'test client', 500);

    client.emit('end');
    await vi.advanceTimersByTimeAsync(500);

    expect(connect).toHaveBeenCalledOnce();
  });
});
