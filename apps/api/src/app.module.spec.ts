import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Unit tests for ThrottlerModule forRootAsync configuration.
 * Verifies:
 * 1. forRootAsync is used (not forRoot)
 * 2. InMemoryRedis fallback uses in-memory throttler (no Redis storage)
 * 3. Real ioredis uses the block-aware @nest-lab Redis storage
 */

describe('AppModule ThrottlerModule configuration', () => {
  it('should have ThrottlerModule.forRootAsync in app.module.ts source', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');

    // forRootAsync must be present
    expect(source).toContain('ThrottlerModule.forRootAsync');
    // forRoot([...]) must NOT be present (old pattern)
    expect(source).not.toMatch(/ThrottlerModule\.forRoot\s*\(/);
  });

  it('should use the @nest-lab Redis storage that does not count blocked requests', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');
    const { ThrottlerStorageRedisService } = await import('@nest-lab/throttler-storage-redis');
    const { BlockAwareThrottlerStorageRedisService, BLOCK_AWARE_THROTTLE_SCRIPT } = await import(
      './modules/traffic/throttler-storage.js'
    );

    expect(source).toContain('new BlockAwareThrottlerStorageRedisService(redis)');
    expect(source).not.toContain('new ThrottlerStorageRedisService(');
    expect(BlockAwareThrottlerStorageRedisService.prototype).toBeInstanceOf(
      ThrottlerStorageRedisService,
    );
    expect(BlockAwareThrottlerStorageRedisService.prototype.getScriptSrc()).toBe(
      BLOCK_AWARE_THROTTLE_SCRIPT,
    );
    // The block check must come before the hit is counted (see throttler-storage.ts).
    expect(BLOCK_AWARE_THROTTLE_SCRIPT.indexOf("redis.call('PTTL', blockKey)")).toBeLessThan(
      BLOCK_AWARE_THROTTLE_SCRIPT.indexOf("redis.call('INCR', hitKey)"),
    );
  });

  it('should inject REDIS_CLIENT in forRootAsync', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');

    expect(source).toContain('REDIS_CLIENT');
    expect(source).toContain('inject:');
  });

  it('should use incr-based InMemoryRedis detection (RESEARCH Pitfall 5)', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');

    // Must use typeof redis.incr === 'function' check (Pitfall 5)
    expect(source).toMatch(/typeof.*incr\s*===\s*'function'/);
    // Must NOT use typeof redis.call (incorrect detection pattern)
    expect(source).not.toMatch(/typeof.*\.call\s*===\s*'function'/);
  });

  it('should have TTL in milliseconds with ms comment (Review #6)', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');

    // TTL must be 60_000 or 60000 (ms unit)
    expect(source).toMatch(/60[_]?000/);
    // Must contain ms unit comment
    expect(source).toMatch(/ms/);
  });

  it('should keep global default throttle with limit 60', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');
    const { TrafficDefenseService } = await import(
      './modules/traffic/traffic-defense.service.js'
    );
    const config = new TrafficDefenseService().getThrottlerModuleConfig();

    expect(source).toContain('trafficDefense.getThrottlerModuleConfig()');
    expect(config.throttlers[0]).toMatchObject({ name: 'default', ttl: 60_000, limit: 60 });
  });

  it('should authenticate before throttling so protected routes are tracked by verified user identity', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');

    expect(source.indexOf('useClass: JwtAuthGuard')).toBeLessThan(
      source.indexOf('useClass: ThrottlerGuard'),
    );
  });

  it('InMemoryRedis should NOT have incr method (confirms guard necessity)', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const redisProviderSource = await readFile(
      resolve(__dirname, 'modules/booking/providers/redis.provider.ts'),
      'utf-8',
    );

    // InMemoryRedis class should not implement incr
    // This validates the incr-based detection is correct
    expect(redisProviderSource).not.toMatch(/async\s+incr\s*\(/);
  });
});
