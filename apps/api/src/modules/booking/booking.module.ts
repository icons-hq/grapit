import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { BookingGateway } from './booking.gateway.js';
import { RedisModule } from './providers/redis.module.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({
  imports: [ConfigModule, FeatureFlagsModule, RedisModule, QueueModule],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingGateway,
  ],
  exports: [BookingService, BookingGateway, RedisModule],
})
export class BookingModule {}
