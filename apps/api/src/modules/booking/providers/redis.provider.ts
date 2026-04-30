import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Cluster, type RedisOptions } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type ValkeyMode = 'standalone' | 'cluster';
export type RedisRuntimeClient = 'in-memory' | 'ioredis-standalone' | 'ioredis-cluster';

export interface RedisRuntimeMetadata {
  mode: ValkeyMode | 'in-memory';
  client: RedisRuntimeClient;
  configured: boolean;
}

const REDIS_RUNTIME_METADATA = Symbol('REDIS_RUNTIME_METADATA');
const REDIS_URL_PATTERN = /\brediss?:\/\/[^\s`'")]+/gi;

/**
 * In-memory Redis mock for local dev when REDIS_URL is not configured.
 * Implements only the subset of commands used by BookingService.
 *
 * NOTE: eval() follows ioredis flat signature (script, numKeys, ...keysAndArgs),
 * not the Upstash object-keys pattern.
 */
class InMemoryRedis {
  private store = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private ttls = new Map<string, NodeJS.Timeout>();
  private expiries = new Map<string, number>();

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  /**
   * Supports both call shapes used across the codebase:
   *  - Options-object: set(key, value, { nx: true, ex: 60 }) — internal/legacy
   *  - ioredis variadic: set(key, value, 'PX', ms, 'NX') / set(key, value, 'EX', s)
   *    — matches real ioredis API, used by SmsService and CacheService.
   */
  async set(
    key: string,
    value: string,
    ...args: unknown[]
  ): Promise<string | null> {
    let nx = false;
    let ttlMs: number | undefined;

    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      // Options-object form: set(key, value, { nx?, ex? })
      const opts = args[0] as { nx?: boolean; ex?: number };
      nx = !!opts.nx;
      if (opts.ex !== undefined) ttlMs = opts.ex * 1000;
    } else {
      // ioredis variadic form — flags may be any case
      const flags = args.map((a) => (typeof a === 'string' ? a.toUpperCase() : a));
      nx = flags.includes('NX');
      const pxIdx = flags.indexOf('PX');
      const exIdx = flags.indexOf('EX');
      if (pxIdx >= 0) ttlMs = Number(flags[pxIdx + 1]);
      else if (exIdx >= 0) ttlMs = Number(flags[exIdx + 1]) * 1000;
    }

    if (nx && this.store.has(key)) return null;

    const prev = this.ttls.get(key);
    if (prev) clearTimeout(prev);
    this.ttls.delete(key);
    this.expiries.delete(key);

    this.store.set(key, value);
    if (ttlMs !== undefined && !Number.isNaN(ttlMs)) {
      this.expiries.set(key, Date.now() + ttlMs);
      this.ttls.set(key, setTimeout(() => {
        this.store.delete(key);
        this.ttls.delete(key);
        this.expiries.delete(key);
        // Clean up locked-seats and user-seats when a seat lock expires
        // Key format: {showtimeId}:seat:seatId (hash-tagged for Redis Cluster)
        const parts = key.split(':');
        if (parts[1] === 'seat' && parts.length === 3) {
          const showtimeId = parts[0].slice(1, -1); // strip { }
          const seatId = parts[2];
          const lockedSet = this.sets.get(`{${showtimeId}}:locked-seats`);
          if (lockedSet) lockedSet.delete(seatId);
          const userId = value;
          const userSet = this.sets.get(`{${showtimeId}}:user-seats:${userId}`);
          if (userSet) userSet.delete(seatId);
        }
      }, ttlMs));
    }
    return 'OK';
  }

  async decr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') - 1;
    this.store.set(key, String(next));
    return next;
  }

  /**
   * Returns TTL in milliseconds. Mirrors ioredis pttl:
   *  - -2: key does not exist
   *  - -1: key exists but has no TTL
   *  - >= 0: remaining milliseconds
   */
  async pttl(key: string): Promise<number> {
    if (!this.store.has(key) && !this.sets.has(key)) return -2;
    const expiry = this.expiries.get(key);
    if (!expiry) return -1;
    const remaining = expiry - Date.now();
    return remaining > 0 ? remaining : -2;
  }

  /**
   * Minimal ioredis-compatible pipeline. Supports SET + DEL chaining (the ops
   * SmsService uses). exec() resolves to Array<[Error | null, unknown]> tuples,
   * matching ioredis semantics so callers can iterate results the same way.
   */
  pipeline(): {
    set: (key: string, value: string, ...args: unknown[]) => ReturnType<InMemoryRedis['pipeline']>;
    del: (...keys: string[]) => ReturnType<InMemoryRedis['pipeline']>;
    exec: () => Promise<Array<[Error | null, unknown]>>;
  } {
    const ops: Array<() => Promise<[Error | null, unknown]>> = [];
    const self = this;
    const chain = {
      set(key: string, value: string, ...args: unknown[]) {
        ops.push(async () => {
          try {
            const res = await self.set(key, value, ...args);
            return [null, res];
          } catch (e) {
            return [e as Error, null];
          }
        });
        return chain;
      },
      del(...keys: string[]) {
        ops.push(async () => {
          try {
            const res = await self.del(...keys);
            return [null, res];
          } catch (e) {
            return [e as Error, null];
          }
        });
        return chain;
      },
      async exec() {
        return Promise.all(ops.map((fn) => fn()));
      },
    };
    return chain;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const existed = this.store.delete(key) || this.sets.delete(key);
      const timer = this.ttls.get(key);
      if (timer) clearTimeout(timer);
      this.ttls.delete(key);
      this.expiries.delete(key);
      if (existed) count++;
    }
    return count;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const s = this.sets.get(key)!;
    let added = 0;
    for (const m of members) { if (!s.has(m)) { s.add(m); added++; } }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) { if (s.delete(m)) removed++; }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async ttl(key: string): Promise<number> {
    if (!this.store.has(key) && !this.sets.has(key)) return -2;
    const expiry = this.expiries.get(key);
    if (!expiry) return -1;
    const remaining = Math.ceil((expiry - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key) && !this.sets.has(key)) return 0;
    const prev = this.ttls.get(key);
    if (prev) clearTimeout(prev);
    this.expiries.set(key, Date.now() + seconds * 1000);
    this.ttls.set(key, setTimeout(() => {
      this.store.delete(key);
      this.sets.delete(key);
      this.ttls.delete(key);
      this.expiries.delete(key);
    }, seconds * 1000));
    return 1;
  }

  /**
   * Dispatches Lua script emulation using the ioredis flat signature.
   *
   * Signature: eval(script, numKeys, ...keysAndArgs)
   * Dispatches by script content + key/arg arity.
   */
  async eval(
    script: string,
    numKeys: number,
    ...keysAndArgs: (string | number)[]
  ): Promise<unknown> {
    const keys = keysAndArgs.slice(0, numKeys).map(String);
    const args = keysAndArgs.slice(numKeys).map(String);

    if (script.includes('ASSERT_OWNED_SEAT_LOCKS_LUA')) {
      return this.evalAssertOwnedSeatLocks(keys, args);
    }
    if (script.includes('CONSUME_OWNED_SEAT_LOCKS_LUA')) {
      return this.evalConsumeOwnedSeatLocks(keys, args);
    }
    if (script.includes('EXTEND_OWNED_SEAT_LOCKS_LUA')) {
      return this.evalExtendOwnedSeatLocks(keys, args);
    }
    if (script.includes('RELEASE_PAYMENT_CONFIRM_LOCK_LUA')) {
      return this.evalReleasePaymentConfirmLock(keys, args);
    }
    if (script.includes('REFRESH_PAYMENT_CONFIRM_LOCK_LUA')) {
      return this.evalRefreshPaymentConfirmLock(keys, args);
    }
    if (keys.length === 3 && args.length === 3 && script.includes('VERIFIED')) {
      return this.evalVerifyAndIncrement(keys, args);
    }
    if (keys.length === 3 && args.length === 5) {
      return this.evalLockSeat(keys, args);
    }
    if (keys.length === 3 && args.length === 2) {
      return this.evalUnlockSeat(keys, args);
    }
    if (keys.length === 1 && args.length === 1 && script.includes('INCR')) {
      return this.evalAtomicIncr(keys, args);
    }
    if (keys.length === 1 && args.length === 1) {
      return this.evalGetValidLockedSeats(keys, args);
    }
    throw new Error('InMemoryRedis: unknown Lua script pattern');
  }

  private evalAtomicIncr(keys: string[], args: string[]): number {
    const [key] = keys;
    const windowSec = Number(args[0]);
    const current = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(current));
    if (current === 1) {
      void this.expire(key, windowSec);
    }
    return current;
  }

  private evalVerifyAndIncrement(keys: string[], args: string[]): [string, number] {
    const [otpKey, attemptsKey, verifiedKey] = keys;
    const [code, maxAttemptsStr, verifiedTtlStr] = args;
    const maxAttempts = Number(maxAttemptsStr);
    const verifiedTtl = Number(verifiedTtlStr);

    const stored = this.store.get(otpKey);
    if (stored === undefined) return ['EXPIRED', 0];

    const attempts = Number(this.store.get(attemptsKey) ?? '0') + 1;
    this.store.set(attemptsKey, String(attempts));
    if (attempts === 1) void this.expire(attemptsKey, 900);

    if (attempts > maxAttempts) {
      void this.del(otpKey, attemptsKey);
      return ['NO_MORE_ATTEMPTS', 0];
    }

    if (stored === code) {
      void this.del(otpKey, attemptsKey);
      void this.set(verifiedKey, '1', { ex: verifiedTtl });
      return ['VERIFIED', attempts];
    }

    return ['WRONG', maxAttempts - attempts];
  }

  private async evalLockSeat(keys: string[], args: string[]): Promise<[number, string, string?]> {
    const [userSeatsKey, lockKey, lockedSeatsKey] = keys;
    const [userId, lockTtl, maxSeats, seatId, keyPrefix] = args;

    const members = Array.from(this.sets.get(userSeatsKey) ?? []);
    let alive = 0;
    for (const sid of members) {
      const owner = this.store.get(`${keyPrefix}${sid}`);
      if (owner === userId) {
        alive++;
      } else {
        const userSet = this.sets.get(userSeatsKey);
        if (userSet) userSet.delete(sid);
        if (owner === undefined) {
          const lockedSet = this.sets.get(lockedSeatsKey);
          if (lockedSet) lockedSet.delete(sid);
        }
      }
    }

    if (alive >= Number(maxSeats)) {
      return [0, 'MAX_SEATS'];
    }

    const existing = this.store.get(lockKey);
    if (existing !== undefined) {
      return [0, 'CONFLICT'];
    }

    await this.set(lockKey, userId as string, { nx: true, ex: Number(lockTtl) });
    await this.sadd(userSeatsKey, seatId as string);
    await this.expire(userSeatsKey, Number(lockTtl));
    await this.sadd(lockedSeatsKey, seatId as string);

    return [1, lockKey, seatId as string];
  }

  private evalUnlockSeat(keys: string[], args: string[]): number {
    const [lockKey, userSeatsKey, lockedSeatsKey] = keys;
    const [userId, seatId] = args;

    const owner = this.store.get(lockKey);
    if (owner !== userId) return 0;

    this.store.delete(lockKey);
    const timer = this.ttls.get(lockKey);
    if (timer) clearTimeout(timer);
    this.ttls.delete(lockKey);
    this.expiries.delete(lockKey);

    const userSet = this.sets.get(userSeatsKey);
    if (userSet) userSet.delete(seatId);

    const lockedSet = this.sets.get(lockedSeatsKey);
    if (lockedSet) lockedSet.delete(seatId);

    return 1;
  }

  private evalAssertOwnedSeatLocks(keys: string[], args: string[]): [number, string, string, string] {
    const [userId, ...seatIds] = args;

    for (let i = 0; i < keys.length; i++) {
      const lockKey = keys[i]!;
      const seatId = seatIds[i] ?? '';
      const owner = this.store.get(lockKey);

      if (owner === undefined) {
        return [0, 'MISSING', seatId, ''];
      }
      if (owner !== userId) {
        return [0, 'OTHER_OWNER', seatId, owner];
      }
    }

    return [1, 'OK', String(seatIds.length), ''];
  }

  private async evalExtendOwnedSeatLocks(keys: string[], args: string[]): Promise<[number, string, string, string]> {
    const [userSeatsKey, ...seatLockKeys] = keys;
    const [userId, ttlSeconds, ...seatIds] = args;

    for (let i = 0; i < seatLockKeys.length; i++) {
      const lockKey = seatLockKeys[i]!;
      const seatId = seatIds[i] ?? '';
      const owner = this.store.get(lockKey);

      if (owner === undefined) {
        return [0, 'MISSING', seatId, ''];
      }
      if (owner !== userId) {
        return [0, 'OTHER_OWNER', seatId, owner];
      }
    }

    const ttl = Number(ttlSeconds);
    for (const lockKey of seatLockKeys) {
      if (await this.ttl(lockKey) < ttl) {
        await this.expire(lockKey, ttl);
      }
    }
    if (await this.ttl(userSeatsKey!) < ttl) {
      await this.expire(userSeatsKey!, ttl);
    }

    return [1, 'OK', String(seatIds.length), ''];
  }

  private evalConsumeOwnedSeatLocks(keys: string[], args: string[]): [number, string, string, string] {
    const [userSeatsKey, lockedSeatsKey, ...seatLockKeys] = keys;
    const [userId, ...seatIds] = args;

    for (let i = 0; i < seatLockKeys.length; i++) {
      const lockKey = seatLockKeys[i]!;
      const seatId = seatIds[i] ?? '';
      const owner = this.store.get(lockKey);

      if (owner === undefined) {
        return [0, 'MISSING', seatId, ''];
      }
      if (owner !== userId) {
        return [0, 'OTHER_OWNER', seatId, owner];
      }
    }

    for (let i = 0; i < seatLockKeys.length; i++) {
      const lockKey = seatLockKeys[i]!;
      const seatId = seatIds[i] ?? '';

      this.store.delete(lockKey);
      const timer = this.ttls.get(lockKey);
      if (timer) clearTimeout(timer);
      this.ttls.delete(lockKey);
      this.expiries.delete(lockKey);

      const userSet = this.sets.get(userSeatsKey!);
      if (userSet) userSet.delete(seatId);

      const lockedSet = this.sets.get(lockedSeatsKey!);
      if (lockedSet) lockedSet.delete(seatId);
    }

    return [1, 'OK', String(seatIds.length), ''];
  }

  private async evalReleasePaymentConfirmLock(keys: string[], args: string[]): Promise<number> {
    const [lockKey] = keys;
    const [lockToken] = args;

    if (this.store.get(lockKey!) !== lockToken) {
      return 0;
    }

    return this.del(lockKey!);
  }

  private async evalRefreshPaymentConfirmLock(keys: string[], args: string[]): Promise<number> {
    const [lockKey] = keys;
    const [lockToken, ttlSeconds] = args;

    if (this.store.get(lockKey!) !== lockToken) {
      return 0;
    }

    return this.expire(lockKey!, Number(ttlSeconds));
  }

  private evalGetValidLockedSeats(keys: string[], args: string[]): string[] {
    const [lockedSeatsKey] = keys;
    const [keyPrefix] = args;

    const members = Array.from(this.sets.get(lockedSeatsKey) ?? []);
    const alive: string[] = [];

    for (const sid of members) {
      if (this.store.has(`${keyPrefix}${sid}`)) {
        alive.push(sid);
      } else {
        const s = this.sets.get(lockedSeatsKey);
        if (s) s.delete(sid);
      }
    }

    return alive;
  }
}

type RedisClient = IORedis | Cluster | InMemoryRedis;

function attachRedisRuntimeMetadata<T extends object>(
  redis: T,
  metadata: RedisRuntimeMetadata,
): T {
  Object.defineProperty(redis, REDIS_RUNTIME_METADATA, {
    value: Object.freeze({ ...metadata }),
    enumerable: false,
    configurable: false,
  });
  return redis;
}

export function getRedisRuntimeMetadata(redis: unknown): RedisRuntimeMetadata {
  if (typeof redis === 'object' && redis !== null) {
    const metadata = (redis as { [REDIS_RUNTIME_METADATA]?: RedisRuntimeMetadata })[
      REDIS_RUNTIME_METADATA
    ];
    if (metadata) return metadata;
  }

  return {
    mode: 'in-memory',
    client: 'in-memory',
    configured: false,
  };
}

function isValkeyMode(mode: string): mode is ValkeyMode {
  return mode === 'standalone' || mode === 'cluster';
}

function resolveValkeyMode(rawMode: string, isProduction: boolean): ValkeyMode {
  const mode = rawMode.trim();

  if (!mode) {
    if (isProduction) {
      throw new Error(
        '[redis] VALKEY_MODE is required in production environment. ' +
          'Set VALKEY_MODE to standalone or cluster.',
      );
    }
    return 'standalone';
  }

  if (!isValkeyMode(mode)) {
    throw new Error('[redis] VALKEY_MODE must be one of: standalone, cluster.');
  }

  return mode;
}

function parseRedisUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('[redis] REDIS_URL must be a valid Redis URL.');
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('[redis] REDIS_URL must use redis:// or rediss://.');
  }

  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!parsed.hostname || !Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('[redis] REDIS_URL must include a valid host and port.');
  }

  return parsed;
}

function buildRedisOptions(parsedUrl: URL): RedisOptions {
  return {
    maxRetriesPerRequest: 3,
    ...(parsedUrl.username ? { username: decodeURIComponent(parsedUrl.username) } : {}),
    ...(parsedUrl.password ? { password: decodeURIComponent(parsedUrl.password) } : {}),
    ...(parsedUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

function assertClusterRedisUrlPath(parsedUrl: URL): void {
  if (parsedUrl.pathname && parsedUrl.pathname !== '/' && parsedUrl.pathname !== '/0') {
    throw new Error('[redis] REDIS_URL must not select a logical database when VALKEY_MODE=cluster.');
  }
}

function sanitizeRedisErrorMessage(message: string): string {
  return message
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted host]')
    .replace(/\+\d{6,15}\b/g, '[redacted phone]')
    .replace(/\b(Authorization|Cookie|JWT)\b/gi, '[redacted secret]')
    .replace(/\b(paymentKey|orderId|token|secret)=\S+/gi, '$1=[redacted]');
}

function registerRedisErrorLogging(client: IORedis | Cluster): void {
  client.on('error', (err: Error) => {
    const safeMessage = sanitizeRedisErrorMessage(err.message);
    if (safeMessage.includes('ECONNREFUSED')) {
      if (!redisWarned) {
        redisWarned = true;
        console.warn('[redis] Redis unavailable — seat locking will fail. This is fine for local dev without REDIS_URL.');
      }
    } else {
      console.error('[redis] Error:', safeMessage);
    }
  });
}

let redisWarned = false;

/**
 * Unified Redis provider: single ioredis TCP client for both seat locking
 * and Socket.IO pub/sub adapter. Falls back to InMemoryRedis when REDIS_URL
 * is not set (local dev only; production enforces REDIS_URL via deploy secrets).
 */
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): RedisClient => {
    const url = config.get<string>('redis.url', '');
    const modeValue = config.get<string>('redis.mode', '');
    const isProduction = process.env['NODE_ENV'] === 'production';

    if (!url) {
      // Production misconfig must hard-fail: silent InMemoryRedis fallback would
      // isolate seat locking to a single Cloud Run instance (no cross-instance
      // pub/sub, no persistence) and silently allow duplicate bookings.
      // Addresses cross-AI review HIGH concern (07-REVIEWS.md Codex + Claude consensus #1).
      if (isProduction) {
        throw new Error(
          '[redis] REDIS_URL is required in production environment. ' +
            'Silent InMemoryRedis fallback is disabled to prevent duplicate bookings from instance-isolated seat locking. ' +
            'Check Cloud Run secret binding for redis-url.',
        );
      }
      console.warn(
        '[redis] No REDIS_URL — using in-memory mock. Seat locking works but is not persistent. ' +
          '(Development/test only — production now hard-fails.)',
      );
      return attachRedisRuntimeMetadata(new InMemoryRedis(), {
        mode: 'in-memory',
        client: 'in-memory',
        configured: false,
      });
    }

    const mode = resolveValkeyMode(modeValue, isProduction);
    const parsedUrl = parseRedisUrl(url);

    if (mode === 'cluster') {
      assertClusterRedisUrlPath(parsedUrl);
      const redisOptions = buildRedisOptions(parsedUrl);
      const client = new Cluster([{
        host: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
      }], {
        lazyConnect: true,
        scaleReads: 'master',
        enableReadyCheck: true,
        redisOptions,
        clusterRetryStrategy: (times: number) => {
          if (times > 5) return null;
          return Math.min(times * 500, 5000);
        },
      });

      attachRedisRuntimeMetadata(client, {
        mode: 'cluster',
        client: 'ioredis-cluster',
        configured: true,
      });
      registerRedisErrorLogging(client);
      client.connect().catch(() => {});
      return client;
    }

    const client = new IORedis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 5) return null;
        return Math.min(times * 500, 5000);
      },
    });

    attachRedisRuntimeMetadata(client, {
      mode: 'standalone',
      client: 'ioredis-standalone',
      configured: true,
    });
    registerRedisErrorLogging(client);
    client.connect().catch(() => {});
    return client;
  },
};
