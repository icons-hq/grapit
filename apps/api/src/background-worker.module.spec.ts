import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { BookingModule } from './modules/booking/booking.module.js';
import { RedisModule } from './modules/booking/providers/redis.module.js';
import { redisProvider } from './modules/booking/providers/redis.provider.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { QueueService } from './modules/queue/queue.service.js';

describe('background worker module graph', () => {
  it('makes AdmissionGuard dependencies visible in BookingModule', () => {
    const bookingImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      BookingModule,
    ) as unknown[];
    const queueExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      QueueModule,
    ) as unknown[];

    expect(bookingImports).toContain(QueueModule);
    expect(queueExports).toContain(QueueService);
  });

  it('registers the Redis client provider only once in the worker graph', () => {
    const redisProviderOwners = [BookingModule, QueueModule, RedisModule].filter((module) => {
      const providers = Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        module,
      ) as unknown[];

      return providers.includes(redisProvider);
    });

    expect(redisProviderOwners).toEqual([RedisModule]);
  });
});
