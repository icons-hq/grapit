import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis, { Cluster } from 'ioredis';
import type { ServerOptions } from 'socket.io';

const SOCKET_IO_REDIS_READY_TIMEOUT_MS = 5000;

/**
 * Creates a Socket.IO Redis adapter using the provided ioredis client.
 * Uses the client as pub and a duplicate as sub for Redis pub/sub.
 *
 * The sub client is duplicated with `{ maxRetriesPerRequest: null,
 * enableReadyCheck: false }` per @socket.io/redis-adapter requirements:
 * subscription commands must not be aborted mid-stream by retry limits,
 * and the READY info check is meaningless for a subscriber connection.
 * See 07-REVIEWS.md MEDIUM concern (Claude-only #8) and T-07-13 mitigation.
 */
export function createSocketIoRedisAdapter(
  ioredisClient: IORedis | Cluster,
): ReturnType<typeof createAdapter> {
  const pubClient = ioredisClient;
  const subClient = duplicateSocketSubscriber(pubClient);

  return createAdapter(pubClient, subClient);
}

function duplicateSocketSubscriber(pubClient: IORedis | Cluster): IORedis | Cluster {
  if (pubClient instanceof Cluster) {
    return pubClient.duplicate(undefined, {
      enableReadyCheck: false,
      redisOptions: {
        ...(pubClient.options.redisOptions ?? {}),
        maxRetriesPerRequest: null,
      },
    });
  }

  return pubClient.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

type RedisSubscriberRuntime = (IORedis | Cluster) & {
  status?: string;
  connect: () => Promise<unknown>;
  ping: () => Promise<unknown> | unknown;
  once: (event: 'error', listener: (error: unknown) => void) => unknown;
  off: (event: 'error', listener: (error: unknown) => void) => unknown;
};

function isRedisSubscriberRuntime(candidate: unknown): candidate is RedisSubscriberRuntime {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const maybe = candidate as Partial<RedisSubscriberRuntime>;
  return typeof maybe.connect === 'function'
    && typeof maybe.ping === 'function'
    && typeof maybe.once === 'function'
    && typeof maybe.off === 'function';
}

function formatRedisReadinessError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyConnectingOrConnectedError(error: unknown): boolean {
  const message = formatRedisReadinessError(error);
  return /already (?:connecting|connected)/i.test(message);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

async function connectSubscriber(subClient: RedisSubscriberRuntime): Promise<void> {
  if (subClient.status === 'ready') return;

  try {
    await subClient.connect();
  } catch (error) {
    if (!isAlreadyConnectingOrConnectedError(error)) {
      throw error;
    }
  }
}

async function assertSocketSubscriberReady(subClient: unknown): Promise<IORedis | Cluster> {
  if (!isRedisSubscriberRuntime(subClient)) {
    throw new Error('duplicated Redis subscriber is missing required ioredis readiness methods');
  }

  let cleanupErrorListener: (() => void) | undefined;
  const readiness = new Promise<void>((resolve, reject) => {
    const handleError = (error: unknown) => {
      reject(error);
    };
    cleanupErrorListener = () => subClient.off('error', handleError);
    subClient.once('error', handleError);

    connectSubscriber(subClient)
      .then(async () => {
        const pong = await subClient.ping();
        if (pong !== 'PONG') {
          throw new Error(`duplicated Redis subscriber ping returned ${String(pong)}`);
        }
      })
      .then(resolve, reject);
  });

  try {
    await withTimeout(
      readiness,
      SOCKET_IO_REDIS_READY_TIMEOUT_MS,
      'Socket.IO Redis subscriber readiness check',
    );
  } finally {
    cleanupErrorListener?.();
  }

  return subClient;
}

function disconnectRedisSubscriber(subClient: unknown): void {
  if (typeof subClient !== 'object' || subClient === null) return;
  const maybe = subClient as { disconnect?: () => void };
  if (typeof maybe.disconnect === 'function') {
    maybe.disconnect();
  }
}

/**
 * Socket.IO server options for the booking namespace.
 */
export function getBookingSocketOptions(): Partial<ServerOptions> {
  return {
    cors: {
      origin: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
      credentials: true,
    },
  };
}

/**
 * NestJS WebSocket adapter that layers Socket.IO on top of a Redis pub/sub
 * transport (via @socket.io/redis-adapter). Required for multi-instance
 * broadcast when Cloud Run scales the API service beyond a single instance —
 * without this adapter, seat-update events emitted from instance A would not
 * reach clients connected to instance B.
 *
 * Falls back to the default in-process adapter when the injected REDIS_CLIENT
 * is not a real ioredis instance (InMemoryRedis mock used in local dev without
 * REDIS_URL), so local dev continues to work without a Redis server.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly redisClient: IORedis | Cluster | { duplicate?: unknown },
  ) {
    super(app);
  }

  /**
   * Builds the Socket.IO Redis adapter by duplicating the injected ioredis
   * client into a dedicated sub connection. Must be called once after
   * construction and before `app.useWebSocketAdapter()`.
   *
   * Returns `true` when the duplicated subscriber is connected and pingable,
   * `false` when the client lacks `.duplicate()` (InMemoryRedis mock) or the
   * subscriber cannot prove readiness.
   */
  async connectToRedis(): Promise<boolean> {
    const maybeClient = this.redisClient as { duplicate?: (...args: unknown[]) => IORedis | Cluster };
    if (typeof maybeClient.duplicate !== 'function') {
      this.logger.warn(
        'REDIS_CLIENT has no duplicate() — assuming InMemoryRedis mock. Multi-instance Socket.IO pub/sub DISABLED. Set REDIS_URL to enable.',
      );
      return false;
    }
    const pubClient = this.redisClient as IORedis | Cluster;
    // @socket.io/redis-adapter requires maxRetriesPerRequest: null on the sub
    // client so that subscription commands are not aborted mid-stream by retry
    // limits, and enableReadyCheck: false so that SUBSCRIBE can happen before
    // the INFO ready check (which is not meaningful for a subscriber connection).
    // Pub client inherits ioredis options from redis.provider.ts (maxRetriesPerRequest: 3).
    // Addresses 07-REVIEWS.md MEDIUM concern (Claude-only #8) and T-07-13 mitigation.
    let subClient: IORedis | Cluster | unknown;
    try {
      subClient = duplicateSocketSubscriber(pubClient);
      const readySubClient = await assertSocketSubscriberReady(subClient);
      this.adapterConstructor = createAdapter(pubClient, readySubClient);
      this.logger.log('Socket.IO Redis adapter wired (pub/sub via duplicated ioredis client with null retries on sub)');
      return true;
    } catch (error) {
      disconnectRedisSubscriber(subClient);
      this.adapterConstructor = null;
      this.logger.error(
        `Socket.IO Redis adapter readiness failed: ${formatRedisReadinessError(error)}`,
      );
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (adapter: ReturnType<typeof createAdapter>) => void;
    };
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
