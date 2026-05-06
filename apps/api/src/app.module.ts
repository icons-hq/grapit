import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type IORedis from 'ioredis';
import { APP_GUARD } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { HealthModule } from './health/health.module.js';
import { DrizzleModule } from './database/drizzle.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UserModule } from './modules/user/user.module.js';
import { SmsModule } from './modules/sms/sms.module.js';
import { PerformanceModule } from './modules/performance/performance.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { BookingModule } from './modules/booking/booking.module.js';
import { PaymentModule } from './modules/payment/payment.module.js';
import { ReservationModule } from './modules/reservation/reservation.module.js';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { REDIS_CLIENT } from './modules/booking/providers/redis.provider.js';
import { authConfig } from './config/auth.config.js';
import { redisConfig } from './config/redis.config.js';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      load: [authConfig, redisConfig],
    }),
    ThrottlerModule.forRootAsync({
      imports: [BookingModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: IORedis) => {
        // [RESEARCH Pitfall 5] InMemoryRedis has no incr method — omit storage for dev fallback
        // Real ioredis exposes incr() for INCR command — use ThrottlerStorageRedisService
        const isRealRedis = typeof (redis as IORedis).incr === 'function';
        return {
          // [Review #6] @nestjs/throttler v6 uses ms units: 60_000ms = 1 minute global default
          throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
          ...(isRealRedis
            ? { storage: new ThrottlerStorageRedisService(redis) }
            : {}), // dev: in-memory throttler fallback
        };
      },
    }),
    DrizzleModule,
    HealthModule,
    AuthModule,
    UserModule,
    SmsModule,
    PerformanceModule,
    SearchModule,
    AdminModule,
    BookingModule,
    PaymentModule,
    ReservationModule,
    FeatureFlagsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
