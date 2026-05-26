import { Inject, Injectable, Logger } from '@nestjs/common';
import type IORedis from 'ioredis';

import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';

/**
 * Default cache TTL (seconds). 5 minutes per phase 07 decision D-08.
 */
const DEFAULT_TTL = 300;
const SCAN_COUNT = 250;

interface RedisScanClient {
  scan(
    cursor: string,
    ...args: Array<string | number>
  ): Promise<[string, string[]]>;
}

interface RedisKeysClient {
  keys(pattern: string): Promise<string[]>;
}

interface RedisClusterScanClient {
  nodes(role: 'master'): RedisScanClient[];
}

function hasScan(client: unknown): client is RedisScanClient {
  return typeof (client as { scan?: unknown }).scan === 'function';
}

function hasKeys(client: unknown): client is RedisKeysClient {
  return typeof (client as { keys?: unknown }).keys === 'function';
}

function hasClusterNodes(client: unknown): client is RedisClusterScanClient {
  return typeof (client as { nodes?: unknown }).nodes === 'function';
}

/**
 * CacheService — thin read-through / invalidation helper over ioredis.
 *
 * Usage:
 *  - get<T>(key): parsed JSON value or null (null on miss or on any error)
 *  - set(key, value, ttl?): JSON.stringify + EX ttl. Errors are swallowed
 *    so cache outages never break the request path (graceful degradation).
 *  - invalidate(...keys): DEL explicit keys one by one. Errors are swallowed
 *    + logged (per 07-REVIEWS.md MEDIUM consensus #6): admin DB commit must
 *    not roll back on transient cache outage, but the failure must be
 *    observable via logs.
 *  - invalidatePattern(pattern): SCAN matches + per-key DEL. Same swallow-
 *    and-log semantics as invalidate().
 *
 * Notes:
 *  - Cache keys are server-generated — user input must never be concatenated
 *    into a key without prior validation (see threat model T-07-04).
 *  - Pattern invalidation uses SCAN instead of KEYS, and never sends multi-key
 *    DEL. Production Valkey Cluster rejects cross-slot multi-key commands.
 *  - Log only `err.message` and the cache key structure (no values) to avoid
 *    leaking cached payloads in logs — T-07-11 Information Disclosure.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, key, op: 'get' },
        'cache get failed — falling back to DB',
      );
      return null;
    }
  }

  async set(key: string, data: unknown, ttlSeconds: number = DEFAULT_TTL): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (err) {
      // Graceful degradation: a failed cache write must never break the request.
      this.logger.warn(
        { err: (err as Error).message, key, op: 'set' },
        'cache set failed — request continues without caching',
      );
    }
  }

  async invalidate(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.deleteKeys(keys);
    } catch (err) {
      // DB-cache divergence risk accepted: admin DB commit has already happened;
      // cache will self-heal on next TTL or next invalidation call.
      this.logger.warn(
        { err: (err as Error).message, keys, op: 'invalidate' },
        'cache invalidate failed — DB committed but cache may be stale until TTL',
      );
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.findKeysByPattern(pattern);
      await this.deleteKeys(keys);
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, pattern, op: 'invalidatePattern' },
        'cache invalidatePattern failed — DB committed but cache may be stale until TTL',
      );
    }
  }

  private async findKeysByPattern(pattern: string): Promise<string[]> {
    if (hasClusterNodes(this.redis)) {
      const nodes = this.redis.nodes('master').filter(hasScan);
      if (nodes.length > 0) {
        const batches = await Promise.all(
          nodes.map((node) => this.scanKeys(node, pattern)),
        );
        return this.uniqueKeys(batches.flat());
      }
    }

    if (hasScan(this.redis)) {
      return this.uniqueKeys(await this.scanKeys(this.redis, pattern));
    }

    // InMemoryRedis in local tests implements keys() but not scan().
    if (hasKeys(this.redis)) {
      return this.uniqueKeys(await this.redis.keys(pattern));
    }

    return [];
  }

  private async scanKeys(client: RedisScanClient, pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        SCAN_COUNT,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    const uniqueKeys = this.uniqueKeys(keys);
    if (uniqueKeys.length === 0) return;

    const results = await Promise.allSettled(
      uniqueKeys.map((key) => this.redis.del(key)),
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected) {
      throw rejected.reason;
    }
  }

  private uniqueKeys(keys: string[]): string[] {
    return Array.from(new Set(keys));
  }
}
