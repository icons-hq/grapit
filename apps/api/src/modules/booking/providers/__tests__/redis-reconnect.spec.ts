import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryProvider } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import type { Cluster } from 'ioredis';
import {
  clusterReconnectDelayWithQueueFlush,
  findEndedRedisClients,
  REDIS_CLUSTER_UNAVAILABLE_MESSAGE,
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_MAX_RETRIES_PER_REQUEST,
  REDIS_RECONNECT_MAX_DELAY_MS,
  redisProvider,
  redisReconnectDelay,
  registerRedisClientGuards,
  registerRedisEndRecovery,
} from '../redis.provider.js';

/**
 * Audit #7: a Valkey outage longer than the old retry budget (about 7.5s)
 * moved ioredis to the terminal `end` state, so the instance never recovered.
 * These tests exercise the provider-built clients against a real TCP port.
 */

type UseFactory = (config: ConfigService) => IORedis | Cluster;

function providerFactory(): UseFactory {
  return (redisProvider as FactoryProvider).useFactory as UseFactory;
}

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

/**
 * Minimal RESP responder: enough for the ioredis standalone and cluster
 * handshakes (INFO, CLUSTER SLOTS, CLUSTER INFO) and PING.
 */
function parseCommands(buffer: string): { commands: string[][]; rest: string } {
  const commands: string[][] = [];
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
    commands.push(parts.map((part) => part.toLowerCase()));
    cursor = position;
  }
  return { commands, rest: buffer.slice(cursor) };
}

function bulkString(body: string): string {
  return `$${Buffer.byteLength(body)}\r\n${body}\r\n`;
}

async function startRespStub(port: number): Promise<{ server: Server; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      const { commands, rest } = parseCommands(pending);
      pending = rest;
      for (const [name, subcommand] of commands) {
        if (name === 'info') {
          socket.write(bulkString('# Server\r\nloading:0\r\n'));
        } else if (name === 'cluster' && subcommand === 'slots') {
          // One master owning every slot: this stub itself.
          socket.write(`*1\r\n*3\r\n:0\r\n:16383\r\n*2\r\n${bulkString('127.0.0.1')}:${port}\r\n`);
        } else if (name === 'cluster' && subcommand === 'info') {
          socket.write(bulkString('cluster_state:ok\r\n'));
        } else if (name === 'quit') {
          socket.end('+OK\r\n');
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
    const useFactory = providerFactory();
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
      expect(standalone.options.maxRetriesPerRequest).toBe(REDIS_MAX_RETRIES_PER_REQUEST);
      expect(standalone.options.connectTimeout).toBe(REDIS_CONNECT_TIMEOUT_MS);
      expect(cluster.options.redisOptions).toMatchObject({
        maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      });
      expect(cluster.options.clusterRetryStrategy).toBe(clusterReconnectDelayWithQueueFlush);

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

describe('clusterReconnectDelayWithQueueFlush', () => {
  it('drops the cluster offline queue with the standalone cadence and never gives up', () => {
    const flushQueue = vi.fn();
    const cluster = { flushQueue };

    for (let attempt = 1; attempt <= 3 * (REDIS_MAX_RETRIES_PER_REQUEST + 1); attempt++) {
      expect(clusterReconnectDelayWithQueueFlush.call(cluster, attempt))
        .toBe(redisReconnectDelay(attempt));
    }

    expect(flushQueue).toHaveBeenCalledTimes(3);
    expect(flushQueue).toHaveBeenCalledWith(new Error(REDIS_CLUSTER_UNAVAILABLE_MESSAGE));
    // Called without a cluster (or with a mock lacking flushQueue): delay only.
    expect(clusterReconnectDelayWithQueueFlush.call(undefined, 4)).toBe(redisReconnectDelay(4));
    expect(clusterReconnectDelayWithQueueFlush.call({}, 8)).toBe(redisReconnectDelay(8));
  });
});

type Settled<T> =
  | { state: 'resolved'; value: T }
  | { state: 'rejected'; error: unknown }
  | { state: 'pending' };

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  return Promise.race([
    promise.then(
      (value): Settled<T> => ({ state: 'resolved', value }),
      (error: unknown): Settled<T> => ({ state: 'rejected', error }),
    ),
    new Promise<Settled<T>>((resolve) => {
      setTimeout(() => resolve({ state: 'pending' }), ms);
    }),
  ]);
}

function rejectionMessage(outcome: Settled<unknown>): string | undefined {
  if (outcome.state !== 'rejected') return undefined;
  return outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
}

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
    const useFactory = providerFactory();
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

describe('cluster client during a Valkey outage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails queued commands within a bounded time, keeps reconnecting and serves commands once Valkey returns', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = providerFactory();
    const cluster = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'cluster')) as Cluster;
    const endListener = vi.fn();
    cluster.on('end', endListener);
    let stub: Awaited<ReturnType<typeof startRespStub>> | undefined;

    try {
      // A request issued while every node refuses connections (a throttler
      // check, a seat lock) must fail instead of waiting for the outage to end
      // and then running late.
      const startedAt = Date.now();
      const outcome = await settleWithin(cluster.get('seat-status-cache:outage'), 5_000);
      expect(outcome.state).toBe('rejected');
      expect(rejectionMessage(outcome)).toBe(REDIS_CLUSTER_UNAVAILABLE_MESSAGE);
      // 200 + 400 + 600ms of backoff with refused connections.
      expect(Date.now() - startedAt).toBeLessThan(4_000);

      await nextEvent(cluster, 'reconnecting');
      expect(cluster.status).not.toBe('end');
      expect(endListener).not.toHaveBeenCalled();

      const ready = nextEvent(cluster, 'ready');
      stub = await startRespStub(port);
      expect((await settleWithin(ready, 5_000)).state).toBe('resolved');
      await expect(cluster.ping()).resolves.toBe('PONG');
      expect(endListener).not.toHaveBeenCalled();
    } finally {
      cluster.disconnect();
      if (stub) await stopRespStub(stub);
    }
  });
});

