import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis, { Cluster } from 'ioredis';
import type { ServerOptions } from 'socket.io';

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
   * Returns `true` when the Redis adapter was wired, `false` when the client
   * lacks `.duplicate()` (InMemoryRedis mock) and the adapter falls back to
   * the default in-process transport.
   */
  connectToRedis(): boolean {
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
    const subClient = duplicateSocketSubscriber(pubClient);
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis adapter wired (pub/sub via duplicated ioredis client with null retries on sub)');
    return true;
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
