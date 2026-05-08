import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EmailModule } from '../auth/email/email.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { TicketController } from './ticket.controller.js';
import { QrTicketService } from './qr-ticket.service.js';

@Module({
  imports: [JwtModule.register({}), EmailModule, JobsModule],
  controllers: [TicketController],
  providers: [QrTicketService],
  exports: [QrTicketService],
})
export class TicketModule {}
