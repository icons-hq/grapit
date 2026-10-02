import { setTimeout as sleep } from 'node:timers/promises';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import IORedis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlockAwareThrottlerStorageRedisService } from '../src/modules/traffic/throttler-storage.js';

/**
 * Production throttler storage against a real Valkey (testcontainers).
 *
 * Run: pnpm --filter @grabit/api exec vitest run \
 *   --config vitest.integration.config.ts test/throttler-storage.integration.spec.ts
 */
describe('BlockAwareThrottlerStorageRedisService (testcontainers + Valkey)', () => {
  let container: StartedTestContainer;
  let redis: IORedis;
  let storage: BlockAwareThrottlerStorageRedisService;
  let stock: ThrottlerStorageRedisService;

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8').withExposedPorts(6379).start();
    redis = new IORedis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`, {
      maxRetriesPerRequest: 3,
    });
    storage = new BlockAwareThrottlerStorageRedisService(redis);
    stock = new ThrottlerStorageRedisService(redis);
  }, 120_000);

  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('counts hits within the window and blocks the first one over the limit', async () => {
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await storage.increment('bucket', 60_000, 3, 60_000, 'default'));
    }

    expect(results.map((result) => result.totalHits)).toEqual([1, 2, 3, 4]);
    expect(results.map((result) => result.isBlocked)).toEqual([false, false, false, true]);
    expect(results[3]?.timeToBlockExpire).toBe(60);
    expect(results[0]?.timeToExpire).toBe(60);
    // The library's key layout and hash tags are kept (Valkey cluster slots).
    expect(await redis.exists('{bucket:default}:hits', '{bucket:default}:blocked')).toBe(2);
  });

  it('does not count requests rejected while blocked', async () => {
    for (let index = 0; index < 3; index += 1) {
      await storage.increment('bucket', 60_000, 2, 60_000, 'default');
    }
    const whileBlocked = [];
    for (let index = 0; index < 5; index += 1) {
      whileBlocked.push(await storage.increment('bucket', 60_000, 2, 60_000, 'default'));
    }

    expect(whileBlocked.every((result) => result.isBlocked)).toBe(true);
    expect(whileBlocked.every((result) => result.totalHits === 3)).toBe(true);
    expect(await redis.get('{bucket:default}:hits')).toBe('3');
  });

  it('grants a fresh window after a block, however many requests were rejected meanwhile', async () => {
    // Window opens at t0; the over-limit hit comes late, so the block outlives
    // the window. Requests rejected after the window ends must not fill the
    // next one, or the block would renew itself forever.
    const ttl = 1_500;
    const run = async (subject: ThrottlerStorageRedisService) => {
      await subject.increment('victim', ttl, 2, ttl, 'mail');
      await sleep(900);
      await subject.increment('victim', ttl, 2, ttl, 'mail');
      const block = await subject.increment('victim', ttl, 2, ttl, 'mail');
      await sleep(900); // window over, block still running
      for (let index = 0; index < 5; index += 1) {
        await subject.increment('victim', ttl, 2, ttl, 'mail');
      }
      await sleep(900); // block over
      return { block, after: await subject.increment('victim', ttl, 2, ttl, 'mail') };
    };

    const fixed = await run(storage);
    expect(fixed.block.isBlocked).toBe(true);
    expect(fixed.after.isBlocked).toBe(false);
    expect(fixed.after.totalHits).toBe(1);

    // The stock @nest-lab script re-blocks here: the defect this storage fixes.
    await redis.flushall();
    const original = await run(stock);
    expect(original.block.isBlocked).toBe(true);
    expect(original.after.isBlocked).toBe(true);
  });

  it('starts counting again once the window expires without a block', async () => {
    const ttl = 600;
    await storage.increment('quiet', ttl, 5, ttl, 'default');
    await storage.increment('quiet', ttl, 5, ttl, 'default');
    await sleep(800);

    const next = await storage.increment('quiet', ttl, 5, ttl, 'default');
    expect(next).toMatchObject({ totalHits: 1, isBlocked: false });
  });
});
