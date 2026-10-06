import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisConfig } from './config/redis.config.js';
import { DrizzleModule } from './database/drizzle.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { ReservationFinalizationModule } from './modules/reservation/reservation-finalization.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      load: [redisConfig],
    }),
    DrizzleModule,
    JobsModule,
    // Payment confirm reconcile jobs (audit #18).
    ReservationFinalizationModule,
  ],
})
export class BackgroundWorkerModule {}
