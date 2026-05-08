import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { ReservationController } from './reservation.controller.js';
import { ReservationService } from './reservation.service.js';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js';
import { ConsentModule } from '../consent/consent.module.js';
import { TicketModule } from '../ticket/ticket.module.js';

@Module({
  imports: [PaymentModule, BookingModule, FeatureFlagsModule, ConsentModule, TicketModule],
  controllers: [ReservationController],
  providers: [ReservationService],
  exports: [ReservationService],
})
export class ReservationModule {}