describe('quit() during a Valkey outage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fails queued commands and stops reconnecting so a bounded worker can exit (standalone)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = providerFactory();
    const client = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'standalone')) as IORedis;

    try {
      await nextReconnect(client);
      expect(client.status).toBe('reconnecting');
      // e.g. a fire-and-forget seat-update publish still in the offline queue
      const queued = client.publish('socket.io#/booking#', 'payload');

      const afterQuit = vi.fn();
      await expect(client.quit()).resolves.toBe('OK');
      client.on('connecting', afterQuit);
      client.on('reconnecting', afterQuit);
      await expect(queued).rejects.toThrow('Connection is closed.');

      await vi.advanceTimersByTimeAsync(30_000);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(afterQuit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      client.disconnect();
    }
  });

  it('fails queued commands and stops reconnecting (cluster)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = providerFactory();
    const cluster = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'cluster')) as Cluster;

    try {
      await nextEvent(cluster, 'reconnecting');
      const queued = cluster.publish('socket.io#/booking#', 'payload');

      const afterQuit = vi.fn();
      await expect(cluster.quit()).resolves.toBe('OK');
      cluster.on('connecting', afterQuit);
      cluster.on('reconnecting', afterQuit);

      const outcome = await settleWithin(queued, 1_000);
      expect(outcome.state).toBe('rejected');
      expect(rejectionMessage(outcome)).toBe('Connection is closed.');
      await new Promise((resolve) => setTimeout(resolve, REDIS_RECONNECT_MAX_DELAY_MS + 200));
      expect(afterQuit).not.toHaveBeenCalled();
    } finally {
      cluster.disconnect();
    }
  });

  it('keeps the graceful quit() while the link is up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const stub = await startRespStub(port);
    const useFactory = providerFactory();
    const client = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'standalone')) as IORedis;

    try {
      await nextEvent(client, 'ready');
      const ended = nextEvent(client, 'end');
      await expect(client.quit()).resolves.toBe('OK');
      await ended;
      expect(client.status).toBe('end');
      // The graceful path leaves the option alone; `end` already fails commands.
      expect(client.options.enableOfflineQueue).toBe(true);
    } finally {
      client.disconnect();
      await stopRespStub(stub);
    }
  });

  // Audit D6: the client never reaches `end` after a link-down quit(), so a
  // drain cut off by the run deadline that still called Valkey afterwards
  // waited in the offline queue until the forced exit.
  it('fails commands issued after quit() at once instead of parking them (standalone)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = providerFactory();
    const client = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'standalone')) as IORedis;

    try {
      await nextReconnect(client);
      await expect(client.quit()).resolves.toBe('OK');
      expect(client.status).not.toBe('end');

      const get = await settleWithin(client.get('seat-status-cache:after-quit'), 200);
      const publish = await settleWithin(client.publish('socket.io#/booking#', 'payload'), 200);

      expect(get.state).toBe('rejected');
      expect(publish.state).toBe('rejected');
      expect(rejectionMessage(get)).toContain('enableOfflineQueue options is false');
    } finally {
      client.disconnect();
    }
  });

  it('fails commands issued after quit() at once instead of parking them (cluster)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = providerFactory();
    const cluster = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'cluster')) as Cluster;

    try {
      await nextEvent(cluster, 'reconnecting');
      await expect(cluster.quit()).resolves.toBe('OK');
      expect(cluster.status).not.toBe('end');

      const get = await settleWithin(cluster.get('seat-status-cache:after-quit'), 200);
      const publish = await settleWithin(cluster.publish('socket.io#/booking#', 'payload'), 200);

      expect(get.state).toBe('rejected');
      expect(publish.state).toBe('rejected');
      expect(rejectionMessage(get)).toContain('enableOfflineQueue options is false');
    } finally {
      cluster.disconnect();
    }
  });

  it('turns the offline queue back on once the client is explicitly reconnected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const useFactory = providerFactory();
    const client = useFactory(createConfig(`redis://127.0.0.1:${port}`, 'standalone')) as IORedis;
    let stub: Awaited<ReturnType<typeof startRespStub>> | undefined;

    try {
      await nextReconnect(client);
      await client.quit();
      expect(client.options.enableOfflineQueue).toBe(false);

      stub = await startRespStub(port);
      await client.connect();

      expect(client.options.enableOfflineQueue).toBe(true);
      await expect(client.ping()).resolves.toBe('PONG');
    } finally {
      client.disconnect();
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

/**
 * PR #235 review: the API liveness probe (`/api/v1/health/live`) fails only for
 * a client in the terminal `end` state, including the Socket.IO subscriber,
 * which is created outside the DI container and guarded on its own.
 */
describe('findEndedRedisClients', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createStatusClient(status: string) {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      status,
      connect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    });
  }

  it('reports a guarded subscriber only while it is in the end state', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const subscriber = createStatusClient('ready');
    registerRedisClientGuards(subscriber as unknown as IORedis, 'liveness test subscriber');

    for (const status of ['connecting', 'reconnecting', 'close', 'ready']) {
      subscriber.status = status;
      expect(findEndedRedisClients()).not.toContain('liveness test subscriber');
    }

    subscriber.status = 'end';
    expect(findEndedRedisClients()).toContain('liveness test subscriber');

    // The end recovery reconnected it.
    subscriber.status = 'connecting';
    expect(findEndedRedisClients()).not.toContain('liveness test subscriber');
  });

  it('reports the given shared client by its guard label, once', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const shared = createStatusClient('end');
    expect(findEndedRedisClients(shared)).toContain('shared client');

    registerRedisClientGuards(shared as unknown as IORedis, 'liveness test shared');
    const ended = findEndedRedisClients(shared);
    expect(ended).toContain('liveness test shared');
    expect(ended).not.toContain('shared client');
  });
});
