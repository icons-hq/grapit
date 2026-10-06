import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type IORedis from 'ioredis';

import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';

/**
 * Default cache TTL (seconds). 5 minutes per phase 07 decision D-08.
 */
const DEFAULT_TTL = 300;
const SCAN_COUNT = 250;
const GENERATION_KEY_PREFIX = 'cache:generation:';
/**
 * Generation tokens outlive every cached payload (max 300s) by a wide margin,
 * so an expired token can never resurrect a payload written under it.
 */
const GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Token used while no invalidation has happened yet for a scope. */
export const INITIAL_CACHE_GENERATION = '0';
/**
 * How long an instance reuses a generation token it read from Valkey. Hot
 * catalog reads then cost one payload GET per request plus at most one
 * generation GET per scope per window, instead of two GETs per request. A
 * bump made by this instance replaces its memo at once; other instances pick
 * it up within this window.
 */
export const CACHE_GENERATION_MEMO_MS = 250;
/** Upper bound for memoized scopes (one per viewed performance detail). */
const GENERATION_MEMO_MAX_ENTRIES = 10_000;

/**
 * Result of a cache loader. `ttlSeconds: null` returns the value without
 * caching it (for example a not-found detail).
 */
export interface CacheLoadResult<T> {
  value: T;
  ttlSeconds: number | null;
}

export interface CacheGetOrLoadOptions {
  /**
   * false skips the Redis read/write (for example when the generation token
   * could not be read) but still coalesces concurrent loads in this process.
   */
  readThrough?: boolean;
}

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
 *  - getOrLoad(key, loader): read-through with in-process single-flight, so
 *    a burst of misses for one key (TTL expiry at a booking opening) runs the
 *    DB loader once per instance instead of once per request.
 *  - getGeneration(scope) / bumpGeneration(scope): per-scope generation
 *    tokens. Readers put the token into the cache key before reading the DB;
 *    writers bump it after commit. A reader that loaded pre-commit data can
 *    then only write to the superseded key, so a DEL→late SET race cannot
 *    republish stale catalog data. Tokens are memoized in process for
 *    CACHE_GENERATION_MEMO_MS, so another instance's bump is seen within that
 *    window rather than immediately.
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
  private readonly inflightLoads = new Map<string, Promise<unknown>>();
  private readonly generationMemo = new Map<string, { token: string; expiresAt: number }>();
  private readonly generationReads = new Map<string, Promise<string | null>>();
  /** Incremented by every local bump; a read that overlapped one is not memoized. */
  private generationBumps = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<CacheLoadResult<T>>,
    options: CacheGetOrLoadOptions = {},
  ): Promise<T> {
    const readThrough = options.readThrough !== false;
    const pendingBeforeRead = this.inflightLoads.get(key);
    if (pendingBeforeRead) return pendingBeforeRead as Promise<T>;

    if (readThrough) {
      const cached = await this.get<T>(key);
      if (cached !== null) return cached;
    }

    // Another request may have started the load while this one awaited Redis.
    const pendingAfterRead = this.inflightLoads.get(key);
    if (pendingAfterRead) return pendingAfterRead as Promise<T>;

    const load = (async () => {
      const result = await loader();
      if (readThrough && result.ttlSeconds !== null && result.ttlSeconds > 0) {
        await this.set(key, result.value, result.ttlSeconds);
      }
      return result.value;
    })();
    this.inflightLoads.set(key, load);

    try {
      return await load;
    } finally {
      if (this.inflightLoads.get(key) === load) {
        this.inflightLoads.delete(key);
      }
    }
  }

  /**
   * Returns the current generation token for a scope, the initial token when
   * the scope was never bumped, or null when Redis cannot answer. Callers must
   * not read or write the shared cache with a null generation.
   */
  async getGeneration(scope: string): Promise<string | null> {
    const memo = this.generationMemo.get(scope);
    if (memo && memo.expiresAt > Date.now()) return memo.token;

    // Concurrent readers of one scope share a single GET.
    const pending = this.generationReads.get(scope);
    if (pending) return pending;

    const read = this.readGeneration(scope);
    this.generationReads.set(scope, read);
    try {
      return await read;
    } finally {
      if (this.generationReads.get(scope) === read) {
        this.generationReads.delete(scope);
      }
    }
  }

  /**
   * Replaces the scope's token. Returns false when Valkey rejected the write,
   * so callers can retry or escalate; it never throws after a DB commit.
   */
  async bumpGeneration(scope: string): Promise<boolean> {
    const key = `${GENERATION_KEY_PREFIX}${scope}`;
    const token = `${Date.now().toString(36)}-${randomUUID()}`;
    // Local readers must not keep (or start memoizing) the superseded token.
    this.generationBumps += 1;
    this.generationMemo.delete(scope);
    this.generationReads.delete(scope);
    try {
      await this.redis.set(key, token, 'EX', GENERATION_TTL_SECONDS);
      this.rememberGeneration(scope, token);
      return true;
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, key, op: 'bumpGeneration' },
        'cache generation bump failed — DB committed but cache may be stale until TTL',
      );
      return false;
    }
  }

  private async readGeneration(scope: string): Promise<string | null> {
    const key = `${GENERATION_KEY_PREFIX}${scope}`;
    const bumpsBeforeRead = this.generationBumps;
    try {
      const token = (await this.redis.get(key)) ?? INITIAL_CACHE_GENERATION;
      if (this.generationBumps === bumpsBeforeRead) {
        this.rememberGeneration(scope, token);
      }
      return token;
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, key, op: 'getGeneration' },
        'cache generation read failed — bypassing shared cache',
      );
      return null;
    }
  }

  private rememberGeneration(scope: string, token: string): void {
    const now = Date.now();
    if (this.generationMemo.size >= GENERATION_MEMO_MAX_ENTRIES) {
      for (const [memoScope, entry] of this.generationMemo) {
        if (entry.expiresAt <= now) this.generationMemo.delete(memoScope);
      }
      if (this.generationMemo.size >= GENERATION_MEMO_MAX_ENTRIES) {
        this.generationMemo.clear();
      }
    }
    this.generationMemo.set(scope, { token, expiresAt: now + CACHE_GENERATION_MEMO_MS });
  }

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
