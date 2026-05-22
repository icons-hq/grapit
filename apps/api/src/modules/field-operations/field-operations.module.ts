import { Module } from '@nestjs/common';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { FieldCheckInController } from './field-check-in.controller.js';
import { FieldCheckInService } from './field-check-in.service.js';

@Module({
  imports: [TicketModule],
  controllers: [FieldCheckInController],
  providers: [
    FieldCheckInService,
    AdminAuditService,
    AdminCapabilitiesGuard,
  ],
  exports: [FieldCheckInService],
})
export class FieldOperationsModule {}
