import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { BookingAddonsController } from './booking-addons.controller.js';
import { BookingAddonsService } from './booking-addons.service.js';

@Module({ imports: [BookingModule, QueueModule, FeatureFlagsModule], controllers: [BookingAddonsController], providers: [BookingAddonsService] })
export class BookingAddonsModule {}
