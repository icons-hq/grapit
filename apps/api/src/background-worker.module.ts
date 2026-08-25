import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisConfig } from './config/redis.config.js';
import { DrizzleModule } from './database/drizzle.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      load: [redisConfig],
    }),
    DrizzleModule,
    JobsModule,
  ],
})
export class BackgroundWorkerModule {}
