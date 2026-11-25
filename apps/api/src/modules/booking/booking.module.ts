import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { BookingGateway } from './booking.gateway.js';
import { RedisModule } from './providers/redis.module.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { TrafficModule } from '../traffic/traffic.module.js';
import { BookingMacroService } from '../traffic/booking-macro.service.js';
import { BookingMacroController, BookingMacroGuard } from './booking-macro.guard.js';

@Module({
  imports: [ConfigModule, FeatureFlagsModule, RedisModule, QueueModule, TrafficModule],
  controllers: [BookingController, BookingMacroController],
  providers: [
    BookingService,
    BookingGateway,
    BookingMacroService,
    BookingMacroGuard,
  ],
  exports: [BookingService, BookingGateway, RedisModule],
})
export class BookingModule {}
