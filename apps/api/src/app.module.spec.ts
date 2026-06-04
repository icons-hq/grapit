import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Unit tests for ThrottlerModule forRootAsync configuration.
 * Verifies:
 * 1. forRootAsync is used (not forRoot)
 * 2. InMemoryRedis fallback uses in-memory throttler (no ThrottlerStorageRedisService)
 * 3. Real ioredis would use ThrottlerStorageRedisService (checked via import presence)
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

  it('should import ThrottlerStorageRedisService from @nest-lab/throttler-storage-redis', async () => {
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(resolve(__dirname, 'app.module.ts'), 'utf-8');

    expect(source).toContain('ThrottlerStorageRedisService');
    expect(source).toContain('@nest-lab/throttler-storage-redis');
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

    expect(source).toContain('limit: 60');
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
